import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { generateDocx, OOXML, parseXml, type InlineSpec } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { buildDocxFromBodyXml } from '../../docx-core/src/testing/ooxml-fixtures.js';
import { compileMarkdoc, placeInsertionHunks, type RunSpan } from './compile.js';
import { importDocxToMarkdoc } from './import.js';

const TEST_FEATURE = 'add-markdoc-equivalent-insertion-placement';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1167 boundary insertions with an equivalent in-run offset',
  severity: 'normal',
});
const W = OOXML.W_NS;

/** One paragraph: plain text, a highlighted fill-in, plain text. */
async function fillInSource(runs: InlineSpec[]): Promise<{ anchored: Buffer; markdoc: string }> {
  const docx = await generateDocx({ sections: [{ blocks: [{ kind: 'paragraph', runs }] }] });
  const imported = await importDocxToMarkdoc(docx);
  return { anchored: imported.anchoredSource, markdoc: imported.markdoc };
}

function withChange(markdoc: string, before: string, after: string): string {
  const match = /\{% para (id="[^"]+" fingerprint="[^"]+" style="[^"]+") %\}\n[\s\S]*?\n\{% \/para %\}/.exec(markdoc)!;
  return markdoc.replace(match[0], [
    `{% change ${match[1]} edit="revise-fill-in-sentence" format="inherit-source-paragraph" %}`,
    '{% before %}', before, '{% /before %}', '{% after %}', after, '{% /after %}', '{% /change %}',
  ].join('\n'));
}

async function trackedRuns(buffer: Buffer): Promise<Array<{ text: string; inserted: boolean; highlight: string | null }>> {
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'r')).map((run) => ({
    text: Array.from(run.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join(''),
    inserted: (run.parentNode as Element | null)?.localName === 'ins',
    highlight: run.getElementsByTagNameNS(W, 'highlight').item(0)?.getAttribute('w:val') ?? null,
  })).filter((run) => run.text);
}

