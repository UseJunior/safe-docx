import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { DocxDocument, getParagraphRuns } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { openSession, registerCleanup, assertSuccess } from '../testing/session-test-utils.js';
import { SessionManager } from '../session/manager.js';
import { replaceText } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { batchEdit } from './batch_edit.js';
import {
  DEFAULT_DOMINANCE_THRESHOLD,
  DEFAULT_MIN_INSTANCES,
  FORMATTING_CONVENTION_WARNING_CODE,
  checkFormattingConvention,
  findInlineDefinedTermSpans,
  findProvisoKeywordSpans,
  summarizeDocumentConvention,
} from './formatting_convention.js';

const test = testAllure
  .epic('Document Editing')
  .withLabels({ feature: 'Formatting Convention Check' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, '../../../../tests/test_documents');
const NVCA_COI_SOURCE = path.join(CORPUS, 'nvca-coi-regression/source.docx');
const ILPA_SOURCE = path.join(
  CORPUS,
  'redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';

// ---------------------------------------------------------------------------
// Synthetic fixtures
//
// Every fixture below is authored from scratch: generic parties, generic
// obligations, no borrowed prose. The check compares run properties, so a
// fixture only has to carry a consistent formatting pattern and a divergence
// from it — nothing about any real document is needed to exercise that. The
// two committed corpus documents are used only as read-only evidence that the
// matcher finds real conventions in the wild.
// ---------------------------------------------------------------------------

type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  rStyle?: string;
  boldOff?: boolean;
};

function rPr(style: RunStyle): string {
  const parts: string[] = [];
  if (style.rStyle) parts.push(`<w:rStyle w:val="${style.rStyle}"/>`);
  if (style.boldOff) parts.push(`<w:b w:val="0"/>`);
  if (style.bold) parts.push('<w:b/>');
  if (style.italic) parts.push('<w:i/>');
  if (style.underline) parts.push('<w:u w:val="single"/>');
  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function docXml(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

/**
 * A paragraph carrying one parenthetical defined term formatted as `style`.
 * The quote marks deliberately sit in the neighbouring plain runs, which is
 * the shape both corpus agreements use.
 */
function definedTermParagraph(index: number, style: RunStyle): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">Section ${index}. The receiving party (the “</w:t></w:r>` +
    `<w:r>${rPr(style)}<w:t>Term ${index}</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve">”) shall act reasonably.</w:t></w:r>` +
    `</w:p>`
  );
}

/** A paragraph carrying one semicolon-introduced proviso keyword. */
function provisoParagraph(index: number, style: RunStyle): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">Section ${index}. The party may assign; </w:t></w:r>` +
    `<w:r>${rPr(style)}<w:t>provided</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> that notice is given.</w:t></w:r>` +
    `</w:p>`
  );
}

const TARGET_PLAIN =
  `<w:p><w:r><w:t xml:space="preserve">The fee is payable on demand.</w:t></w:r></w:p>`;

/** `w:ins` wrapper attributed to `author`; `runs` is raw run XML. */
function ins(id: number, runs: string, author = AI): string {
  return `<w:ins w:id="${id}" w:author="${author}" w:date="2026-08-12T00:00:00Z">${runs}</w:ins>`;
}

/** A paragraph whose defined term sits inside a `w:ins` attributed to `author`. */
function insertedDefinedTermParagraph(style: RunStyle, opts?: { id?: number; author?: string }): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">The fee is payable</w:t></w:r>` +
    ins(
      opts?.id ?? 900,
      `<w:r>${rPr(style)}<w:t xml:space="preserve"> (each, a “Fee Item”)</w:t></w:r>`,
      opts?.author ?? AI,
    ) +
    `<w:r><w:t xml:space="preserve"> on demand.</w:t></w:r>` +
    `</w:p>`
  );
}

/**
 * Same insertion, but the defined term is split across two runs with different
 * formatting and an equal share of the term's characters. Whichever fragment a
 * "pick the dominant run" rule chose, the other one would go unreported.
 */
