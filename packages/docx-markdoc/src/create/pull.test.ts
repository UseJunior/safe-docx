import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { COMPLETE_PAGE_FIELD } from '../../../docx-core/src/testing/ooxml-fixtures.js';
import { runCli } from '../cli-run.js';
import type { PdfRenderTools } from '../pdf/tools.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';
import { pullCreationEdits, type PullChange, type PullResult } from './pull.js';
import { readPullDocx, type PullStory } from './pull-docx.js';
import { readCreatedDocx } from './readback.js';

const TEST_FEATURE = 'add-markdoc-create-pull';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1223 pull Word edits on a create output back into its creation source',
  severity: 'critical',
});

const noPdf: PdfRenderTools = { resolve: () => null, run: async () => ({ code: 1, stdout: '', stderr: '' }) };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A synthetic engagement letter that uses the creation markup pull must keep. */
const LETTER = [
  '---',
  'title: Engagement Letter',
  'author: Jane Roe',
  'page-numbers: true',
  '---',
  '',
  '# ENGAGEMENT LETTER',
  '',
  'Dear Client:',
  '',
  '**Re: Acme Matter**',
  '',
  'This letter confirms the terms of our engagement and the fees we charge for the work.',
  '',
  '## Fees',
  '',
  '## Scope {% #scope %}',
  '',
  'We will advise the "Company" on the {% fill %}Transaction{% /fill %} under {% xref to="scope" show="text" /%} and nothing else.',
  '',
  'The {% u %}Purchase Price{% /u %} is payable in cash at closing, plus **all costs** we incur.',
  '',
  '1. First item of work',
  '2. Second item of work',
  '',
  '> A quoted remark for the record.',
  '',
  '{% section footer="Acceptance Page" /%}',
  '',
  '{% signer name="Jane Roe" date="Date: ________" /%}',
  '',
].join('\n');

/** The 1-based line of the first source line containing `needle`. */
function lineOf(source: string, needle: string): number {
  const index = source.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`no line holds ${needle}`);
  return index + 1;
}

type Surgery = {
  /** Rewrites of word/document.xml. */
  document?: (xml: string) => string;
  /** Rewrites of other parts by name. */
  parts?: Record<string, (xml: string) => string>;
  /** New parts. */
  add?: Record<string, string>;
  /** New document relationships: id, type (last path segment) and target. */
  relationships?: Array<[string, string, string]>;
};

