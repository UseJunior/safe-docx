#!/usr/bin/env node
/**
 * Structural formatting-loss detectors for a before/after .docx pair (issue #682).
 *
 * The comparison failure taxonomy classified failures as a throw, phantom
 * markup, silent content loss, or a degraded-but-valid redline. None of those
 * cover the class where *formatting* is destroyed while the text survives, and
 * that class is invisible to every check the diagnostic procedure routinely
 * runs: extracted text comes back byte-identical, round-trip reports success,
 * and the document opens cleanly in Word. Two observed shapes:
 *
 *   D1 run-formatting flattening — a replacement whose span crosses a run
 *      boundary collapses the boundary and drops bold/italic from the affected
 *      span. Detected per paragraph by projecting each character of the
 *      paragraph onto its (bold, italic, underline) triple: if the text is
 *      unchanged but that projection changed, emphasis was flattened.
 *
 *      Issue #682 sketched D1 as a multiset of runs keyed on
 *      (text, bold, italic, underline). That formulation fires on any run
 *      boundary move, including boundary moves that preserve every character's
 *      emphasis — which this codebase produces routinely, via atomizer token
 *      splitting and rsid churn (#677). The character projection is invariant
 *      to boundary churn and fires only on actual loss, so it is what shipped.
 *
 *   D2 emptied-but-retained paragraphs — replacing a block leaves paragraph
 *      shells behind. An empty body paragraph renders as a blank line; an empty
 *      list paragraph that keeps its w:numPr renders an orphan numbered label,
 *      which a reader sees and a text diff does not. Detected by matching
 *      paragraphs on w14:paraId.
 *
 * Paragraphs are matched on w14:paraId rather than on document order because
 * order shifts whenever a comparison inserts or deletes a paragraph, which is
 * exactly the run this check has to survive. Paragraphs without a paraId cannot
 * be matched at all; they are counted and reported rather than key-substituted,
 * so the coverage line always states what the detectors could not see.
 *
 * Output discipline: this runs over confidential documents, so it emits only
 * counts, w14:paraId values, and element names — never document text. The
 * projection keeps a digest of each paragraph's text rather than the text
 * itself, so even a dump of the intermediate state carries no recoverable
 * prose, and a unit test holds the report to the same line.
 *
 * Usage:
 *   node scripts/check_docx_formatting_loss.mjs <before.docx> <after.docx>
 *   node scripts/check_docx_formatting_loss.mjs --self-test
 *   node scripts/check_docx_formatting_loss.mjs --json <before.docx> <after.docx>
 *
 * --self-test first proves the detectors fire on a known-bad pair and stay
 * silent on a known-good one. A detector that has never been shown to fire is
 * indistinguishable from no detector, and "no findings" from such a run is not
 * evidence of anything.
 *
 * Exit status: 0 when no detector fires, 1 when any does, 2 on usage or IO error.
 */

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Maximum paraIds listed per detector line before the tail is summarized. */
const MAX_LISTED_IDS = 20;

/** ST_OnOff values that turn a toggle property off. ECMA-376 Part 1 § 17.17.4. */
const OFF_VALUES = new Set(['0', 'false', 'off']);

function elementsByTag(node, localName) {
  return Array.from(node.getElementsByTagNameNS(W_NS, localName));
}

function directChild(element, localName) {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && child.namespaceURI === W_NS && child.localName === localName) {
      return child;
    }
  }
  return undefined;
}

/**
 * The nearest ancestor-or-self w:p. A w:p can nest inside another w:p via a
 * text box (w:txbxContent) or a table cell, so descendant queries have to be
 * filtered by ownership or the outer paragraph absorbs the inner one's runs.
 */
function owningParagraph(node) {
  for (let current = node; current; current = current.parentNode) {
    if (current.nodeType === 1 && current.namespaceURI === W_NS && current.localName === 'p') {
      return current;
    }
  }
  return undefined;
}

function attributeValue(element, namespaceUri, localName) {
  const value = element.getAttributeNS(namespaceUri, localName);
  return value === null || value === '' ? undefined : value;
}

