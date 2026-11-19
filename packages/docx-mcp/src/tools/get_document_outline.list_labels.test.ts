import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { generateDocx, type DocumentSpec, type ParagraphSpec } from '@usejunior/docx-core';
import { getDocumentOutline } from './get_document_outline.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-outline-list-labels';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type OutlineEntry = { paragraph_id: string; text: string; level: number | null; source: string; list_label?: string };

function outlineEntries(value: unknown): OutlineEntry[] {
  return ((value as { outline?: OutlineEntry[] }).outline ?? []);
}

const text = (value: string): ParagraphSpec['runs'] => [{ kind: 'text', text: value }];

/**
 * A two-article agreement whose headings only apply Heading 1 / Heading 2.
 * The styles are linked to the ARTICLE and Section levels through each
 * level's `pStyle`, which writes the style's `w:numPr`; the heading
 * paragraphs carry no numbering of their own (#1244). The labels are the
 * ones Word shows for this outline (recorded for #1235 / PR #1240).
 */
function styleNumberedAgreement(): DocumentSpec {
  const article = (title: string): ParagraphSpec => ({ kind: 'paragraph', styleId: 'Heading1', runs: text(title) });
  const section = (title: string): ParagraphSpec => ({ kind: 'paragraph', styleId: 'Heading2', runs: text(title) });
  return {
    meta: { title: 'Style-numbered agreement', createdIso: '2026-11-02T00:00:00Z' },
    styles: [
      { styleId: 'Heading1', name: 'heading 1', type: 'paragraph', basedOn: 'Normal', next: 'Normal', paragraph: { alignment: 'center' }, run: { bold: true } },
      { styleId: 'Heading2', name: 'heading 2', type: 'paragraph', basedOn: 'Normal', next: 'Normal', run: { bold: true } },
    ],
    numbering: [
      {
        numId: 'legal',
        levels: [
          { ilvl: 0, numFmt: 'upperRoman', lvlText: 'ARTICLE %1', pStyle: 'Heading1', suff: 'space' },
          { ilvl: 1, numFmt: 'decimalZero', lvlText: 'Section %1.%2', isLgl: true, pStyle: 'Heading2', suff: 'space' },
          { ilvl: 2, numFmt: 'lowerLetter', lvlText: '(%3)' },
        ],
      },
    ],
    sections: [
      {
        blocks: [
          article('DEFINITIONS'),
          section('Defined Terms.'),
          { kind: 'paragraph', list: { numId: 'legal', ilvl: 2 }, runs: text('a lettered clause numbered directly.') },
          section('Interpretation.'),
          article('PURCHASE AND SALE'),
          section('Purchase and Sale of Shares.'),
        ],
      },
    ],
  };
}

const UNNUMBERED_HEADINGS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W_NS}"><w:body>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Scope of Services</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

describe('Traceability: Outline List Labels', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  test.openspec('numbered headings carry their list label')('Scenario: numbered headings carry their list label', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('outline-list-labels-');
    const inputPath = path.join(tmpDir, 'agreement.docx');
    await given('a generated agreement whose Heading 1 / Heading 2 styles are linked to ARTICLE / Section levels', async () => {
      await fs.writeFile(inputPath, new Uint8Array(await generateDocx(styleNumberedAgreement())));
    });

    const json = await when('get_document_outline is called', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('get_document_outline response', r);
      return r;
    });

    await then('each heading entry SHALL carry the label Word displays', () => {
      expect(outlineEntries(json).map(({ list_label, text: t }) => [list_label, t])).toEqual([
        ['ARTICLE I', 'DEFINITIONS'],
        ['Section 1.01', 'Defined Terms.'],
        ['Section 1.02', 'Interpretation.'],
        ['ARTICLE II', 'PURCHASE AND SALE'],
        ['Section 2.01', 'Purchase and Sale of Shares.'],
      ]);
    });

    await and('the Markdown format SHALL prefix each heading with its label', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath, format: 'markdown' });
      assertSuccess(r, 'get_document_outline');
      expect(((r as { content?: string }).content ?? '').split('\n')).toEqual([
        '# ARTICLE I DEFINITIONS',
        '## Section 1.01 Defined Terms.',
        '## Section 1.02 Interpretation.',
        '# ARTICLE II PURCHASE AND SALE',
        '## Section 2.01 Purchase and Sale of Shares.',
      ]);
    });
  });

  test.openspec('unnumbered headings omit the list label')('Scenario: unnumbered headings omit the list label', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('outline-no-labels-');
    const inputPath = path.join(tmpDir, 'input.docx');
    await given('a document with unnumbered Heading 1 / Heading 2 paragraphs', async () => {
      await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(UNNUMBERED_HEADINGS_XML)));
    });

    const json = await when('get_document_outline is called', async () => {
      const r = await getDocumentOutline(mgr, { file_path: inputPath });
      assertSuccess(r, 'get_document_outline');
      await attachPrettyJson('get_document_outline response', r);
      return r;
    });

    await then('no entry SHALL include a list_label field', () => {
      const outline = outlineEntries(json);
      expect(outline).toHaveLength(2);
      for (const entry of outline) expect(entry).not.toHaveProperty('list_label');
    });
  });
});