/** Edit a DOCX by XML surgery, as a reviewer's save would, and return the new bytes. */
async function edit(docx: Buffer, surgery: Surgery): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  if (surgery.document) zip.file('word/document.xml', surgery.document(await zip.file('word/document.xml')!.async('string')));
  for (const [name, rewrite] of Object.entries(surgery.parts ?? {})) zip.file(name, rewrite(await zip.file(name)!.async('string')));
  for (const [name, xml] of Object.entries(surgery.add ?? {})) zip.file(name, xml);
  if (surgery.relationships) {
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const added = surgery.relationships.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${target}"/>`).join('');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', `${added}</Relationships>`));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Replace exactly one occurrence, so a surgery that misses its target fails loudly. */
function once(xml: string, before: string, after: string): string {
  const at = xml.indexOf(before);
  if (at === -1 || xml.indexOf(before, at + 1) !== -1) throw new Error(`surgery target must occur once: ${before}`);
  return xml.slice(0, at) + after + xml.slice(at + before.length);
}

/** The w:p element whose text run holds `text`. */
function paragraphHolding(xml: string, text: string): string {
  const at = xml.indexOf(`>${text}<`);
  if (at === -1) throw new Error(`no paragraph holds ${text}`);
  const start = xml.lastIndexOf('<w:p>', at);
  const end = xml.indexOf('</w:p>', at) + '</w:p>'.length;
  return xml.slice(start, end);
}

const bodyParagraph = (text: string, style = 'BodyText', runProperties = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const header = (lines: string[], jc = 'right') => `<w:hdr ${W_NS}>${lines.map((line) => `<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="${jc}"/></w:pPr><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join('')}</w:hdr>`;
/** A Word-style "Page X of Y" footer: the page number a complex field inside a content control, NUMPAGES a simple field (the shape under test). */
const pageOfTotalFooter = `<w:ftr ${W_NS}><w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r>${COMPLETE_PAGE_FIELD}<w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p></w:sdtContent></w:sdt></w:ftr>`;

/** Add a header part to the first section. */
function withFirstSectionHeader(lines: string[], jc = 'right'): Surgery {
  return {
    // The first w:sectPr is the first section's; later sections inherit the header.
    document: (xml) => xml.replace('<w:sectPr>', '<w:sectPr><w:headerReference w:type="default" r:id="rIdPullHeader"/>'),
    add: { 'word/headerPull.xml': header(lines, jc) },
    relationships: [['rIdPullHeader', 'header', 'headerPull.xml']],
  };
}

/** Compose surgeries in order. */
function all(...surgeries: Surgery[]): Surgery {
  return {
    document: (xml) => surgeries.reduce((out, surgery) => (surgery.document ? surgery.document(out) : out), xml),
    parts: Object.assign({}, ...surgeries.map((surgery) => surgery.parts ?? {})),
    add: Object.assign({}, ...surgeries.map((surgery) => surgery.add ?? {})),
    relationships: surgeries.flatMap((surgery) => surgery.relationships ?? []),
  };
}

/**
 * One known edit: the surgery that makes it, the change pull must report
 * (its kind and source line), and whether the creation grammar expresses it.
 */
type Mutation = {
  name: string;
  surgery: Surgery;
  expect: Array<{ kind: PullChange['kind']; line: number }>;
  /** Diagnostic codes that must be raised; empty for an edit pull writes in full. */
  diagnostics: string[];
};

const FIRST_SECTION_PARAGRAPH = '<w:p><w:pPr><w:pStyle w:val="Quote"/><w:sectPr>';

const MUTATIONS: Mutation[] = [
  {
    name: 'a wording change',
    surgery: { document: (xml) => once(xml, 'the fees we charge for the work', 'the charges we bill for the work') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, 'the fees we charge') }],
    diagnostics: [],
  },
  {
    name: 'a defined-term change',
    surgery: { document: (xml) => once(xml, 'We will advise the "Company" on the ', 'We will advise the "Client" on the ') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '"Company"') }],
    diagnostics: [],
  },
  {
    name: 'a deleted heading',
    surgery: { document: (xml) => once(xml, paragraphHolding(xml, 'Fees'), '') },
    expect: [{ kind: 'deleted', line: lineOf(LETTER, '## Fees') }],
    diagnostics: [],
  },
  {
    name: 'an added paragraph',
    surgery: { document: (xml) => once(xml, paragraphHolding(xml, 'Dear Client:'), `${paragraphHolding(xml, 'Dear Client:')}${bodyParagraph('Thank you for choosing us.')}`) },
    expect: [{ kind: 'added', line: lineOf(LETTER, 'Dear Client:') }],
    diagnostics: [],
  },
  {
    name: 'a fill-in filled inside its brackets',
    surgery: { document: (xml) => once(xml, '[Transaction]', '[Merger]') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '{% fill %}') }],
    diagnostics: [],
  },
  {
    name: 'an edit inside underlined and bold text',
    surgery: { document: (xml) => once(once(xml, '>Purchase Price<', '>Purchase Amount<'), '>Re: Acme Matter<', '>Re: Acme Holdings Matter<') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '{% u %}') }, { kind: 'changed', line: lineOf(LETTER, '**Re:') }],
    diagnostics: [],
  },
  {
    name: 'a list item edited, one deleted and one added',
    surgery: {
      document: (xml) => {
        const first = paragraphHolding(xml, 'First item of work');
        const second = paragraphHolding(xml, 'Second item of work');
        return once(once(xml, first, ''), second, `${second.replace('Second item of work', 'Second item of legal work')}${second.replace('Second item of work', 'Review the closing documents')}`);
      },
    },
    expect: [
      { kind: 'changed', line: lineOf(LETTER, '2. Second item') },
      { kind: 'deleted', line: lineOf(LETTER, '1. First item') },
      { kind: 'added', line: lineOf(LETTER, '2. Second item') },
    ],
    diagnostics: [],
  },
  {
    name: 'a signer name changed',
    surgery: { document: (xml) => once(xml, '>Jane Roe<', '>Jane Q. Roe<') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '{% signer') }],
    diagnostics: [],
  },
  {
    name: 'an added running header and a Page X of Y footer',
    surgery: all(withFirstSectionHeader(['Acme Matter | Engagement Letter']), { parts: { 'word/footer1.xml': () => pageOfTotalFooter } }),
    expect: [{ kind: 'running-text', line: 1 }, { kind: 'running-text', line: 1 }],
    diagnostics: [],
  },
  {
    name: 'a changed footer on the second section',
    surgery: { parts: { 'word/footer2.xml': (xml) => once(xml, 'Acceptance Page', 'Acceptance and Signature Page') } },
    expect: [{ kind: 'running-text', line: lineOf(LETTER, '{% section') }],
    diagnostics: [],
  },
  {
    // What Word for Mac 16 does to an unedited create output on save: it states the built-in heading outline levels and drops a redundant left alignment.
    name: 'a Word save restating style defaults',
    surgery: {
      parts: {
        'word/styles.xml': (xml) => once(once(xml, '<w:pPr><w:keepNext/><w:spacing w:before="200"/></w:pPr>', '<w:pPr><w:keepNext/><w:spacing w:before="200"/><w:outlineLvl w:val="0"/></w:pPr>'), '<w:spacing w:before="600"/><w:jc w:val="left"/></w:pPr>', '<w:spacing w:before="600"/></w:pPr>'),
      },
    },
    expect: [],
    diagnostics: [],
  },
  // Edits the creation grammar cannot express, or pull cannot place: each must be diagnosed.
  {
    name: 'a style re-aligned',
    surgery: { parts: { 'word/styles.xml': (xml) => once(xml, '<w:spacing w:before="600"/><w:jc w:val="left"/></w:pPr>', '<w:spacing w:before="600"/><w:jc w:val="center"/></w:pPr>') } },
    expect: [],
    diagnostics: ['PULL_STYLE_CHANGED'],
  },
  {
    name: 'an edit inside a cross-reference result',
    surgery: { document: (xml) => once(xml, '<w:t xml:space="preserve">Scope</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>', '<w:t xml:space="preserve">Scoping</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '{% xref') }],
    diagnostics: ['PULL_EDIT_IN_CROSS_REFERENCE'],
  },
  {
    name: 'changed page margins',
    surgery: { document: (xml) => xml.replaceAll('w:left="1440"', 'w:left="1800"') },
    expect: [],
    diagnostics: ['PULL_PAGE_SETUP'],
  },
  {
    name: 'a word made bold',
    surgery: { document: (xml) => once(xml, '<w:r><w:t xml:space="preserve">Dear Client:</w:t></w:r>', '<w:r><w:t xml:space="preserve">Dear </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Client:</w:t></w:r>') },
    expect: [],
    diagnostics: ['PULL_DIRECT_FORMATTING'],
  },
  {
    name: 'a paragraph re-aligned',
    surgery: { document: (xml) => once(xml, `<w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t xml:space="preserve">Dear Client:`, `<w:pPr><w:pStyle w:val="BodyText"/><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">Dear Client:`) },
    expect: [],
    diagnostics: ['PULL_PARAGRAPH_FORMATTING'],
  },
  {
    name: 'a comment',
    surgery: {
      document: (xml) => once(xml, '<w:r><w:t xml:space="preserve">Dear Client:</w:t></w:r>', '<w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">Dear Client:</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>'),
      add: { 'word/comments.xml': `<w:comments ${W_NS}><w:comment w:id="0" w:author="Reviewer"><w:p><w:r><w:t>Check the salutation.</w:t></w:r></w:p></w:comment></w:comments>` },
      relationships: [['rIdPullComments', 'comments', 'comments.xml']],
    },
    expect: [],
    diagnostics: ['PULL_COMMENTS'],
  },
  {
    name: 'a two-line header',
    surgery: withFirstSectionHeader(['Acme Matter', 'Engagement Letter']),
    expect: [{ kind: 'running-text', line: 1 }],
    diagnostics: ['PULL_HEADER_UNMAPPED'],
  },
  {
    name: 'a tab typed into a paragraph',
    surgery: { document: (xml) => once(xml, '>Dear Client:<', '>Dear</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Client:<') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, 'Dear Client:') }],
    diagnostics: ['PULL_UNEXPRESSIBLE_TEXT'],
  },
  {
    name: 'an edit that empties a fill-in bracket',
    surgery: { document: (xml) => once(xml, '[Transaction]', 'Transaction]') },
    expect: [{ kind: 'changed', line: lineOf(LETTER, '{% fill %}') }],
    diagnostics: ['PULL_EDIT_CROSSES_MARKUP'],
  },
];