function insertedSplitDefinedTermParagraph(head: RunStyle, tail: RunStyle): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">The fee is payable</w:t></w:r>` +
    ins(
      902,
      `<w:r>${rPr(head)}<w:t xml:space="preserve"> (each, a “Fee </w:t></w:r>` +
        `<w:r>${rPr(tail)}<w:t xml:space="preserve">Item”)</w:t></w:r>`,
    ) +
    `<w:r><w:t xml:space="preserve"> on demand.</w:t></w:r>` +
    `</w:p>`
  );
}

/** A paragraph whose proviso keyword sits inside a `w:ins`. */
function insertedProvisoParagraph(style: RunStyle): string {
  return (
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">The party may sublicense</w:t></w:r>` +
    ins(901, `<w:r>${rPr(style)}<w:t xml:space="preserve">; provided</w:t></w:r>`) +
    `<w:r><w:t xml:space="preserve"> that consent is obtained.</w:t></w:r>` +
    `</w:p>`
  );
}

const DEFINED_TERM_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W_NS}">` +
  `<w:style w:type="character" w:styleId="DefinedTerm">` +
  `<w:name w:val="Defined Term"/><w:rPr><w:b/><w:i/></w:rPr>` +
  `</w:style>` +
  `</w:styles>`;

async function loadDoc(body: string, extraFiles?: Record<string, string>): Promise<DocxDocument> {
  return DocxDocument.load(await makeDocxWithDocumentXml(docXml(body), extraFiles));
}

/** Visible text of every paragraph, in the same coordinates the check uses. */
function paragraphTexts(doc: DocxDocument): string[] {
  return doc.getParagraphs().map((p) => getParagraphRuns(p).map((r) => r.text).join(''));
}

/**
 * Counts derived from the fixture at runtime rather than written down: a
 * hardcoded "9 of 10" turns into a false green the moment the fixture drifts.
 */
function definedTermPopulation(doc: DocxDocument): number {
  return paragraphTexts(doc).reduce((n, text) => n + findInlineDefinedTermSpans(text).length, 0);
}

const INSERTED_DEFINED_TERM_TEXT = ' (each, a “Fee Item”)';
const INSERTED_PROVISO_TEXT = '; provided that consent is obtained.';

/** 9 bold-italic definitions and 1 plain one: a 90% convention, above the 80% bar. */
const CONVENTION_BODY = [
  ...Array.from({ length: 9 }, (_, i) => definedTermParagraph(i + 1, { bold: true, italic: true })),
  definedTermParagraph(10, {}),
].join('');

const PROVISO_CONVENTION_BODY = Array.from({ length: 6 }, (_, i) =>
  provisoParagraph(i + 1, { underline: true }),
).join('');

/**
 * Run the check the way the guard does: one document as it stood before the
 * mutation, one as it stands after.
 */
async function check(
  baselineBody: string,
  previewBody: string,
  insertedText: string,
  extraFiles?: Record<string, string>,
): Promise<string[]> {
  const baselineDoc = await loadDoc(baselineBody, extraFiles);
  const previewDoc = await loadDoc(previewBody, extraFiles);
  return checkFormattingConvention(previewDoc, { insertedText, aiAuthor: AI, baselineDoc }).map(
    (w) => w.message,
  );
}

async function openConventionSession(): Promise<Awaited<ReturnType<typeof openSession>>> {
  return openSession([], {
    mgr: new SessionManager({ defaultAiAuthor: AI }),
    xml: docXml(CONVENTION_BODY + TARGET_PLAIN),
    prefix: 'safe-docx-convention-',
  });
}