/** Each character of the clean paragraph with its highlight, so offsets are exact (no trimming). */
async function cleanCharacters(buffer: Buffer): Promise<Array<[string, string | null]>> {
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
  return Array.from(parseXml(xml).getElementsByTagNameNS(W, 'r')).flatMap((run) => {
    const highlight = run.getElementsByTagNameNS(W, 'highlight').item(0)?.getAttribute('w:val') ?? null;
    const text = Array.from(run.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('');
    return Array.from(text, (char) => [char, highlight] as [string, string | null]);
  });
}

/** Joined inserted text and deletion count; the comparison engine may split one insertion across several w:ins. */
async function revisions(buffer: Buffer): Promise<{ inserted: string; deletions: number }> {
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
  const inserted = [...xml.matchAll(/<w:ins\b[\s\S]*?<\/w:ins>/g)].map((match) => match[0].replace(/<[^>]+>/g, '')).join('');
  return { inserted, deletions: (xml.match(/<w:del\b/g) ?? []).length };
}

function highlightedText(characters: Array<[string, string | null]>): string {
  return characters.map(([char, highlight]) => (highlight ? char : '·')).join('');
}

describe('Traceability: equivalent placement for boundary insertions', () => {
  test.openspec('[SDX-MDOC-155] a boundary insertion moves to an equivalent in-run offset')(
    'Scenario: a boundary insertion moves to an equivalent in-run offset',
    async () => {
      const { anchored, markdoc } = await fillInSource([
        { kind: 'text', text: 'The Widget Plan reserves ' },
        { kind: 'text', text: '[Number]', highlight: 'yellow' },
        { kind: 'text', text: ' shares.' },
      ]);
      const revised = withChange(markdoc, 'The Widget Plan reserves \\[Number\\] shares.', 'The Widget Plan reserves up to \\[Number\\] shares.');
      const result = await compileMarkdoc(anchored, revised, { date: new Date('2026-10-07T00:00:00Z') });
      expect(result.certificate.deliveryReady).toBe(true);
      const runs = await trackedRuns(result.tracked);
      const inserted = runs.filter((run) => run.inserted);
      // " up to" before the space is the same text as "up to " before the fill-in, and sits inside the plain run,
      // so the inserted words inherit plain formatting. (The redline's own segmentation comes from comparison.)
      expect(inserted.map((run) => run.text).join('').trim()).toBe('up to');
      expect(inserted.every((run) => run.highlight === null)).toBe(true);
      expect(runs.map((run) => run.text).join('')).toBe('The Widget Plan reserves up to [Number] shares.');
      expect(runs.find((run) => run.text === '[Number]')?.highlight).toBe('yellow');
      // Character-exact: only "[Number]" is highlighted, so both spaces around "up to" are plain.
      const clean = await cleanCharacters(result.clean);
      expect(clean.map(([char]) => char).join('')).toBe('The Widget Plan reserves up to [Number] shares.');
      expect(highlightedText(clean)).toBe('·······························[Number]········');
      const { inserted: insertedText, deletions } = await revisions(result.tracked);
      expect(deletions).toBe(0);
      expect(['up to ', ' up to']).toContain(insertedText);
    },
  );

  test.openspec('[SDX-MDOC-155] a boundary insertion with no equivalent in-run offset still fails closed')(
    'Scenario: a boundary insertion with no equivalent in-run offset still fails closed',
    async () => {
      const { anchored, markdoc } = await fillInSource([
        { kind: 'text', text: 'Due on ' },
        { kind: 'text', text: '[Date]', highlight: 'yellow' },
        { kind: 'text', text: '.' },
      ]);
      // " or later" between "]" and "." shares no edge character with either side: the format choice is genuinely open.
      const revised = withChange(markdoc, 'Due on \\[Date\\].', 'Due on \\[Date\\] or later.');
      await expect(compileMarkdoc(anchored, revised)).rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });
      // The documented escape hatch still resolves it explicitly.
      const explicit = revised.replace('format="inherit-source-paragraph"', 'format="inherit-source-paragraph" format-source="Due on"');
      const result = await compileMarkdoc(anchored, explicit, { date: new Date('2026-10-07T00:00:00Z') });
      const inserted = (await trackedRuns(result.tracked)).filter((run) => run.inserted);
      expect(inserted.map((run) => run.text).join('')).toBe(' or later');
      expect(inserted.every((run) => run.highlight === null)).toBe(true);
    },
  );

  test.openspec('[SDX-MDOC-155] declared formatting keeps the exact diff offset')(
    'Scenario: declared formatting keeps the exact diff offset',
    async () => {
      const { anchored, markdoc } = await fillInSource([
        { kind: 'text', text: 'The Widget Plan reserves ' },
        { kind: 'text', text: '[Number]', highlight: 'yellow' },
        { kind: 'text', text: ' shares.' },
      ]);
      // With an explicit format-source the author chose the template; the hunk is not moved.
      const revised = withChange(markdoc, 'The Widget Plan reserves \\[Number\\] shares.', 'The Widget Plan reserves up to \\[Number\\] shares.')
        .replace('format="inherit-source-paragraph"', 'format="inherit-source-paragraph" format-source="[Number]"');
      const result = await compileMarkdoc(anchored, revised, { date: new Date('2026-10-07T00:00:00Z') });
      // Exact offset kept: "up to " (with its trailing space) inherits the named fill-in highlight.
      expect(highlightedText(await cleanCharacters(result.clean))).toBe('·························up to [Number]········');
    },
  );

  test.openspec('[SDX-MDOC-155] a slide never crosses a bookmark boundary')(
    'Scenario: a slide never crosses a bookmark boundary',
    async () => {
      // A bookmark wraps plain "Alpha "; a highlighted "[Term]" follows. The only equivalent in-run offset for
      // "up to " is one space left, inside the bookmark, which would change what a REF to it shows.
      const docx = await buildDocxFromBodyXml(
        '<w:p><w:bookmarkStart w:id="7" w:name="Lead"/><w:r><w:t xml:space="preserve">Alpha </w:t></w:r><w:bookmarkEnd w:id="7"/>'
        + '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[Term]</w:t></w:r><w:r><w:t xml:space="preserve"> shares.</w:t></w:r></w:p>',
      );
      const imported = await importDocxToMarkdoc(docx);
      const revised = withChange(imported.markdoc, 'Alpha \\[Term\\] shares.', 'Alpha up to \\[Term\\] shares.');
      await expect(compileMarkdoc(imported.anchoredSource, revised)).rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });
      // A letter-led insertion has no space to slide across, so it fails closed too (no letter rotation).
      const letters = await buildDocxFromBodyXml(
        '<w:p><w:r><w:t>Alpha:</w:t></w:r><w:bookmarkStart w:id="8" w:name="Term"/><w:r><w:rPr><w:b/></w:rPr><w:t>beta</w:t></w:r><w:bookmarkEnd w:id="8"/></w:p>',
      );
      const lettersImported = await importDocxToMarkdoc(letters);
      await expect(compileMarkdoc(lettersImported.anchoredSource, withChange(lettersImported.markdoc, 'Alpha:beta', 'Alpha:bravo beta')))
        .rejects.toMatchObject({ code: 'MIXED_FORMATTING_REQUIRES_DETAIL' });
    },
  );

  test.openspec('[SDX-MDOC-155] candidates that inherit different formats leave the edit failing closed')(
    'Scenario: candidates that inherit different formats leave the edit failing closed',
    async () => {
      // Bold "Alpha", plain " beta.": "Alpha gamma beta." can be placed inside either run, with different results.
      const { anchored, markdoc } = await fillInSource([
        { kind: 'text', text: 'Alpha', bold: true },
        { kind: 'text', text: ' beta.' },
      ]);
      const revised = withChange(markdoc, 'Alpha beta.', 'Alpha gamma beta.');
      const outcome = await compileMarkdoc(anchored, revised, { date: new Date('2026-10-07T00:00:00Z') }).then(
        async (result) => ({ clean: await cleanCharacters(result.clean) }),
        (error: { code?: string }) => ({ code: error.code }),
      );
      // Either the diff already placed the insertion inside one run, or no single format was chosen.
      if ('code' in outcome) expect(outcome.code).toBe('MIXED_FORMATTING_REQUIRES_DETAIL');
      else expect(outcome.clean.map(([char]) => char).join('')).toBe('Alpha gamma beta.');
    },
  );

  test.openspec('[SDX-MDOC-155] equivalent offsets that disagree on formatting are not chosen')(
    'Scenario: equivalent offsets that disagree on formatting are not chosen',
    () => {
      // Source "Alpha  beta": bold "Alpha " [0,6), plain " beta" [6,11). Inserting " gamma " at the boundary (6)
      // fits one space left (inside bold) and one space right (inside plain): two formats, so no move.
      const run = (name: string): Element => parseXml(`<w:r xmlns:w="${W}"><w:t>${name}</w:t></w:r>`).documentElement!;
      const bold = run('bold');
      const plain = run('plain');
      const spans: RunSpan[] = [{ start: 0, end: 6, run: bold, signature: 'b' }, { start: 6, end: 11, run: plain, signature: '' }];
      const hunk = { start: 6, end: 6, replacement: ' gamma ', revisedStart: 6, revisedEnd: 13 };
      expect(placeInsertionHunks([hunk], spans, 'Alpha  beta', [])).toEqual([hunk]);
      // Left-only candidate (no space to the right): moves, and the text stays equivalent.
      const leftOnly = { start: 6, end: 6, replacement: 'up to ', revisedStart: 6, revisedEnd: 12 };
      const fillIn: RunSpan[] = [{ start: 0, end: 6, run: plain, signature: '' }, { start: 6, end: 14, run: bold, signature: 'h' }];
      const [moved] = placeInsertionHunks([leftOnly], fillIn, 'Alpha [Term]', []);
      expect(moved).toEqual({ start: 5, end: 5, replacement: ' up to', revisedStart: 5, revisedEnd: 11 });
      const apply = (source: string, h: { start: number; replacement: string }) => source.slice(0, h.start) + h.replacement + source.slice(h.start);
      expect(apply('Alpha [Term]', moved!)).toBe(apply('Alpha [Term]', leftOnly));
      // A marker at the boundary blocks the move.
      expect(placeInsertionHunks([leftOnly], fillIn, 'Alpha [Term]', [6])).toEqual([leftOnly]);
    },
  );
});