/** A toggle property is on when present unless w:val says otherwise. */
function toggleIsOn(runProperties, localName) {
  if (!runProperties) return false;
  const property = directChild(runProperties, localName);
  if (!property) return false;
  const value = attributeValue(property, W_NS, 'val');
  return value === undefined ? true : !OFF_VALUES.has(value.toLowerCase());
}

/**
 * w:u is not a toggle — it carries an underline style. The raw value is kept so
 * a single-to-dotted change counts as a formatting change, not just on/off.
 */
function underlineValue(runProperties) {
  if (!runProperties) return 'none';
  const underline = directChild(runProperties, 'u');
  if (!underline) return 'none';
  return attributeValue(underline, W_NS, 'val') ?? 'unspecified';
}

function runText(run, paragraph) {
  let text = '';
  for (const node of elementsByTag(run, 't')) {
    if (owningParagraph(node) === paragraph) text += node.textContent ?? '';
  }
  return text;
}

function runEmphasis(run) {
  const runProperties = directChild(run, 'rPr');
  return [toggleIsOn(runProperties, 'b'), toggleIsOn(runProperties, 'i'), underlineValue(runProperties)];
}

/**
 * Append `length` characters of `emphasis` to a run-length-encoded projection,
 * merging into the previous span when the emphasis matches. Merging is what
 * makes the encoding canonical, and therefore what makes a plain array
 * comparison equivalent to comparing the two per-character projections.
 */
function appendEmphasisSpan(spans, length, emphasis) {
  if (length === 0) return;
  const previous = spans[spans.length - 1];
  if (previous && previous[1] === emphasis[0] && previous[2] === emphasis[1] && previous[3] === emphasis[2]) {
    previous[0] += length;
    return;
  }
  spans.push([length, ...emphasis]);
}

function sameEmphasisProjection(before, after) {
  if (before.length !== after.length) return false;
  return before.every((span, index) => span.every((value, position) => value === after[index][position]));
}

/**
 * Project word/document.xml into the per-paragraph shape both detectors read.
 *
 * Duplicate paraIds are dropped from the match set rather than last-write-wins:
 * two paragraphs sharing an id cannot be told apart, and silently keeping one
 * would report a comparison the tool did not actually make.
 *
 * @param {string} documentXml raw word/document.xml
 */
export function projectParagraphs(documentXml) {
  // A parse failure has to be loud: a document that silently projects to zero
  // paragraphs makes every detector report zero findings, which reads as a pass.
  const errors = [];
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError') errors.push(String(message));
      },
    }).parseFromString(documentXml, 'application/xml');
  } catch (error) {
    throw new Error(`word/document.xml did not parse: ${error.message}`);
  }

  if (errors.length > 0) {
    throw new Error(`word/document.xml did not parse: ${errors[0]}`);
  }

  const byParaId = new Map();
  const duplicateParaIds = new Set();
  let unkeyedParagraphs = 0;
  let totalParagraphs = 0;

  for (const paragraph of elementsByTag(document, 'p')) {
    totalParagraphs += 1;
    const paraId = attributeValue(paragraph, W14_NS, 'paraId');
    if (paraId === undefined) {
      unkeyedParagraphs += 1;
      continue;
    }
    if (byParaId.has(paraId) || duplicateParaIds.has(paraId)) {
      byParaId.delete(paraId);
      duplicateParaIds.add(paraId);
      continue;
    }

    const emphasisSpans = [];
    let text = '';
    for (const run of elementsByTag(paragraph, 'r')) {
      if (owningParagraph(run) !== paragraph) continue;
      const ownText = runText(run, paragraph);
      text += ownText;
      // Empty runs (bookmarks, field characters, breaks) span no characters, so
      // they carry no emphasis that could be lost.
      appendEmphasisSpan(emphasisSpans, ownText.length, runEmphasis(run));
    }

    const paragraphProperties = directChild(paragraph, 'pPr');
    byParaId.set(paraId, {
      emphasisSpans,
      textDigest: createHash('sha256').update(text).digest('hex'),
      isEmpty: text.trim() === '',
      hasNumbering: paragraphProperties ? directChild(paragraphProperties, 'numPr') !== undefined : false,
    });
  }

  return {
    byParaId,
    duplicateParaIds: [...duplicateParaIds].sort(),
    unkeyedParagraphs,
    totalParagraphs,
  };
}