describe('formatting-convention matchers', () => {
  test('requires parenthetical enclosure and definitional phrasing, not merely quoted text', () => {
    expect(findInlineDefinedTermSpans('the parties (the “Agreement”) agree')).toHaveLength(1);
    expect(findInlineDefinedTermSpans('(each, a “Holder”)')).toHaveLength(1);
    expect(findInlineDefinedTermSpans('(collectively, the “Parties”)')).toHaveLength(1);
    expect(findInlineDefinedTermSpans('(the “Buyer” and the “Seller”)')).toHaveLength(2);
    // Quoted text outside a parenthetical, and quoted text inside a
    // parenthetical that is prose or a citation rather than a definition, must
    // not join the population — the mode is worthless computed over both.
    expect(findInlineDefinedTermSpans('he said “no” today')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('(see “Schedule 3” for detail)')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('(as amended, the “Note”, as restated)')).toHaveLength(0);
    // Prose between two quoted strings: neither is a definition.
    expect(findInlineDefinedTermSpans('(the “Buyer” shall notify the “Seller”)')).toHaveLength(0);
    expect(
      findInlineDefinedTermSpans('(the “Buyer” disputes the meaning of “Material”)'),
    ).toHaveLength(0);
  });

  test('spans the term itself, not its quote marks', () => {
    const text = 'the parties (the “Agreement”) agree';
    const [span] = findInlineDefinedTermSpans(text);
    expect(span).toBeDefined();
    expect(text.slice(span!.start, span!.end)).toBe('Agreement');
  });

  test('rejects nested and unbalanced parentheses', () => {
    expect(findInlineDefinedTermSpans('((the “Term”)')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('(the “Term” (as amended))')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('the “Term”)')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('(the “Term”')).toHaveLength(0);
  });

  test('does not treat curly single quotes as term delimiters', () => {
    // Supporting them needs apostrophe-aware scanning: ’ is also the
    // apostrophe, so (the ‘Company’s Assets’) would close at the possessive.
    expect(findInlineDefinedTermSpans('(the ‘Company’s Assets’)')).toHaveLength(0);
    expect(findInlineDefinedTermSpans('(the "Company\'s Assets")')).toHaveLength(1);
  });

  test('matches proviso keywords only when a semicolon introduces them', () => {
    expect(findProvisoKeywordSpans('may assign; provided that notice is given')).toHaveLength(1);
    expect(findProvisoKeywordSpans('may assign; however, notice is required')).toHaveLength(1);
    expect(findProvisoKeywordSpans('the party provided the notice')).toHaveLength(0);
    expect(findProvisoKeywordSpans('however the party acts')).toHaveLength(0);
  });

  test('is not left stateful by the global regexes it uses', () => {
    const text = '(each, a “Holder”); provided that notice is given';
    const first = [findInlineDefinedTermSpans(text).length, findProvisoKeywordSpans(text).length];
    const second = [findInlineDefinedTermSpans(text).length, findProvisoKeywordSpans(text).length];
    expect(second).toEqual(first);
    expect(first).toEqual([1, 1]);
  });
});

