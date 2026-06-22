/**
 * Standard ancillary parts (issue #482).
 *
 * Word-authored documents always carry word/theme/theme1.xml, word/fontTable.xml,
 * and word/webSettings.xml. generateDocx now emits all three on every package so
 * authored output is part-for-part comparable to genuine Word output, removing a
 * suspected Word-for-Mac repair trigger. These assertions prove the parts are
 * present, fully wired (content type + resolving relationship), well-formed, and
 * survive a load/save round-trip and a self-compare.
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { generateDocx } from './compile.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { BorderSpec, DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-generation-ancillary-parts';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const ANCILLARY_PARTS = ['word/theme/theme1.xml', 'word/fontTable.xml', 'word/webSettings.xml'];

const ANCILLARY_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.theme+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml',
];

/** A spec exercising fonts on a style and a run, plus recipe blocks, to drive font enumeration. */
function richSpec(): DocumentSpec {
  return {
    meta: { title: 'Ancillary', author: 'safe-docx', createdIso: '2026-01-01T00:00:00Z' },
    styles: [
      { styleId: 'Body', name: 'Body', type: 'paragraph', basedOn: 'Normal', run: { font: 'Times New Roman' } },
    ],
    sections: [
      {
        blocks: [
          { kind: 'paragraph', styleId: 'Body', runs: [{ kind: 'text', text: 'Hello ' }, { kind: 'text', text: 'world', font: 'Georgia' }] },
          {
            kind: 'table',
            layout: 'fixed',
            columnWidthsTwips: [3600, 6000],
            borders: { bottom: { style: 'single' } as BorderSpec },
            rows: [
              {
                cells: [
                  { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Term' }] }] },
                  { blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Value' }] }] },
                ],
              },
            ],
          },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Acme Inc.', bold: true }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Name: Jane Roe' }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Title: Buyer' }] },
        ],
      },
    ],
  };
}

describe('Standard ancillary parts', () => {
  test.openspec('[SDX-GEN-093] standard ancillary parts are emitted and fully wired')(
    'Scenario: standard ancillary parts are emitted and fully wired',
    async ({ given, then, attachPrettyJson }: AllureBddContext) => {
      let buffer!: Buffer;
      let zipNames!: string[];
      await given('a generated package', async () => {
        buffer = await generateDocx(richSpec());
        const zip = await JSZip.loadAsync(buffer);
        zipNames = Object.keys(zip.files);
        await attachPrettyJson('package-parts', zipNames.slice().sort());
      });

      await then('it contains theme1.xml, fontTable.xml, and webSettings.xml', async () => {
        for (const part of ANCILLARY_PARTS) {
          expect(zipNames, `missing ${part}`).toContain(part);
        }
      });

      await then('each part carries a content-type Override', async () => {
        const contentTypes = (await readZipText(buffer, '[Content_Types].xml'))!;
        for (const part of ANCILLARY_PARTS) expect(contentTypes).toContain(`/${part}`);
        for (const ct of ANCILLARY_CONTENT_TYPES) expect(contentTypes).toContain(ct);
      });

      await then('each part has a relationship whose target resolves', async () => {
        const rels = parseXml((await readZipText(buffer, 'word/_rels/document.xml.rels'))!);
        const targets = Array.from(rels.getElementsByTagName('Relationship')).map((r) => r.getAttribute('Target'));
        // Targets are relative to word/ (the directory owning document.xml).
        for (const target of ['theme/theme1.xml', 'fontTable.xml', 'webSettings.xml']) {
          expect(targets, `no rel target ${target}`).toContain(target);
        }
      });

      await then('the structural checks pass (closed relationship graph)', async () => {
        const result = await checkGeneratedPackage(buffer);
        expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      });
    },
  );

  test.openspec('[SDX-GEN-093] the ancillary parts are well-formed and faithful')(
    'Scenario: the ancillary parts are well-formed and faithful',
    async ({ given, then }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a generated package referencing several fonts', async () => {
        buffer = await generateDocx(richSpec());
      });

      await then('the theme carries a colour, font, and format scheme', async () => {
        const theme = parseXml((await readZipText(buffer, 'word/theme/theme1.xml'))!);
        expect(theme.getElementsByTagName('a:clrScheme')).toHaveLength(1);
        expect(theme.getElementsByTagName('a:fontScheme')).toHaveLength(1);
        expect(theme.getElementsByTagName('a:fmtScheme')).toHaveLength(1);
        // A complete fmtScheme has three fills, three lines, three effects, three bg fills.
        expect(theme.getElementsByTagName('a:fillStyleLst')[0]!.getElementsByTagName('a:gradFill').length).toBeGreaterThanOrEqual(2);
      });

      await then('the font table enumerates every font the document references', async () => {
        const fonts = parseXml((await readZipText(buffer, 'word/fontTable.xml'))!);
        const names = Array.from(fonts.getElementsByTagName('w:font')).map((f) => f.getAttribute('w:name'));
        for (const expected of ['Calibri', 'Times New Roman', 'Georgia']) {
          expect(names, `font table missing ${expected}`).toContain(expected);
        }
      });

      await then('web settings declares browser optimization', async () => {
        const web = (await readZipText(buffer, 'word/webSettings.xml'))!;
        expect(web).toContain('optimizeForBrowser');
      });
    },
  );

  test.openspec('[SDX-GEN-093] the ancillary parts survive load/save and self-compare')(
    'Scenario: the ancillary parts survive load/save and self-compare',
    async ({ given, then }: AllureBddContext) => {
      let buffer!: Buffer;
      await given('a generated package', async () => {
        buffer = await generateDocx(richSpec());
      });

      await then('a load -> save round-trip retains all three parts', async () => {
        const archive = await DocxArchive.load(buffer);
        const resaved = await DocxArchive.load(await archive.save());
        for (const part of ANCILLARY_PARTS) expect(resaved.listFiles(), `dropped ${part}`).toContain(part);
      });

      await then('self-comparing the authored document keeps the theme in the result', async () => {
        const result = await compareDocuments(buffer, buffer, { engine: 'atomizer', reconstructionMode: 'rebuild' });
        const resultArchive = await DocxArchive.load(result.document);
        expect(resultArchive.listFiles()).toContain('word/theme/theme1.xml');
      });
    },
  );
});