/**
 * Body paragraphs, read by create's own read-back, and each section's header
 * and footer text, read by pull's reader (create's read-back does not descend
 * the content control Word wraps a page-number footer in).
 */
async function readbackText(docx: Buffer) {
  const readback = await readCreatedDocx(docx);
  const stories = await readPullDocx(docx);
  const lines = (list: PullStory[]) => list.map((story) => (story ?? []).map((paragraph) => paragraph.text).filter((line) => line.trim()));
  return { paragraphs: readback.paragraphs, headers: lines(stories.headers), footers: lines(stories.footers) };
}

/**
 * The harness's account of one pull, which must hold for every mutation:
 * each expected change is reported at its source line, and nothing is lost
 * in silence. Either the pull is complete, its pulled source rebuilding (with
 * every create check) to the edited DOCX's body text, headers and footers,
 * or a diagnostic names what it did not write. Returns the problems found;
 * the negative controls feed it doctored results and require problems.
 */
async function account(mutation: Mutation, result: PullResult, editedDocx: Buffer): Promise<string[]> {
  const problems: string[] = [];
  for (const expected of mutation.expect) {
    const matches = result.changes.filter((change) => change.kind === expected.kind && (change.kind === 'added' ? change.afterLine === expected.line : change.line === expected.line));
    if (matches.length === 0) problems.push(`${mutation.name}: no ${expected.kind} change reported at line ${expected.line}`);
  }
  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));
  for (const code of mutation.diagnostics) if (!codes.has(code)) problems.push(`${mutation.name}: diagnostic ${code} missing`);
  if (mutation.diagnostics.length === 0 && result.diagnostics.length > 0) problems.push(`${mutation.name}: unexpected diagnostics ${result.diagnostics.map((d) => d.code).join(', ')}`);
  if (result.complete) {
    if (result.diagnostics.length > 0) problems.push(`${mutation.name}: complete with diagnostics`);
    if (result.pulledSource === undefined && result.changes.length > 0) problems.push(`${mutation.name}: complete without a pulled source`);
    if (result.pulledSource !== undefined) {
      const rebuilt = await createDocumentFromMarkdoc(result.pulledSource);
      const [got, want] = [await readbackText(rebuilt.docx), await readbackText(editedDocx)];
      if (JSON.stringify(got.paragraphs) !== JSON.stringify(want.paragraphs)) problems.push(`${mutation.name}: rebuild body ${JSON.stringify(got.paragraphs)} is not the edited ${JSON.stringify(want.paragraphs)}`);
      const visible = (text: Awaited<ReturnType<typeof readbackText>>) => JSON.stringify([text.headers[0] ?? [], text.footers.map((footer, index) => footer.length ? footer : text.footers[index - 1] ?? [])]);
      if (visible(got) !== visible(want)) problems.push(`${mutation.name}: rebuild running text ${visible(got)} is not the edited ${visible(want)}`);
    }
  } else if (result.diagnostics.length === 0) {
    problems.push(`${mutation.name}: incomplete without a diagnostic, so something was dropped silently`);
  }
  return problems;
}