describe('formatting-convention detection on corpus documents', () => {
  test('finds a real, dominant convention in both committed corpus agreements', async () => {
    // These are the two public-source agreements the #687 cost measurements
    // were taken against. Nothing here is hardcoded: the population, the mode
    // and the share are all read off the documents at runtime. A matcher that
    // degraded into "any quoted text" would pull unrelated prose into the
    // population and the dominance would collapse below the threshold.
    for (const source of [NVCA_COI_SOURCE, ILPA_SOURCE]) {
      const doc = await DocxDocument.load(await fs.readFile(source));
      const texts = paragraphTexts(doc);
      const naiveQuotedParagraphs = texts.filter((t) => /[“"]/.test(t)).length;

      const terms = summarizeDocumentConvention(doc, 'inline_defined_term');
      expect(terms, `no defined-term convention found in ${path.basename(source)}`).not.toBeNull();
      expect(terms!.total).toBeGreaterThanOrEqual(DEFAULT_MIN_INSTANCES);
      expect(terms!.total).toBeLessThan(naiveQuotedParagraphs);
      expect(terms!.modeCount / terms!.total).toBeGreaterThanOrEqual(DEFAULT_DOMINANCE_THRESHOLD);

      const provisos = summarizeDocumentConvention(doc, 'proviso_keyword');
      expect(provisos, `no proviso convention found in ${path.basename(source)}`).not.toBeNull();
      expect(provisos!.modeCount / provisos!.total).toBeGreaterThanOrEqual(
        DEFAULT_DOMINANCE_THRESHOLD,
      );
    }
  });
});

describe('formatting-convention check', () => {
  test('NEGATIVE CONTROL: a seeded off-convention insertion makes the check go red', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let total = 0;
    let warnings: string[] = [];

    await given('a document whose defined terms are bold italic by convention', async () => {
      total = definedTermPopulation(await loadDoc(CONVENTION_BODY));
      expect(total).toBeGreaterThanOrEqual(DEFAULT_MIN_INSTANCES);
    });

    await when('a deliberately plain defined term is inserted', async () => {
      warnings = await check(
        CONVENTION_BODY + TARGET_PLAIN,
        CONVENTION_BODY + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      );
    });

    await then('exactly one divergence warning is produced', () => {
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(FORMATTING_CONVENTION_WARNING_CODE);
      expect(warnings[0]).toContain('inline defined term');
    });

    await and('it names the construct and the observed-versus-dominant properties', () => {
      const modeCount = total - 1; // one seeded off-convention pre-existing term
      const share = Math.round((modeCount / total) * 100);
      expect(warnings[0]).toContain('"Fee Item"');
      expect(warnings[0]).toContain('is bold=false, italic=false, underline=false');
      expect(warnings[0]).toContain(`${modeCount} of ${total} (${share}%)`);
      expect(warnings[0]).toContain('are bold=true, italic=true, underline=false');
    });
  });

  test('NEGATIVE CONTROL: the same fixture with an on-convention insertion is silent', async () => {
    expect(
      await check(
        CONVENTION_BODY + TARGET_PLAIN,
        CONVENTION_BODY + insertedDefinedTermParagraph({ bold: true, italic: true }),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toEqual([]);
  });

  test('reports a divergent fragment of a term split across runs', async () => {
    // Both fragments carry four of the term's characters, so no "largest
    // overlap" rule can see the plain tail. Each half is checked on its own.
    const tailPlain = await check(
      CONVENTION_BODY + TARGET_PLAIN,
      CONVENTION_BODY + insertedSplitDefinedTermParagraph({ bold: true, italic: true }, {}),
      INSERTED_DEFINED_TERM_TEXT,
    );
    expect(tailPlain).toHaveLength(1);
    expect(tailPlain[0]).toContain('is bold=false, italic=false, underline=false');

    const headPlain = await check(
      CONVENTION_BODY + TARGET_PLAIN,
      CONVENTION_BODY + insertedSplitDefinedTermParagraph({}, { bold: true, italic: true }),
      INSERTED_DEFINED_TERM_TEXT,
    );
    expect(headPlain).toHaveLength(1);

    // Positive control for the pair: when both fragments follow the convention
    // there is nothing to report.
    expect(
      await check(
        CONVENTION_BODY + TARGET_PLAIN,
        CONVENTION_BODY +
          insertedSplitDefinedTermParagraph(
            { bold: true, italic: true },
            { bold: true, italic: true },
          ),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toEqual([]);
  });

  test('does not blame this edit for an off-convention insertion an earlier edit left behind', async () => {
    // The session already carries a plain AI-authored "Fee Item". This edit
    // inserts a second, correctly formatted one. Attributing the old one to
    // this edit would report a divergence the caller cannot act on.
    const historical = insertedDefinedTermParagraph({}, { id: 800 });
    const added = insertedDefinedTermParagraph({ bold: true, italic: true }, { id: 801 });
    expect(
      await check(
        CONVENTION_BODY + historical,
        CONVENTION_BODY + historical + added,
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toEqual([]);

    // Mirror image, same fixture shape: the historical insertion is on
    // convention and the new one is not, so exactly one warning is due.
    const historicalGood = insertedDefinedTermParagraph({ bold: true, italic: true }, { id: 800 });
    const addedBad = insertedDefinedTermParagraph({}, { id: 801 });
    const warnings = await check(
      CONVENTION_BODY + historicalGood,
      CONVENTION_BODY + historicalGood + addedBad,
      INSERTED_DEFINED_TERM_TEXT,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('is bold=false, italic=false, underline=false');
  });

  test('is silent when the document has no clear mode', async () => {
    const split = [
      ...Array.from({ length: 3 }, (_, i) =>
        definedTermParagraph(i + 1, { bold: true, italic: true }),
      ),
      ...Array.from({ length: 3 }, (_, i) => definedTermParagraph(i + 4, {})),
    ].join('');

    expect(definedTermPopulation(await loadDoc(split))).toBeGreaterThanOrEqual(
      DEFAULT_MIN_INSTANCES,
    );
    expect(
      await check(
        split + TARGET_PLAIN,
        split + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toEqual([]);

    // Positive control on the same insertion: give the document a mode and the
    // identical edit is reported. The silence above is the threshold's doing,
    // not a broken pipeline.
    const decided =
      split +
      Array.from({ length: 13 }, (_, i) =>
        definedTermParagraph(i + 7, { bold: true, italic: true }),
      ).join('');
    expect(
      await check(
        decided + TARGET_PLAIN,
        decided + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toHaveLength(1);
  });

  test('is silent when too few comparable instances exist to call a convention', async () => {
    const sparse = Array.from({ length: DEFAULT_MIN_INSTANCES - 1 }, (_, i) =>
      definedTermParagraph(i + 1, { bold: true, italic: true }),
    ).join('');
    expect(definedTermPopulation(await loadDoc(sparse))).toBeLessThan(DEFAULT_MIN_INSTANCES);
    expect(
      await check(
        sparse + TARGET_PLAIN,
        sparse + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toEqual([]);

    // Positive control: one more instance clears the bar and the same edit is
    // reported, so the silence above is the count threshold and nothing else.
    const enough = sparse + definedTermParagraph(99, { bold: true, italic: true });
    expect(definedTermPopulation(await loadDoc(enough))).toBeGreaterThanOrEqual(
      DEFAULT_MIN_INSTANCES,
    );
    expect(
      await check(
        enough + TARGET_PLAIN,
        enough + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toHaveLength(1);
  });

  test('does not flag a run that inherits bold italic from a character style', async () => {
    // Deliberately asymmetric: the convention is declared directly on its runs,
    // the insertion carries the same appearance only through w:rStyle. A
    // declared-properties comparison reads the insertion as plain and fires;
    // only resolution through extractEffectiveRunFormatting stays silent. A
    // fixture where both sides used the style would pass either way.
    const styled = Array.from({ length: 6 }, (_, i) =>
      definedTermParagraph(i + 1, { bold: true, italic: true }),
    ).join('');
    expect(
      await check(
        styled + TARGET_PLAIN,
        styled + insertedDefinedTermParagraph({ rStyle: 'DefinedTerm' }),
        INSERTED_DEFINED_TERM_TEXT,
        { 'word/styles.xml': DEFINED_TERM_STYLES_XML },
      ),
    ).toEqual([]);
  });

  test('flags a styled run whose direct formatting turns the inherited bold off', async () => {
    const styled = Array.from({ length: 6 }, (_, i) =>
      definedTermParagraph(i + 1, { rStyle: 'DefinedTerm' }),
    ).join('');
    // Neither side declares w:b directly, so the whole comparison runs through
    // the style chain.
    expect(styled).not.toContain('<w:b/>');
    const warnings = await check(
      styled + TARGET_PLAIN,
      styled + insertedDefinedTermParagraph({ rStyle: 'DefinedTerm', boldOff: true }),
      INSERTED_DEFINED_TERM_TEXT,
      { 'word/styles.xml': DEFINED_TERM_STYLES_XML },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('is bold=false, italic=true, underline=false');
  });

  test('skips entirely when the inserted text carries no construct', async () => {
    // Same document and same off-convention insertion as the negative control
    // above; only the gate text differs, so a warning here would mean the gate
    // is not doing anything.
    const bodies = [CONVENTION_BODY + TARGET_PLAIN, CONVENTION_BODY + insertedDefinedTermParagraph({})] as const;
    expect(await check(bodies[0], bodies[1], 'the fee is payable on demand')).toEqual([]);
    expect(await check(bodies[0], bodies[1], INSERTED_DEFINED_TERM_TEXT)).toHaveLength(1);
  });

  test('ignores insertions attributed to another author', async () => {
    const foreign = insertedDefinedTermParagraph({}, { author: 'Someone Else' });
    expect(
      await check(CONVENTION_BODY + TARGET_PLAIN, CONVENTION_BODY + foreign, INSERTED_DEFINED_TERM_TEXT),
    ).toEqual([]);
    // Positive control: the identical insertion attributed to this session's
    // author is reported, so the silence above is the author test.
    expect(
      await check(
        CONVENTION_BODY + TARGET_PLAIN,
        CONVENTION_BODY + insertedDefinedTermParagraph({}),
        INSERTED_DEFINED_TERM_TEXT,
      ),
    ).toHaveLength(1);
  });

  test('warns on an off-convention proviso keyword', async () => {
    const warnings = await check(
      PROVISO_CONVENTION_BODY + TARGET_PLAIN,
      PROVISO_CONVENTION_BODY + insertedProvisoParagraph({}),
      INSERTED_PROVISO_TEXT,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('proviso keyword');
    expect(warnings[0]).toContain('are bold=false, italic=false, underline=true');

    expect(
      await check(
        PROVISO_CONVENTION_BODY + TARGET_PLAIN,
        PROVISO_CONVENTION_BODY + insertedProvisoParagraph({ underline: true }),
        INSERTED_PROVISO_TEXT,
      ),
    ).toEqual([]);
  });
});

describe('formatting-convention warnings on the edit path', () => {
  registerCleanup();

  test('replace_text surfaces the warning and still applies the edit', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let result: Awaited<ReturnType<typeof replaceText>>;

    await given('a session on a document with a bold-italic defined-term convention', async () => {
      opened = await openConventionSession();
    });

    await when('an edit inserts a plain parenthetical defined term', async () => {
      result = await replaceText(opened.mgr, {
        file_path: opened.filePath,
        target_paragraph_id: opened.paraIds[opened.paraIds.length - 1]!,
        old_string: 'The fee is payable',
        new_string: 'The fee is payable' + INSERTED_DEFINED_TERM_TEXT,
        instruction: 'introduce a defined term for the fee',
      });
    });

    await then('the edit succeeds — the check never blocks', () => {
      assertSuccess(result, 'replace_text');
      expect(result.replacements_made).toBe(1);
    });

    await and('the divergence is reported on the warnings channel', () => {
      const warnings = (result.warnings ?? []) as string[];
      expect(warnings.some((w) => w.startsWith(FORMATTING_CONVENTION_WARNING_CODE))).toBe(true);
    });
  });

  test('replace_text stays silent for an edit that introduces no construct', async () => {
    const opened = await openConventionSession();
    const result = await replaceText(opened.mgr, {
      file_path: opened.filePath,
      target_paragraph_id: opened.paraIds[opened.paraIds.length - 1]!,
      old_string: 'on demand',
      new_string: 'on thirty days notice',
      instruction: 'lengthen the payment window',
    });

    assertSuccess(result, 'replace_text');
    const warnings = (result.warnings ?? []) as string[];
    expect(warnings.some((w) => w.startsWith(FORMATTING_CONVENTION_WARNING_CODE))).toBe(false);
  });

  test('insert_paragraph surfaces the warning on its success response', async () => {
    const opened = await openConventionSession();
    const result = await insertParagraph(opened.mgr, {
      file_path: opened.filePath,
      positional_anchor_node_id: opened.paraIds[opened.paraIds.length - 1]!,
      new_string: 'Interest accrues on each late payment (each, a “Fee Item”) monthly.',
      instruction: 'add an interest sentence introducing a defined term',
    });

    assertSuccess(result, 'insert_paragraph');
    const warnings = (result.warnings ?? []) as string[];
    expect(warnings.some((w) => w.startsWith(FORMATTING_CONVENTION_WARNING_CODE))).toBe(true);
  });

  test('batch_edit reports the warning against the step that caused it', async () => {
    const opened = await openConventionSession();
    const targetId = opened.paraIds[opened.paraIds.length - 1]!;

    const result = await batchEdit(opened.mgr, {
      file_path: opened.filePath,
      steps: [
        {
          step_id: 'shorten-notice',
          operation: 'replace_text',
          target_paragraph_id: targetId,
          old_string: 'on demand',
          new_string: 'on notice',
          instruction: 'shorten the payment trigger',
        },
        {
          step_id: 'define-fee',
          operation: 'replace_text',
          target_paragraph_id: targetId,
          old_string: 'The fee is payable',
          new_string: 'The fee is payable' + INSERTED_DEFINED_TERM_TEXT,
          instruction: 'introduce a defined term for the fee',
        },
      ],
    });

    assertSuccess(result, 'batch_edit');
    const warnings = (result.warnings ?? []) as Array<{ step_id: string; warning: string }>;
    const convention = warnings.filter((w) =>
      w.warning.startsWith(FORMATTING_CONVENTION_WARNING_CODE),
    );
    expect(convention).toHaveLength(1);
    expect(convention[0]!.step_id).toBe('define-fee');
  });
});