/**
 * Run D1 and D2 over two projections.
 *
 * @param {ReturnType<typeof projectParagraphs>} before
 * @param {ReturnType<typeof projectParagraphs>} after
 */
export function detectFormattingLoss(before, after) {
  const flattenedParagraphIds = [];
  const emptiedParagraphIds = [];
  const orphanNumberingParagraphIds = [];
  let matchedParagraphs = 0;

  for (const [paraId, beforeParagraph] of before.byParaId) {
    const afterParagraph = after.byParaId.get(paraId);
    if (!afterParagraph) continue;
    matchedParagraphs += 1;

    // D1 — same characters, different emphasis.
    if (
      beforeParagraph.textDigest === afterParagraph.textDigest &&
      !sameEmphasisProjection(beforeParagraph.emphasisSpans, afterParagraph.emphasisSpans)
    ) {
      flattenedParagraphIds.push(paraId);
    }

    // D2a — carried text before, carries none after.
    if (!beforeParagraph.isEmpty && afterParagraph.isEmpty) {
      emptiedParagraphIds.push(paraId);
    }
  }

  // D2b — an empty paragraph that kept its numbering renders an orphan label.
  for (const [paraId, afterParagraph] of after.byParaId) {
    if (afterParagraph.isEmpty && afterParagraph.hasNumbering) {
      orphanNumberingParagraphIds.push(paraId);
    }
  }

  return {
    flattenedParagraphIds: flattenedParagraphIds.sort(),
    emptiedParagraphIds: emptiedParagraphIds.sort(),
    orphanNumberingParagraphIds: orphanNumberingParagraphIds.sort(),
    matchedParagraphs,
    coverage: {
      beforeTotal: before.totalParagraphs,
      afterTotal: after.totalParagraphs,
      beforeUnkeyed: before.unkeyedParagraphs,
      afterUnkeyed: after.unkeyedParagraphs,
      beforeDuplicateIds: before.duplicateParaIds.length,
      afterDuplicateIds: after.duplicateParaIds.length,
    },
  };
}

export function hasFindings(result) {
  return (
    result.flattenedParagraphIds.length > 0 ||
    result.emptiedParagraphIds.length > 0 ||
    result.orphanNumberingParagraphIds.length > 0
  );
}

function formatIdList(ids) {
  const listed = ids.slice(0, MAX_LISTED_IDS).join(' ');
  const remaining = ids.length - MAX_LISTED_IDS;
  return remaining > 0 ? `[${listed} (+${remaining} more)]` : `[${listed}]`;
}

/**
 * Render the result as text. Every count is printed even when zero — a detector
 * that reports nothing when it found nothing is indistinguishable from a
 * detector that did not run.
 */
export function formatReport(result) {
  const { coverage } = result;
  const unmatched = coverage.beforeUnkeyed + coverage.afterUnkeyed;
  const lines = [
    `D1 run-formatting flattened paragraphs: ${result.flattenedParagraphIds.length} ${formatIdList(result.flattenedParagraphIds)}`,
    `D2 emptied-but-retained paragraphs: ${result.emptiedParagraphIds.length} ${formatIdList(result.emptiedParagraphIds)}`,
    `D2 empty paragraphs retaining w:numPr: ${result.orphanNumberingParagraphIds.length} ${formatIdList(result.orphanNumberingParagraphIds)}`,
    `coverage: ${result.matchedParagraphs} paragraphs matched by w14:paraId ` +
      `(before ${coverage.beforeTotal} paragraphs, ${coverage.beforeUnkeyed} unkeyed, ${coverage.beforeDuplicateIds} duplicate ids; ` +
      `after ${coverage.afterTotal} paragraphs, ${coverage.afterUnkeyed} unkeyed, ${coverage.afterDuplicateIds} duplicate ids)`,
  ];
  if (unmatched > 0) {
    lines.push(
      `note: ${unmatched} paragraphs carry no w14:paraId and were not compared — ` +
        `a zero count above does not cover them`,
    );
  }
  return lines;
}

