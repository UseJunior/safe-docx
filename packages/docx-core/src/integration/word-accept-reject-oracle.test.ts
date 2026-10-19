/**
 * The Word-free half of the Word Accept/Reject oracle: projection, comparison, packaging,
 * osascript failure classification, the Word lock, and the run orchestration with a fake Word.
 * None of these cases needs Microsoft Word.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acquireSofficeLock } from './soffice-lock.js';
import {
  WordAutomationError,
  applyToStoryParts,
  classifyOsascriptFailure,
  diffProjections,
  formatOracleReport,
  formatUnitLine,
  oracleExitCode,
  packageContentHash,
  projectDocx,
  runAcceptRejectOracle,
  withWordLock,
  wordContainerDataDir,
  wordOracleLockPath,
  type DocumentProjection,
  type OracleCase,
  type OracleImplementation,
  type WordDriver,
} from './word-accept-reject-oracle.js';

const TEST_FEATURE = 'Word Accept/Reject Oracle';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const REV = 'w:id="1" w:author="T" w:date="2026-01-01T00:00:00Z"';

const p = (text: string, pPr = ''): string => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const ref = (kind: 'header' | 'footer', type: string, id: string): string => `<w:${kind}Reference w:type="${type}" r:id="${id}"/>`;

interface Story { id: string; target: string; xml: string; absolute?: boolean }
const story = (id: string, kind: 'header' | 'footer', n: number, text: string): Story => ({
  id, target: `${kind}${n}.xml`,
  xml: `<w:${kind === 'header' ? 'hdr' : 'ftr'} xmlns:w="${W}">${p(text)}</w:${kind === 'header' ? 'hdr' : 'ftr'}>`,
});

async function docx(body: string, stories: Story[] = [], { date = new Date('2026-01-01T00:00:00Z'), extra = {} as Record<string, string> } = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`, { date });
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${PKG}">${stories.map((s) =>
    `<Relationship Id="${s.id}" Type="${R}/x" Target="${s.absolute ? `/word/${s.target}` : s.target}"/>`).join('')}`
    + `<Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`, { date });
  for (const s of stories) zip.file(`word/${s.target}`, s.xml, { date });
  for (const [name, content] of Object.entries(extra)) zip.file(name, content, { date });
  return zip.generateAsync({ type: 'nodebuffer' });
}

const projection = (overrides: Partial<DocumentProjection> = {}): DocumentProjection => ({
  sections: [{
    pageSize: { w: 12240, h: 15840, orient: 'portrait' },
    pageMargins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720, gutter: 0 },
    titlePage: false,
    bindings: { 'header.default': 'H', 'header.first': null, 'header.even': null, 'footer.default': null, 'footer.first': null, 'footer.even': null },
  }],
  paragraphs: ['One', 'Two'],
  revisionsRemaining: 0,
  ...overrides,
});

describe('projectDocx', () => {
  test('resolves header/footer bindings with linked-to-previous inheritance per type', async ({ given, when, then }: AllureBddContext) => {
    let bytes!: Buffer;
    let result!: DocumentProjection;
    await given('three sections: the first binds default+first headers, the second only a footer, the last a new default header', async () => {
      bytes = await docx(
        p('A', `<w:sectPr>${ref('header', 'default', 'rH1')}${ref('header', 'first', 'rH2')}${PORTRAIT}<w:titlePg/></w:sectPr>`)
        + p('B', `<w:sectPr>${ref('footer', 'default', 'rF1')}${LANDSCAPE}<w:titlePg w:val="0"/></w:sectPr>`)
        + p('C') + `<w:sectPr>${ref('header', 'default', 'rH3')}</w:sectPr>`,
        [story('rH1', 'header', 1, 'H1'), story('rH2', 'header', 2, 'H2'), story('rF1', 'footer', 1, 'F1'), { ...story('rH3', 'header', 3, 'H3'), absolute: true }],
      );
    });
    await when('it is projected', async () => { result = await projectDocx(bytes); });
    await then('each section carries what it binds plus what it inherits, and its own page setup and titlePg', () => {
      expect(result.sections).toHaveLength(3);
      expect(result.sections[0]!.bindings).toMatchObject({ 'header.default': 'H1', 'header.first': 'H2', 'footer.default': null });
      expect(result.sections[0]!.titlePage).toBe(true);
      expect(result.sections[1]!.bindings).toMatchObject({ 'header.default': 'H1', 'header.first': 'H2', 'footer.default': 'F1' });
      expect(result.sections[1]!.pageSize).toEqual({ w: 15840, h: 12240, orient: 'landscape' });
      expect(result.sections[1]!.pageMargins).toBeNull();
      expect(result.sections[1]!.titlePage).toBe(false);
      expect(result.sections[2]!.bindings).toMatchObject({ 'header.default': 'H3', 'header.first': 'H2', 'footer.default': 'F1' });
      expect(result.sections[2]!.pageSize).toBeNull();
      expect(result.paragraphs).toEqual(['A', 'B', 'C']);
    });
  });

  test('skips sectPrChange snapshots and counts revisions in the body and in story parts', async ({ given, when, then }: AllureBddContext) => {
    let bytes!: Buffer;
    let result!: DocumentProjection;
    await given('a body section with a sectPrChange snapshot, an inserted run, and a header holding a deletion', async () => {
      const header: Story = {
        id: 'rH1', target: 'header1.xml',
        xml: `<w:hdr xmlns:w="${W}"><w:p><w:del ${REV}><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p></w:hdr>`,
      };
      bytes = await docx(
        `<w:p><w:ins ${REV}><w:r><w:t>new</w:t></w:r></w:ins></w:p>`
        + `<w:sectPr>${ref('header', 'default', 'rH1')}${PORTRAIT}<w:sectPrChange ${REV}><w:sectPr>${LANDSCAPE}</w:sectPr></w:sectPrChange></w:sectPr>`,
        [header],
      );
    });
    await when('it is projected', async () => { result = await projectDocx(bytes); });
    await then('there is one live section, deleted text is not read, and three revisions remain', () => {
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]!.bindings['header.default']).toBe('kept');
      expect(result.paragraphs).toEqual(['new']);
      expect(result.revisionsRemaining).toBe(3);
    });
  });

  test('reads tabs, breaks and table text, and ignores text-box and fallback copies', async ({ given, when, then }: AllureBddContext) => {
    let bytes!: Buffer;
    let result!: DocumentProjection;
    await given('a paragraph with a tab, a break, a field code, and a text box; then a table', async () => {
      bytes = await docx(
        '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:noBreakHyphen/><w:instrText>PAGE</w:instrText></w:r>'
        + '<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:drawing><w:txbxContent>'
        + `${p('in box')}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict>${p('fallback')}</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`
        + `<w:tbl><w:tr><w:tc>${p('cell')}</w:tc></w:tr></w:tbl><w:sectPr/>`,
      );
    });
    await when('it is projected', async () => { result = await projectDocx(bytes); });
    await then('only body paragraphs are listed, with their visible text', () => {
      expect(result.paragraphs).toEqual(['a\tb\nc-', 'cell']);
    });
  });

  test('names a missing relationship or part instead of throwing', async ({ given, when, then }: AllureBddContext) => {
    let bytes!: Buffer;
    let result!: DocumentProjection;
    await given('one reference to an unknown rId and one to a relationship whose part is absent', async () => {
      const zip = await JSZip.loadAsync(await docx(`${p('x')}<w:sectPr>${ref('header', 'default', 'rNope')}${ref('footer', 'default', 'rH1')}${ref('footer', 'odd', 'rH1')}</w:sectPr>`, [story('rH1', 'footer', 1, 'F')]));
      zip.remove('word/footer1.xml');
      bytes = await zip.generateAsync({ type: 'nodebuffer' });
    });
    await when('it is projected', async () => { result = await projectDocx(bytes); });
    await then('the bindings carry a readable placeholder and unknown types are ignored', () => {
      expect(result.sections[0]!.bindings['header.default']).toBe('<missing relationship rNope>');
      expect(result.sections[0]!.bindings['footer.default']).toBe('<missing part word/footer1.xml>');
    });
  });

  test('rejects a package without a main document or body', async ({ then }: AllureBddContext) => {
    await then('both shapes throw a descriptive error', async () => {
      const empty = new JSZip();
      empty.file('a.xml', '<a/>');
      await expect(projectDocx(await empty.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/no word\/document.xml/);
      const bodiless = new JSZip();
      bodiless.file('word/document.xml', `<w:document xmlns:w="${W}"/>`);
      await expect(projectDocx(await bodiless.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/no w:body/);
    });
  });
});

describe('diffProjections', () => {
  test('identical projections have no differences', async ({ then }: AllureBddContext) => {
    await then('the diff is empty', () => { expect(diffProjections(projection(), projection())).toEqual([]); });
  });

  test('reports section count, page setup, titlePg, bindings and revisions as mismatches', async ({ given, then }: AllureBddContext) => {
    const base = projection();
    let changed!: DocumentProjection;
    await given('our projection differs from Word in every section field', () => {
      changed = projection({
        sections: [{
          pageSize: { w: 15840, h: 12240, orient: 'landscape' },
          pageMargins: { ...base.sections[0]!.pageMargins!, top: 720 },
          titlePage: true,
          bindings: { ...base.sections[0]!.bindings, 'header.default': null, 'footer.even': 'F' },
        }],
        revisionsRemaining: 2,
      });
    });
    await then('each field is one mismatch with its path', () => {
      const paths = diffProjections(base, changed).map((d) => `${d.severity}:${d.path}`);
      expect(paths).toEqual([
        'mismatch:sections[0].pageSize', 'mismatch:sections[0].pageMargins', 'mismatch:sections[0].titlePage',
        'mismatch:sections[0].bindings.header.default', 'mismatch:sections[0].bindings.footer.even', 'mismatch:revisionsRemaining',
      ]);
      expect(diffProjections(base, projection({ sections: [...base.sections, ...base.sections] })))
        .toEqual([{ path: 'sections.length', expected: 1, actual: 2, severity: 'mismatch' }]);
    });
  });

  test('a page setup missing on one side is a note, because Word writes defaults on save', async ({ then }: AllureBddContext) => {
    await then('the difference is tolerated', () => {
      const ours = projection();
      ours.sections[0] = { ...ours.sections[0]!, pageSize: null, pageMargins: null };
      const diff = diffProjections(projection(), ours);
      expect(diff.map((d) => d.severity)).toEqual(['note', 'note']);
    });
  });

  test('reports paragraph count and text differences, capped', async ({ then }: AllureBddContext) => {
    await then('a count change names the first differing paragraph, and many text changes are summarized', () => {
      expect(diffProjections(projection(), projection({ paragraphs: ['One'] }))).toEqual([
        { path: 'paragraphs.length', expected: 2, actual: 1, severity: 'mismatch' },
        { path: 'paragraphs[1]', expected: 'Two', actual: null, severity: 'mismatch' },
      ]);
      expect(diffProjections(projection({ paragraphs: ['One'] }), projection({ paragraphs: ['One', 'Extra'] }))
        .map((d) => d.path)).toEqual(['paragraphs.length', 'paragraphs[1]']);
      const many = Array.from({ length: 8 }, (_, i) => `p${i}`);
      const diff = diffProjections(projection({ paragraphs: many }), projection({ paragraphs: many.map((t) => `${t}!`) }));
      expect(diff).toHaveLength(6);
      expect(diff.at(-1)).toEqual({ path: 'paragraphs.differing', expected: 5, actual: 8, severity: 'mismatch' });
    });
  });
});

describe('packaging helpers', () => {
  test('applyToStoryParts projects the body and only the story parts that carry revisions', async ({ given, when, then }: AllureBddContext) => {
    let bytes!: Buffer;
    let out!: JSZip;
    const seen: string[] = [];
    await given('a package with a revised header and an untouched footer', async () => {
      bytes = await docx(`${p('body')}<w:sectPr/>`, [
        { id: 'rH1', target: 'header1.xml', xml: `<w:hdr xmlns:w="${W}"><w:p><w:ins ${REV}><w:r><w:t>h</w:t></w:r></w:ins></w:p></w:hdr>` },
        story('rF1', 'footer', 1, 'f'),
      ]);
    });
    await when('a marker projection is applied', async () => {
      out = await JSZip.loadAsync(await applyToStoryParts(bytes, (xml) => { seen.push(xml.slice(0, 60)); return xml.replace('</w:body>', '<!--seen--></w:body>').replace('</w:hdr>', '<!--seen--></w:hdr>'); }));
    });
    await then('document.xml and header1.xml changed, footer1.xml did not', async () => {
      expect(seen).toHaveLength(2);
      expect(await out.file('word/document.xml')!.async('string')).toContain('<!--seen-->');
      expect(await out.file('word/header1.xml')!.async('string')).toContain('<!--seen-->');
      expect(await out.file('word/footer1.xml')!.async('string')).not.toContain('<!--seen-->');
    });
  });

  test('packageContentHash ignores zip dates and entry order but not content', async ({ then }: AllureBddContext) => {
    await then('the same parts hash the same; a changed part hashes differently', async () => {
      const a = await docx(p('x'), [story('rH1', 'header', 1, 'H')], { date: new Date('2020-01-01T00:00:00Z') });
      const b = await docx(p('x'), [story('rH1', 'header', 1, 'H')], { date: new Date('2025-06-01T00:00:00Z') });
      const c = await docx(p('y'), [story('rH1', 'header', 1, 'H')]);
      const dir = new JSZip();
      dir.folder('word');
      dir.file('word/document.xml', 'x');
      expect(await packageContentHash(a)).toBe(await packageContentHash(b));
      expect(await packageContentHash(a)).not.toBe(await packageContentHash(c));
      expect(await packageContentHash(await dir.generateAsync({ type: 'nodebuffer' }))).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('Word paths live in the Word sandbox container', async ({ then }: AllureBddContext) => {
    await then('the container and the lockfile are under ~/Library/Containers/com.microsoft.Word/Data', () => {
      expect(wordContainerDataDir('/Users/x')).toBe('/Users/x/Library/Containers/com.microsoft.Word/Data');
      expect(wordOracleLockPath('/Users/x')).toBe('/Users/x/Library/Containers/com.microsoft.Word/Data/safe-docx-word-oracle.lock');
    });
  });
});

describe('classifyOsascriptFailure', () => {
  test('maps osascript failures to actionable kinds', async ({ then }: AllureBddContext) => {
    await then('permission, stall, unavailable, not-found and other are distinguished', () => {
      expect(classifyOsascriptFailure({ stderr: 'execution error: Not authorized to send Apple events to Microsoft Word. (-1743)' }).kind).toBe('PERMISSION');
      expect(classifyOsascriptFailure({ timedOut: true, timeoutSeconds: 90 })).toMatchObject({ kind: 'STALL', message: expect.stringContaining('within 90s') });
      expect(classifyOsascriptFailure({ stderr: 'Microsoft Word got an error: AppleEvent timed out. (-1712)' }).kind).toBe('STALL');
      expect(classifyOsascriptFailure({ stderr: 'Connection is invalid. (-609)' }).kind).toBe('UNAVAILABLE');
      expect(classifyOsascriptFailure({ stdout: 'NOT FOUND' }).kind).toBe('NOT_FOUND');
      expect(classifyOsascriptFailure({ stderr: 'boom' })).toEqual({ kind: 'OTHER', message: 'osascript failed: boom' });
      expect(classifyOsascriptFailure({}).message).toBe('osascript failed: no output');
    });
  });
});

describe('withWordLock', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'word-oracle-lock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('runs the work under the lockfile and releases it', async ({ when, then }: AllureBddContext) => {
    const lockPath = path.join(dir, 'word.lock');
    let heldDuringWork = false;
    await when('work runs under the Word lock', async () => {
      await withWordLock(async () => { heldDuringWork = existsSync(lockPath); }, { lockPath });
    });
    await then('the lockfile existed during the work and is gone afterwards', () => {
      expect(heldDuringWork).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  test('a contended lock times out with a Word-specific message, and work errors pass through', async ({ given, then }: AllureBddContext) => {
    const lockPath = path.join(dir, 'word.lock');
    let release!: () => Promise<void>;
    await given('another live holder', async () => { release = await acquireSofficeLock(lockPath); });
    await then('the waiter gives up naming the Word lock; an error inside the work is not rewritten', async () => {
      await expect(withWordLock(async () => 1, { lockPath, timeoutMs: 150, pollMs: 20 })).rejects.toThrow(/Another Word oracle run holds/);
      await release();
      await expect(withWordLock(async () => { throw new Error('Timed out inside the work'); }, { lockPath })).rejects.toThrow('Timed out inside the work');
    });
  });
});

describe('runAcceptRejectOracle', () => {
  const sectionBody = (text: string): string => `${p(text)}<w:sectPr>${PORTRAIT}</w:sectPr>`;
  const caseOf = (id: string, text: string, extra: Partial<OracleCase> = {}): OracleCase =>
    ({ suite: 'unit', id, modes: ['accept', 'reject'], input: () => docx(sectionBody(text)), ...extra });
  /** A fake Word that "resolves" a document by upper-casing it in accept mode. */
  const fakeWord: WordDriver = async ({ input, mode }) => {
    const zip = await JSZip.loadAsync(input);
    const xml = await zip.file('word/document.xml')!.async('string');
    zip.file('word/document.xml', mode === 'accept' ? xml.replace(/<w:t>([^<]*)<\/w:t>/g, (_, t: string) => `<w:t>${t.toUpperCase()}</w:t>`) : xml);
    return { output: await zip.generateAsync({ type: 'nodebuffer' }), cached: mode === 'reject', seconds: 1.5 };
  };
  const faithful: OracleImplementation = { name: 'faithful', apply: async (input, mode) => (await fakeWord({ suite: '', caseId: '', mode, input })).output };
  const identity: OracleImplementation = { name: 'identity', apply: async (input) => input };

  test('classifies units as MATCH, MISMATCH, XFAIL and XPASS', async ({ when, then }: AllureBddContext) => {
    let lines: string[] = [];
    let result!: Awaited<ReturnType<typeof runAcceptRejectOracle>>;
    await when('a faithful and an identity implementation run against a fake Word, with two listed divergences', async () => {
      result = await runAcceptRejectOracle({
        cases: [caseOf('a', 'lower'), caseOf('b', 'other')],
        word: fakeWord,
        implementations: [faithful, identity],
        knownDivergences: { 'b:accept': 'identity does not upper-case', 'b:reject': 'stale entry' },
        onUnit: (unit, i, total) => lines.push(formatUnitLine(unit, i, total)),
      });
    });
    await then('accept mismatches for identity, reject matches, and listed units become XFAIL/XPASS', () => {
      expect(result.units.map((u) => `${u.caseId}:${u.mode}=${u.status}`)).toEqual(['a:accept=MISMATCH', 'a:reject=MATCH', 'b:accept=XFAIL', 'b:reject=XPASS']);
      expect(lines[0]).toBe('[1/4] unit a accept: word ran 1.5s | faithful MATCH | identity MISMATCH => MISMATCH');
      expect(lines[1]).toContain('word cached');
      expect(oracleExitCode(result)).toBe(1);
      const report = formatOracleReport(result, { wordVersion: '16.114' });
      expect(report).toContain('Word Accept/Reject oracle (Microsoft Word 16.114)');
      expect(report).toContain('unit: 1/4 match (1 XFAIL, 1 XPASS, 1 MISMATCH)');
      expect(report).toContain('identity: paragraphs[0]: expected "LOWER", got "lower"');
      expect(report).toContain('known divergence: stale entry');
    });
  });

  test('checks Word against the expected document for round-trip cases', async ({ then }: AllureBddContext) => {
    await then('a Word result that differs from the expected side is a word-vs-expected mismatch', async () => {
      const result = await runAcceptRejectOracle({
        cases: [caseOf('rt', 'text', { modes: ['accept'], expected: { accept: () => docx(sectionBody('different')) } })],
        word: fakeWord,
        implementations: [faithful],
      });
      expect(result.units[0]!.checks.map((c) => c.name)).toEqual(['word-vs-expected', 'faithful']);
      expect(result.units[0]!.status).toBe('MISMATCH');
    });
  });

  test('reports Word, input and implementation failures as errors and aborts on a permission failure', async ({ then }: AllureBddContext) => {
    await then('each failure is captured, and the run stops at the first PERMISSION failure', async () => {
      const stalling: WordDriver = async ({ caseId }) => {
        if (caseId === 'stall') throw new WordAutomationError({ kind: 'STALL', message: 'Word did not answer' });
        if (caseId === 'denied') throw new WordAutomationError({ kind: 'PERMISSION', message: 'not allowed' });
        if (caseId === 'broken') throw new Error('disk full');
        return fakeWord({ suite: 'unit', caseId, mode: 'reject', input: await docx(sectionBody('x')) });
      };
      const throwing: OracleImplementation = { name: 'throwing', apply: async () => { throw new Error('applier crashed'); } };
      const result = await runAcceptRejectOracle({
        cases: [
          caseOf('noinput', 'x', { modes: ['accept'], input: async () => { throw new Error('compare failed'); } }),
          caseOf('stall', 'x', { modes: ['accept'] }),
          caseOf('broken', 'x', { modes: ['accept'] }),
          caseOf('ok', 'x', { modes: ['accept'] }),
          caseOf('denied', 'x'),
          caseOf('never', 'x'),
        ],
        word: stalling,
        implementations: [throwing],
      });
      expect(result.units.map((u) => `${u.caseId}=${u.status}`)).toEqual(['noinput=ERROR', 'stall=ERROR', 'broken=ERROR', 'ok=MISMATCH', 'denied=ERROR']);
      expect(result.units[0]!.word).toEqual({ error: 'could not build the input: compare failed', kind: 'HARNESS' });
      expect(result.units[1]!.word).toMatchObject({ kind: 'STALL' });
      expect(result.units[2]!.word).toMatchObject({ kind: 'HARNESS' });
      expect(result.units[3]!.checks[0]).toEqual({ name: 'throwing', differences: [], error: 'applier crashed' });
      expect(result.aborted).toBe('not allowed');
      expect(oracleExitCode(result)).toBe(2);
      const report = formatOracleReport(result);
      expect(report).toContain('ABORTED: not allowed');
      expect(report).toContain('word: STALL: Word did not answer');
      expect(report).toContain('throwing: ERROR applier crashed');
      expect(formatUnitLine(result.units[1]!, 2, 5)).toBe('[2/5] unit stall accept: word STALL => ERROR');
    });
  });

  test('a run where everything matches exits 0, as does one whose only failures are listed', async ({ then }: AllureBddContext) => {
    await then('oracleExitCode is 0', async () => {
      const clean = await runAcceptRejectOracle({ cases: [caseOf('a', 'x')], word: fakeWord, implementations: [faithful] });
      expect(oracleExitCode(clean)).toBe(0);
      expect(formatOracleReport(clean)).toBe('Word Accept/Reject oracle\n  unit: 2/2 match');
      const listed = await runAcceptRejectOracle({ cases: [caseOf('a', 'x', { modes: ['accept'] })], word: fakeWord, implementations: [identity], knownDivergences: { 'a:accept': 'known' } });
      expect(oracleExitCode(listed)).toBe(0);
    });
  });
});
