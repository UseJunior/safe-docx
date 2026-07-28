/**
 * Real-corpus paragraph-deletion comparison gate.
 *
 * Synthetic fixtures are deliberately insufficient here: Word-authored NVCA
 * agreements contain field and bookmark layouts that previously escaped a
 * completely green suite. Each corpus source is SHA-256-pinned and exercised
 * in both reconstruction modes after removing one real paragraph.
 *
 * Known defects use exact characterization outcomes so a behavior change fails
 * the gate in either direction. A different failure is a regression; a cell
 * that unexpectedly starts passing also fails and requires its pin to be removed.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/658
 * @see https://github.com/UseJunior/safe-docx/issues/643
 * @see https://github.com/UseJunior/safe-docx/issues/645
 * @see https://github.com/UseJunior/safe-docx/issues/646
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer } from '../baselines/atomizer/pipeline.js';
import type { ReconstructionMode } from '../compare-types.js';
import { testAllure } from '../testing/allure-test.js';

const CORPUS_ENV = 'SAFE_DOCX_REAL_CORPUS_DIR';
const REQUIRED_ENV = 'SAFE_DOCX_REAL_CORPUS_REQUIRED';
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(INTEGRATION_DIR, 'real-corpus-manifest.json');
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface CorpusEntry {
  id: string;
  sourceUrl: string;
  sha256: string;
}

interface CorpusAvailability {
  available: boolean;
  skipWarning: string | null;
  entries: CorpusEntry[];
}

interface ParagraphDeletion {
  revised: Buffer;
  targetedBookmarkNames: string[];
}

type CellOutcome =
  | { kind: 'pass' }
  | { kind: 'bookmark-range-failure'; names: string[] }
  | { kind: 'comparison-error'; errorName: string; message: string };

type ExpectedFailure =
  | {
      issue: string;
      kind: 'bookmark-range-failure';
      names: string[];
    }
  | {
      issue: string;
      kind: 'comparison-error';
      errorName: string;
      messageIncludes: string;
    };

const corpusEntries = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as CorpusEntry[];

const expectedFailures: Readonly<
  Record<string, Partial<Record<ReconstructionMode, ExpectedFailure>>>
> = {
  'nvca-indemnification-agreement': {
    rebuild: {
      issue: '#646',
      kind: 'comparison-error',
      errorName: 'OpaquePassthroughError',
      messageIncludes: 'boundary count changed (108 original, 106 revised)',
    },
  },
  'nvca-investors-rights-agreement': {
    rebuild: {
      issue: '#646',
      kind: 'comparison-error',
      errorName: 'OpaquePassthroughError',
      messageIncludes: 'unsupported REF field instruction shape',
    },
  },
  'nvca-stock-purchase-agreement': {
    rebuild: {
      issue: '#646',
      kind: 'comparison-error',
      errorName: 'OpaquePassthroughError',
      messageIncludes: 'boundary count changed (68 original, 67 revised)',
    },
  },
  'nvca-voting-agreement': {
    rebuild: {
      issue: '#646',
      kind: 'comparison-error',
      errorName: 'OpaquePassthroughError',
      messageIncludes: 'boundary count changed (64 original, 63 revised)',
    },
  },
};

const preferredDeletionTarget: Readonly<Partial<Record<string, string>>> = {
  'nvca-voting-agreement': '_Ref444624639',
};

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Real-Corpus Paragraph Deletion Gate',
    story: 'Word-Authored Agreement Paragraph Deletion',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );
const paragraphStyleTest = test.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.13.5.29',
});

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function resolveCorpusAvailability(corpusRoot: string): CorpusAvailability {
  const problems: string[] = [];
  if (!corpusRoot) {
    problems.push(`${CORPUS_ENV} is unset`);
  } else {
    for (const entry of corpusEntries) {
      const sourcePath = join(corpusRoot, entry.id, 'source.docx');
      if (!existsSync(sourcePath)) {
        problems.push(`${entry.id}/source.docx is missing`);
        continue;
      }
      const actualSha256 = sha256(readFileSync(sourcePath));
      if (actualSha256 !== entry.sha256) {
        problems.push(`${entry.id}/source.docx failed SHA-256 verification`);
      }
    }
  }

  return {
    available: problems.length === 0,
    entries: corpusEntries,
    skipWarning:
      problems.length === 0
        ? null
        : `[real-corpus-paragraph-deletion] SKIP: set ${CORPUS_ENV} to the ` +
          `SHA-256-verified Open Agreements cache root. ${problems.join('; ')}.`,
  };
}

function elements(node: XmlDocument | XmlElement, tagName: string): XmlElement[] {
  return Array.from(node.getElementsByTagName(tagName));
}

function fieldTargetNames(documentXml: string): Set<string> {
  const document = new DOMParser().parseFromString(documentXml, 'text/xml');
  const instructions = [
    ...elements(document, 'w:instrText').map((node) => node.textContent ?? ''),
    ...elements(document, 'w:fldSimple').map(
      (node) => node.getAttribute('w:instr') ?? node.getAttributeNS(W_NS, 'instr') ?? '',
    ),
  ];
  const names = new Set<string>();
  for (const instruction of instructions) {
    const match = instruction.match(/\b(?:REF|PAGEREF)\s+(?:"([^"]+)"|([^\s\\]+))/i);
    const name = match?.[1] ?? match?.[2];
    if (name) names.add(name);
  }
  return names;
}

function directBodyParagraphs(document: XmlDocument): XmlElement[] {
  const body = elements(document, 'w:body')[0];
  if (!body) throw new Error('word/document.xml has no w:body');
  return Array.from(body.childNodes).filter(
    (node): node is XmlElement =>
      node.nodeType === 1 && (node as XmlElement).tagName === 'w:p',
  );
}

function targetedBookmarkNames(
  paragraph: XmlElement,
  targets: Set<string>,
): { all: string[]; midParagraph: string[] } {
  const orderedNodes: XmlNode[] = [];
  const visit = (node: XmlNode): void => {
    orderedNodes.push(node);
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(paragraph);

  const all: string[] = [];
  const midParagraph: string[] = [];
  for (const start of elements(paragraph, 'w:bookmarkStart')) {
    const name = start.getAttribute('w:name') ?? start.getAttributeNS(W_NS, 'name');
    const id = start.getAttribute('w:id') ?? start.getAttributeNS(W_NS, 'id');
    if (!name || !id || !targets.has(name)) continue;
    const end = elements(paragraph, 'w:bookmarkEnd').find(
      (candidate) =>
        (candidate.getAttribute('w:id') ?? candidate.getAttributeNS(W_NS, 'id')) === id,
    );
    if (!end) continue;
    const startIndex = orderedNodes.indexOf(start);
    const endIndex = orderedNodes.indexOf(end);
    const hasTextInside = orderedNodes.some(
      (node, index) =>
        index > startIndex &&
        index < endIndex &&
        node.nodeType === 3 &&
        (node.nodeValue ?? '').trim() !== '',
    );
    if (!hasTextInside) continue;
    all.push(name);
    const hasTextAfter = orderedNodes.some(
      (node, index) =>
        index > endIndex && node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '',
    );
    if (hasTextAfter) midParagraph.push(name);
  }
  return { all, midParagraph };
}

function selectDeletionParagraph(
  paragraphs: XmlElement[],
  targetNames: Set<string>,
  preferredTargetName?: string,
): { paragraph: XmlElement; targetedBookmarkNames: string[] } {
  const candidates = paragraphs
    .map((paragraph) => {
      const targets = targetedBookmarkNames(paragraph, targetNames);
      return {
        paragraph,
        targetedBookmarkNames: targets.all,
        midParagraphTargetedBookmarkNames: targets.midParagraph,
        text: paragraph.textContent?.trim() ?? '',
      };
    })
    .filter((candidate) => candidate.text.length >= 20);

  const selected =
    candidates.find((candidate) =>
      candidate.midParagraphTargetedBookmarkNames.includes(preferredTargetName ?? ''),
    ) ??
    candidates.find((candidate) => candidate.midParagraphTargetedBookmarkNames.length > 0) ??
    candidates.find((candidate) => candidate.targetedBookmarkNames.length > 0) ??
    candidates.find((_candidate, index) => index > 0 && index < candidates.length - 1);

  if (!selected) throw new Error('no suitable body-level paragraph found for deletion');
  return {
    paragraph: selected.paragraph,
    targetedBookmarkNames:
      preferredTargetName &&
      selected.midParagraphTargetedBookmarkNames.includes(preferredTargetName)
        ? [preferredTargetName]
        : selected.midParagraphTargetedBookmarkNames.length > 0
        ? selected.midParagraphTargetedBookmarkNames
        : selected.targetedBookmarkNames,
  };
}

async function deleteOneRealParagraph(
  original: Buffer,
  preferredTargetName?: string,
): Promise<ParagraphDeletion> {
  const zip = await JSZip.loadAsync(original);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error('DOCX has no word/document.xml');
  const documentXml = await documentPart.async('string');
  const document = new DOMParser().parseFromString(documentXml, 'text/xml');
  const selected = selectDeletionParagraph(
    directBodyParagraphs(document),
    fieldTargetNames(documentXml),
    preferredTargetName,
  );
  selected.paragraph.parentNode?.removeChild(selected.paragraph);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  return {
    revised: await zip.generateAsync({ type: 'nodebuffer' }),
    targetedBookmarkNames: selected.targetedBookmarkNames,
  };
}

function collapsedTargetedBookmarkNames(
  comparedDocumentXml: string,
  names: string[],
): string[] {
  const document = new DOMParser().parseFromString(comparedDocumentXml, 'text/xml');
  const collapsed: string[] = [];
  for (const name of names) {
    const start = elements(document, 'w:bookmarkStart').find(
      (candidate) =>
        (candidate.getAttribute('w:name') ?? candidate.getAttributeNS(W_NS, 'name')) === name,
    );
    if (!start) {
      collapsed.push(name);
      continue;
    }
    const id = start.getAttribute('w:id') ?? start.getAttributeNS(W_NS, 'id');
    const end = elements(document, 'w:bookmarkEnd').find(
      (candidate) =>
        (candidate.getAttribute('w:id') ?? candidate.getAttributeNS(W_NS, 'id')) === id,
    );
    if (!end) {
      collapsed.push(name);
      continue;
    }

    const paragraph = start.parentNode as XmlElement | null;
    if (paragraph?.tagName !== 'w:p' || end.parentNode !== paragraph) {
      collapsed.push(name);
      continue;
    }

    const orderedElements: XmlElement[] = [];
    const visit = (node: XmlNode): void => {
      if (node.nodeType === 1) orderedElements.push(node as XmlElement);
      for (const child of Array.from(node.childNodes)) visit(child);
    };
    visit(paragraph);
    const startIndex = orderedElements.indexOf(start);
    const endIndex = orderedElements.indexOf(end);
    const deletedTextIndex = orderedElements.findIndex(
      (element, index) =>
        index > startIndex && index < endIndex && element.tagName === 'w:delText',
    );
    if (startIndex >= endIndex || deletedTextIndex <= startIndex) collapsed.push(name);
  }
  return collapsed;
}

async function runCell(
  entry: CorpusEntry,
  reconstructionMode: ReconstructionMode,
): Promise<CellOutcome> {
  const original = readFileSync(join(corpusRoot, entry.id, 'source.docx'));
  const deletion = await deleteOneRealParagraph(
    original,
    preferredDeletionTarget[entry.id],
  );
  try {
    const result = await compareDocumentsAtomizer(original, deletion.revised, {
      author: 'Real Corpus Gate',
      date: new Date('2026-07-26T00:00:00Z'),
      reconstructionMode,
    });
    if (result.reconstructionModeUsed !== reconstructionMode) {
      return {
        kind: 'comparison-error',
        errorName: 'ReconstructionModeMismatch',
        message: `requested ${reconstructionMode}, used ${String(result.reconstructionModeUsed)}`,
      };
    }
    const comparedZip = await JSZip.loadAsync(result.document);
    const comparedDocumentXml = await comparedZip.file('word/document.xml')!.async('string');
    const collapsedNames = collapsedTargetedBookmarkNames(
      comparedDocumentXml,
      deletion.targetedBookmarkNames,
    );
    return collapsedNames.length === 0
      ? { kind: 'pass' }
      : { kind: 'bookmark-range-failure', names: collapsedNames };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      kind: 'comparison-error',
      errorName: error.constructor.name,
      message: error.message,
    };
  }
}

function assertExpectedOutcome(outcome: CellOutcome, expectedFailure?: ExpectedFailure): void {
  if (!expectedFailure) {
    expect(outcome).toEqual({ kind: 'pass' });
    return;
  }
  expect(outcome.kind, `${expectedFailure.issue} characterization kind`).toBe(
    expectedFailure.kind,
  );
  if (
    outcome.kind === 'bookmark-range-failure' &&
    expectedFailure.kind === 'bookmark-range-failure'
  ) {
    expect(outcome.names).toEqual(expectedFailure.names);
    return;
  }
  if (outcome.kind === 'comparison-error' && expectedFailure.kind === 'comparison-error') {
    expect(outcome.errorName).toBe(expectedFailure.errorName);
    expect(outcome.message).toContain(expectedFailure.messageIncludes);
  }
}

const corpusRoot = process.env[CORPUS_ENV] ?? '';
const corpusAvailability = resolveCorpusAvailability(corpusRoot);
if (!corpusAvailability.available) {
  console.warn(corpusAvailability.skipWarning);
}

describe('real-corpus gate availability', () => {
  test('an unset corpus directory resolves to a logged skip warning naming the variable', () => {
    const resolution = resolveCorpusAvailability('');
    expect(resolution.available).toBe(false);
    expect(resolution.skipWarning).toContain('SKIP');
    expect(resolution.skipWarning).toContain(CORPUS_ENV);
  });

  if (process.env[REQUIRED_ENV] === '1') {
    test('required CI corpus is complete and SHA-256 verified', () => {
      expect(corpusAvailability.skipWarning).toBeNull();
      expect(corpusAvailability.available).toBe(true);
    });
  }
});

describe.skipIf(!corpusAvailability.available)('real-corpus paragraph deletion matrix', () => {
  for (const entry of corpusAvailability.entries) {
    for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
      const expectedFailure = expectedFailures[entry.id]?.[reconstructionMode];
      const title =
        `${entry.id} × ${reconstructionMode} × paragraph-deletion` +
        (expectedFailure ? ` characterizes ${expectedFailure.issue}` : '');
      test(
        title,
        async () => {
          assertExpectedOutcome(
            await runCell(entry, reconstructionMode),
            expectedFailure,
          );
        },
        120_000,
      );
    }
  }
});

describe.skipIf(!corpusAvailability.available)('real-corpus paragraph style no-phantom matrix', () => {
  for (const entry of corpusAvailability.entries) {
    // The investors-rights rebuild cell is blocked before style detection by
    // the exact unsupported-REF characterization pinned to #646 above. Inplace
    // still exercises that SHA-pinned document, while every currently
    // rebuild-supported corpus member exercises both reconstruction modes.
    const reconstructionModes: readonly ReconstructionMode[] =
      entry.id === 'nvca-investors-rights-agreement'
        ? ['inplace']
        : ['inplace', 'rebuild'];
    for (const reconstructionMode of reconstructionModes) {
      paragraphStyleTest.openspec('[SDX-CMP-PSTYLE-07] Unchanged real paragraph styles produce no phantom markup')(
        `${entry.id} × ${reconstructionMode} × unchanged paragraph styles`,
        async () => {
          const source = readFileSync(join(corpusRoot, entry.id, 'source.docx'));
          const author = 'Real Corpus Paragraph Style Gate';
          const result = await compareDocumentsAtomizer(source, source, {
            author,
            date: new Date('2026-07-28T00:00:00Z'),
            reconstructionMode,
          });
          expect(result.reconstructionModeUsed).toBe(reconstructionMode);
          expect(result.stats.formatChanges).toBe(0);

          const comparedZip = await JSZip.loadAsync(result.document);
          const comparedDocumentXml = await comparedZip
            .file('word/document.xml')!
            .async('string');
          const comparedDocument = new DOMParser().parseFromString(
            comparedDocumentXml,
            'text/xml',
          );
          const authoredPPrChanges = elements(comparedDocument, 'w:pPrChange')
            .filter((change) =>
              (change.getAttribute('w:author') ??
                change.getAttributeNS(W_NS, 'author')) === author,
            );
          expect(authoredPPrChanges).toHaveLength(0);
        },
        120_000,
      );
    }
  }
});