export async function readDocumentXml(docxPath) {
  let archive;
  try {
    archive = await JSZip.loadAsync(readFileSync(docxPath));
  } catch (error) {
    throw new Error(`${docxPath} is not a readable .docx package: ${error.message}`);
  }
  const entry = archive.file('word/document.xml');
  if (!entry) throw new Error(`${docxPath} has no word/document.xml`);
  return entry.async('string');
}

/** Minimal OOXML package used by --self-test and the unit tests. */
export async function buildMinimalDocx(bodyXml) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file('word/document.xml', wrapBodyXml(bodyXml));
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function wrapBodyXml(bodyXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}" mc:Ignorable="w14" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
    `<w:body>${bodyXml}</w:body></w:document>`
  );
}

/**
 * Known-good and known-bad body XML for the self-test. The bad side is the two
 * shapes this check exists for: a defined term whose cross-run bold was
 * flattened into a single plain run, and a numbered paragraph emptied but kept.
 */
export const SELF_TEST_BEFORE_BODY =
  `<w:p w14:paraId="11111111">` +
  `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Term</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve"> means the defined thing.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="22222222">` +
  `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
  `<w:r><w:t>A numbered obligation.</w:t></w:r>` +
  `</w:p>`;

export const SELF_TEST_AFTER_BODY =
  `<w:p w14:paraId="11111111">` +
  `<w:r><w:t xml:space="preserve">Term means the defined thing.</w:t></w:r>` +
  `</w:p>` +
  `<w:p w14:paraId="22222222">` +
  `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
  `</w:p>`;

async function runSelfTest() {
  const before = projectParagraphs(wrapBodyXml(SELF_TEST_BEFORE_BODY));
  const after = projectParagraphs(wrapBodyXml(SELF_TEST_AFTER_BODY));

  const unchanged = detectFormattingLoss(before, projectParagraphs(wrapBodyXml(SELF_TEST_BEFORE_BODY)));
  const damaged = detectFormattingLoss(before, after);

  const failures = [];
  if (hasFindings(unchanged)) {
    failures.push('known-good pair reported findings — the detectors have false positives');
  }
  if (damaged.flattenedParagraphIds.length !== 1) {
    failures.push(`D1 did not fire on the known-bad pair (got ${damaged.flattenedParagraphIds.length}, expected 1)`);
  }
  if (damaged.emptiedParagraphIds.length !== 1) {
    failures.push(`D2 emptied did not fire on the known-bad pair (got ${damaged.emptiedParagraphIds.length}, expected 1)`);
  }
  if (damaged.orphanNumberingParagraphIds.length !== 1) {
    failures.push(
      `D2 orphan-numbering did not fire on the known-bad pair (got ${damaged.orphanNumberingParagraphIds.length}, expected 1)`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check_docx_formatting_loss: self-test FAILED — ${failure}`);
    return 1;
  }

  console.log('self-test: known-good pair clean, known-bad pair caught by D1 and both D2 checks');
  for (const line of formatReport(damaged)) console.log(`self-test known-bad ${line}`);
  return 0;
}

export async function main(argv) {
  const useJson = argv.includes('--json');
  const positional = argv.filter((argument) => !argument.startsWith('--'));

  if (argv.includes('--self-test')) return runSelfTest();

  if (positional.length !== 2) {
    console.error('usage: check_docx_formatting_loss.mjs [--json] <before.docx> <after.docx>');
    console.error('       check_docx_formatting_loss.mjs --self-test');
    return 2;
  }

  let result;
  try {
    const [beforeXml, afterXml] = await Promise.all(positional.map(readDocumentXml));
    result = detectFormattingLoss(projectParagraphs(beforeXml), projectParagraphs(afterXml));
  } catch (error) {
    console.error(`check_docx_formatting_loss: ${error.message}`);
    return 2;
  }

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const line of formatReport(result)) console.log(line);
  }
  return hasFindings(result) ? 1 : 0;
}

function invokedDirectly() {
  // A node_modules/.bin symlink makes import.meta.url and argv[1] differ, so
  // both sides are resolved through realpath before comparison.
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