/** The creation markup a pulled source must keep wherever it was not edited. */
const KEPT_MARKUP = ['---\ntitle: Engagement Letter\nauthor: Jane Roe\n', '{% section footer=', '{% signer name=', '{% fill %}', '{% /fill %}', '{% xref to="scope" show="text" /%}', '{% u %}', '**all costs**', '## Scope {% #scope %}', '> A quoted remark', '2. Second item'];

async function build(source = LETTER) {
  return createDocumentFromMarkdoc(source);
}

async function scratch(prefix: string): Promise<string> {
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

type CliRun = { code: number; stdout: string; stderr: string };
async function cli(argv: string[]): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } });
  return { code, stdout, stderr };
}

describe('Traceability: pull brings Word edits on a create output back into its creation source', () => {
  test.openspec('[SDX-MDOC-PULL-01] each known edit is reported at its source line and nothing is dropped silently')(
    'Scenario: each known edit is reported at its source line and nothing is dropped silently',
    async () => {
      const base = await build();
      for (const mutation of MUTATIONS) {
        const edited = await edit(base.docx, mutation.surgery);
        const result = await pullCreationEdits({ source: LETTER, base, edited });
        expect(await account(mutation, result, edited), mutation.name).toEqual([]);
        if (mutation.diagnostics.length === 0 && mutation.expect.length === 0) {
          // Nothing to pull: no change, no diagnostic, nothing to write.
          expect(result, mutation.name).toMatchObject({ changes: [], diagnostics: [], complete: true });
          expect(result.pulledSource, mutation.name).toBeUndefined();
        } else if (mutation.diagnostics.length === 0) {
          expect(result.complete, mutation.name).toBe(true);
          for (const kept of KEPT_MARKUP.filter((markup) => !(mutation.name.includes('list') && markup.startsWith('2.')))) expect(result.pulledSource, `${mutation.name} keeps ${kept}`).toContain(kept);
        } else {
          expect(result.complete, mutation.name).toBe(false);
        }
      }
      // Deleting the first item of an ordered list hands its marker on, so the list still starts at 1.
      const list = await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, MUTATIONS[6]!.surgery) });
      expect(list.pulledSource).toContain('1. Second item of legal work\n2. Review the closing documents\n\n> A quoted remark');
      // The issue's scenario at once: wording, a defined term, a deleted heading, and an added header and page-number footer.
      const together = all(MUTATIONS[0]!.surgery, MUTATIONS[1]!.surgery, MUTATIONS[2]!.surgery, MUTATIONS[8]!.surgery);
      const edited = await edit(base.docx, together);
      const combined: Mutation = { name: 'the issue scenario', surgery: together, expect: [...MUTATIONS[0]!.expect, ...MUTATIONS[1]!.expect, ...MUTATIONS[2]!.expect, ...MUTATIONS[8]!.expect], diagnostics: [] };
      const result = await pullCreationEdits({ source: LETTER, base, edited });
      expect(await account(combined, result, edited)).toEqual([]);
      expect(result.complete).toBe(true);
      expect(result.pulledSource).toContain('header: Acme Matter | Engagement Letter\nheader-align: right\npage-numbers: true\npage-number-format: page-of-total\n---');
      expect(result.pulledSource).not.toContain('## Fees');

      // Negative controls: the account must fail when pull misses an edit, a line, or drops a diagnostic.
      const reported = await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, MUTATIONS[2]!.surgery) });
      const blind = { ...reported, changes: reported.changes.filter((change) => change.kind !== 'deleted') };
      expect(await account(MUTATIONS[2]!, blind, await edit(base.docx, MUTATIONS[2]!.surgery))).not.toEqual([]);
      const misplaced = { ...reported, changes: reported.changes.map((change) => ({ ...change, line: (change as { line: number }).line + 1 })) };
      expect(await account(MUTATIONS[2]!, misplaced, await edit(base.docx, MUTATIONS[2]!.surgery))).not.toEqual([]);
      const margins = MUTATIONS.find((mutation) => mutation.name === 'changed page margins')!;
      const marginsEdited = await edit(base.docx, margins.surgery);
      const silent = { ...(await pullCreationEdits({ source: LETTER, base, edited: marginsEdited })), diagnostics: [] };
      expect(await account(margins, silent, marginsEdited)).not.toEqual([]);
      // A pull that claimed completeness for an edit it did not write is caught by the rebuild comparison.
      const wording = await edit(base.docx, MUTATIONS[0]!.surgery);
      const dropped: PullResult = { changes: [], diagnostics: [], complete: true, pulledSource: LETTER };
      expect(await account({ ...MUTATIONS[0]!, expect: [] }, dropped, wording)).not.toEqual([]);
    },
    60_000,
  );

  test.openspec('[SDX-MDOC-PULL-02] pull --apply writes a new .mdoc that keeps the creation markup and rebuilds to the edited body')(
    'Scenario: pull --apply writes a new .mdoc that keeps the creation markup and rebuilds to the edited body',
    async () => {
      const dir = await scratch('sdx-pull-apply-');
      try {
        const source = path.join(dir, 'letter.mdoc');
        await writeFile(source, LETTER);
        const out = path.join(dir, 'out');
        await runCreateCommand([source, out, '--no-pdf'], { renderTools: noPdf });
        const docx = path.join(out, 'letter.docx');
        const editedBytes = await edit(await readFile(docx), all(MUTATIONS[0]!.surgery, MUTATIONS[2]!.surgery, MUTATIONS[3]!.surgery));
        await writeFile(docx, editedBytes);

        const report = await cli(['pull', docx, source]);
        expect(report.code).toBe(2);
        expect(report.stderr).toBe('');
        expect(report.stdout).toContain(`line ${lineOf(LETTER, 'the fees we charge')}: paragraph 4 changed: "fees" -> "charges"`);
        expect(report.stdout).toContain(`line ${lineOf(LETTER, '## Fees')}: paragraph 5 deleted: "Fees"`);
        expect(report.stdout).toContain(`after line ${lineOf(LETTER, 'Dear Client:')}: 1 paragraph(s) added after paragraph 2: "Thank you for choosing us."`);
        expect(await readdir(dir)).toEqual(['letter.mdoc', 'out']);

        const applied = await cli(['pull', docx, source, '--apply', '--json']);
        expect(applied.code).toBe(2);
        const json = JSON.parse(applied.stdout);
        expect(json).toMatchObject({ complete: true, output: path.join(dir, 'letter.pulled.mdoc'), record: path.join(out, 'letter.pull.json') });
        expect(await readFile(source, 'utf8')).toBe(LETTER);
        const pulled = await readFile(path.join(dir, 'letter.pulled.mdoc'), 'utf8');
        for (const kept of KEPT_MARKUP) expect(pulled).toContain(kept);
        const rebuilt = await createDocumentFromMarkdoc(pulled);
        expect(rebuilt.readback.paragraphs).toEqual((await readCreatedDocx(editedBytes)).paragraphs);
        // The output is never overwritten.
        const again = await cli(['pull', docx, source, '--apply']);
        expect(again.code).toBe(1);
        expect(again.stderr).toMatch(/^ERROR EEXIST: /u);
        // An unchanged DOCX: nothing to report, exit 0.
        await runCreateCommand([source, path.join(dir, 'fresh'), '--no-pdf'], { renderTools: noPdf });
        const clean = await cli(['pull', path.join(dir, 'fresh', 'letter.docx'), source]);
        expect(clean).toMatchObject({ code: 0, stderr: '' });
        expect(clean.stdout).toContain('no changes');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.openspec('[SDX-MDOC-PULL-03] an edit across markup is split or diagnosed, never written into the markup')(
    'Scenario: an edit across markup is split or diagnosed, never written into the markup',
    async () => {
      const source = ['Plain **bold words** tail and {% fill %}Name{% /fill %} here.', ''].join('\n');
      const base = await build(source);
      const run = async (surgery: Surgery) => pullCreationEdits({ source, base, edited: await edit(base.docx, surgery) });
      // Deleting across the bold boundary deletes from each side and keeps the markup.
      const split = await run({ document: (xml) => once(once(xml, '>Plain <', '>Plai<'), '>bold words<', '>ld words<') });
      expect(split.complete).toBe(true);
      expect(split.pulledSource).toBe('Plai**ld words** tail and {% fill %}Name{% /fill %} here.\n');
      // New text across the boundary goes into the side whose formatting it has.
      const into = await run({ document: (xml) => once(once(xml, '>Plain <', '>Plain and </w:t></w:r><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">very <'), '>bold words<', '>bold words<') });
      expect(into.complete).toBe(true);
      expect(into.pulledSource).toBe('Plain and **very bold words** tail and {% fill %}Name{% /fill %} here.\n');
      // Filling in a fill-in entirely (its brackets typed over) replaces the whole tag.
      const filled = await run({ document: (xml) => once(xml, '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">[Name]</w:t></w:r>', '<w:r><w:t xml:space="preserve">Acme Corp</w:t></w:r>') });
      expect(filled.complete).toBe(true);
      expect(filled.pulledSource).toBe('Plain **bold words** tail and Acme Corp here.\n');
      // Deleting all of the bold text deletes the bold markup with it.
      const unbolded = await run({ document: (xml) => once(xml, '>bold words<', '><') });
      expect(unbolded.complete).toBe(true);
      expect(unbolded.pulledSource).toBe('Plain  tail and {% fill %}Name{% /fill %} here.\n');
      // Emptying a fill-in inside its brackets would leave an empty tag: diagnosed, and the paragraph is not written.
      const emptied = await run({ document: (xml) => once(xml, '[Name]', '[]') });
      expect(emptied.complete).toBe(false);
      expect(emptied.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['PULL_EDIT_CROSSES_MARKUP']);
      expect(emptied.changes).toMatchObject([{ kind: 'changed', applied: false }]);
      expect(emptied.pulledSource).toBeUndefined();
      // Characters Markdown would read as markup are escaped.
      const escaped = await run({ document: (xml) => once(xml, '> tail and <', '> tail *and* [x] {% y %} and <') });
      expect(escaped.complete).toBe(true);
      expect(escaped.pulledSource).toBe('Plain **bold words** tail \\*and\\* \\[x\\] \\{% y %\\} and {% fill %}Name{% /fill %} here.\n');
    },
    60_000,
  );

  test.openspec('[SDX-MDOC-PULL-04] tracked changes and a mismatched certificate or source are refused with exit code 1')(
    'Scenario: tracked changes and a mismatched certificate or source are refused with exit code 1',
    async () => {
      const dir = await scratch('sdx-pull-refuse-');
      try {
        const source = path.join(dir, 'letter.mdoc');
        await writeFile(source, LETTER);
        const out = path.join(dir, 'out');
        await runCreateCommand([source, out, '--no-pdf'], { renderTools: noPdf });
        const docx = path.join(out, 'letter.docx');
        const built = await readFile(docx);
        await writeFile(docx, await edit(built, { document: (xml) => once(xml, '<w:r><w:t xml:space="preserve">Dear Client:</w:t></w:r>', '<w:ins w:id="90" w:author="Reviewer"><w:r><w:t xml:space="preserve">Dear Client:</w:t></w:r></w:ins>') }));
        const tracked = await cli(['pull', docx, source, '--apply']);
        expect(tracked.code).toBe(1);
        expect(tracked.stderr).toMatch(/^ERROR PULL_TRACKED_CHANGES: The edited DOCX holds tracked changes \(1 w:ins\)\. Accept or reject them in Word/u);
        expect(await readdir(dir)).toEqual(['letter.mdoc', 'out']);

        await writeFile(docx, built);
        const changedSource = path.join(dir, 'other.mdoc');
        await writeFile(changedSource, `${LETTER}\nA later paragraph.\n`);
        expect((await cli(['pull', docx, changedSource])).stderr).toMatch(/^ERROR PULL_SOURCE_CHANGED: /u);
        const moved = path.join(dir, 'moved.docx');
        await writeFile(moved, built);
        expect((await cli(['pull', moved, source])).stderr).toMatch(/^ERROR PULL_CERTIFICATE_MISSING: .*--certificate/u);
        expect((await cli(['pull', moved, source, '--certificate', path.join(out, 'letter.verification.json')])).code).toBe(0);
        const usage = await cli(['pull', docx, source, '--output', path.join(dir, 'x.mdoc')]);
        expect(usage.code).toBe(1);
        expect(usage.stderr.trimEnd()).toMatch(/^ERROR CLI_USAGE: --output names the pulled \.mdoc, so it needs --apply\. Run 'docx-markdoc pull --help' for usage\.$/u);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.openspec('[SDX-MDOC-PULL-05] create --replace accepts the edited DOCX only after a complete pull of exactly the source it builds')(
    'Scenario: create --replace accepts the edited DOCX only after a complete pull of exactly the source it builds',
    async () => {
      const dir = await scratch('sdx-pull-replace-');
      try {
        const source = path.join(dir, 'letter.mdoc');
        await writeFile(source, LETTER);
        const out = path.join(dir, 'out');
        await runCreateCommand([source, out, '--no-pdf'], { renderTools: noPdf });
        const docx = path.join(out, 'letter.docx');
        const editedBytes = await edit(await readFile(docx), all(MUTATIONS[0]!.surgery, MUTATIONS[8]!.surgery));
        await writeFile(docx, editedBytes);
        const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: Error & { code?: string }) => error);

        // Before pull: refused, as always.
        expect(await failure(runCreateCommand([source, out, '--replace', '--no-pdf'], { renderTools: noPdf }))).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        expect((await cli(['pull', docx, source, '--apply'])).code).toBe(2);
        const record = JSON.parse(await readFile(path.join(out, 'letter.pull.json'), 'utf8'));
        expect(record).toMatchObject({ kind: 'markdoc-pull', complete: true, editedDocxSha256: sha256(editedBytes) });
        const pulled = path.join(dir, 'letter.pulled.mdoc');
        // The original source is still refused: the record names the pulled source, not this one.
        expect(await failure(runCreateCommand([source, out, '--replace', '--no-pdf'], { renderTools: noPdf }))).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        // A pulled source edited after the pull is refused too.
        const original = await readFile(pulled, 'utf8');
        await rename(source, path.join(dir, 'letter.before-pull.mdoc'));
        await writeFile(source, `${original}\nOne more paragraph.\n`);
        expect(await failure(runCreateCommand([source, out, '--replace', '--no-pdf'], { renderTools: noPdf }))).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        // Exactly the pulled source: accepted, every check passes, the edited bytes are kept, and the record goes.
        await writeFile(source, original);
        const rebuilt = await runCreateCommand([source, out, '--replace', '--no-pdf'], { renderTools: noPdf });
        expect(rebuilt.created.certificate.passed).toBe(true);
        expect(rebuilt.overwritten).toMatchObject({ pulled: true, sha256: sha256(editedBytes) });
        expect(await readFile(rebuilt.overwritten!.docx)).toEqual(editedBytes);
        expect(rebuilt.summary).toContain('replaced the edited letter.docx that pull reconciled into this source');
        expect(rebuilt.created.readback.paragraphs).toEqual((await readCreatedDocx(editedBytes)).paragraphs);
        await expect(readFile(path.join(out, 'letter.pull.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        // Normal use resumes: the next --replace rebuilds over the certified DOCX.
        await writeFile(source, original.replace('Dear Client:', 'Dear Valued Client:'));
        expect((await runCreateCommand([source, out, '--replace', '--no-pdf'], { renderTools: noPdf })).overwritten).toBeUndefined();

        // An incomplete pull writes no record, so --replace still refuses.
        await writeFile(docx, await edit(await readFile(docx), MUTATIONS.find((mutation) => mutation.name === 'changed page margins')!.surgery));
        const incomplete = await cli(['pull', docx, source, '--apply', '--output', path.join(dir, 'second.mdoc')]);
        expect(incomplete.code).toBe(2);
        expect(incomplete.stdout).toContain('DIAGNOSTIC PULL_PAGE_SETUP');
        await expect(readFile(path.join(out, 'letter.pull.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    90_000,
  );

  test.openspec('[SDX-MDOC-PULL-06] numbering, table structure, even-page running text and kept markup are never lost silently')(
    'Scenario: numbering, table structure, even-page running text and kept markup are never lost silently',
    async () => {
      const base = await build();
      const codes = (result: PullResult) => result.diagnostics.map((diagnostic) => diagnostic.code);
      // A list restarted at 7 in Word: alone, and beside an edit pull does write.
      const restart: Surgery = { parts: { 'word/numbering.xml': (xml) => xml.replace(/<w:start w:val="1"\/>/u, '<w:start w:val="7"/>') } };
      const numberingAlone = await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, restart) });
      expect(codes(numberingAlone)).toEqual(['PULL_NUMBERING_CHANGED']);
      expect(numberingAlone.complete).toBe(false);
      const numberingAndWording = await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, all(restart, MUTATIONS[0]!.surgery)) });
      expect(codes(numberingAndWording)).toEqual(['PULL_NUMBERING_CHANGED']);
      expect(numberingAndWording.complete).toBe(false);

      // A list label made red and larger: the numbers are the same, their look is not.
      const redLabel: Surgery = { parts: { 'word/numbering.xml': (xml) => xml.replace(/(<w:lvl w:ilvl="0">(?:(?!<\/w:lvl>).)*?<\/w:pPr>)<\/w:lvl>/u, '$1<w:rPr><w:color w:val="FF0000"/><w:sz w:val="36"/></w:rPr></w:lvl>') } };
      expect(codes(await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, all(redLabel, MUTATIONS[0]!.surgery)) }))).toEqual(['PULL_NUMBERING_CHANGED']);

      // An even-page header, plain and as a tracked insertion.
      const even = (text: string): Surgery => ({
        document: (xml) => xml.replace('<w:sectPr>', '<w:sectPr><w:headerReference w:type="even" r:id="rIdPullEven"/>'),
        parts: { 'word/settings.xml': (xml) => xml.replace(/(<w:settings[^>]*>)/u, '$1<w:evenAndOddHeaders/>') },
        add: { 'word/headerEven.xml': `<w:hdr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${text}</w:p></w:hdr>` },
        relationships: [['rIdPullEven', 'header', 'headerEven.xml']],
      });
      const evenHeader = await pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, even('<w:r><w:t>Even page</w:t></w:r>')) });
      expect(codes(evenHeader)).toEqual(['PULL_HEADER_UNMAPPED']);
      await expect(pullCreationEdits({ source: LETTER, base, edited: await edit(base.docx, even('<w:ins w:id="7" w:author="Reviewer"><w:r><w:t>Even page</w:t></w:r></w:ins>')) }))
        .rejects.toMatchObject({ code: 'PULL_TRACKED_CHANGES' });

      // Two table cells merged: the text is the same, the structure is not.
      const tableSource = ['Terms:', '', '{% table %}', '* Term', '* Value', '---', '* Price', '* Ten', '{% /table %}', ''].join('\n');
      const tableBase = await build(tableSource);
      const merged = await pullCreationEdits({ source: tableSource, base: tableBase, edited: await edit(tableBase.docx, { document: (xml) => xml.replace('<w:tcPr>', '<w:tcPr><w:gridSpan w:val="2"/>') }) });
      expect(codes(merged)).toEqual(['PULL_TABLE_STRUCTURE']);
      expect(merged.complete).toBe(false);
      // A column resized beside a wording edit: the wording is pulled, the width is diagnosed.
      const widened = await pullCreationEdits({ source: tableSource, base: tableBase, edited: await edit(tableBase.docx, { document: (xml) => once(xml, '>Terms:<', '>New terms:<').replace('<w:gridCol w:w="4680"/>', '<w:gridCol w:w="5180"/>') }) });
      expect(codes(widened)).toEqual(['PULL_TABLE_STRUCTURE']);
      expect(widened.complete).toBe(false);
      // The cell margins Word for Mac adds when it saves an unedited table are not an edit.
      const wordSave = await pullCreationEdits({ source: tableSource, base: tableBase, edited: await edit(tableBase.docx, { document: (xml) => xml.replace('<w:tblLayout w:type="fixed"/>', '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar>') }) });
      expect(wordSave).toMatchObject({ changes: [], diagnostics: [], complete: true });

      // An edit beside a span keeps the span's markup.
      const literalSource = 'Keep foo{% literal %}bar{% /literal %} safe.\n';
      const literalBase = await build(literalSource);
      const beside = await pullCreationEdits({ source: literalSource, base: literalBase, edited: await edit(literalBase.docx, { document: (xml) => once(xml, 'Keep foobar safe.', 'Keep quxbar safe.') }) });
      expect(beside.complete).toBe(true);
      expect(beside.pulledSource).toBe('Keep qux{% literal %}bar{% /literal %} safe.\n');
      // Typing plain text over a whole bold span replaces it, even where the new text shares letters with the old.
      const boldSource = 'Keep **bar** safe.\n';
      const boldBase = await build(boldSource);
      const typedOver = await pullCreationEdits({ source: boldSource, base: boldBase, edited: await edit(boldBase.docx, { document: (xml) => once(xml, '<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">bar</w:t></w:r>', '<w:r><w:t xml:space="preserve">baz</w:t></w:r>') }) });
      expect(typedOver).toMatchObject({ complete: true, diagnostics: [] });
      expect(typedOver.pulledSource).toBe('Keep baz safe.\n');
    },
    60_000,
  );
});
