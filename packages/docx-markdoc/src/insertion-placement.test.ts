import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { generateDocx, OOXML, parseXml, type InlineSpec } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
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
      const clean = await trackedRuns(result.clean);
      expect(clean.map((run) => run.text).join('')).toBe('The Widget Plan reserves up to [Number] shares.');
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
      const inserted = (await trackedRuns(result.tracked)).filter((run) => run.inserted);
      expect(inserted.map((run) => run.text).join('').trim()).toBe('up to');
      expect(inserted.every((run) => run.highlight === 'yellow')).toBe(true);
    },
  );
});
