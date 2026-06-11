import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from '@usejunior/docx-core';

import { convertDocxToOdt } from './docx_to_odt.js';
import { OdfArchive } from '../shared/odf/OdfArchive.js';
import { OdfDocument } from '../document.js';

const NDA_DOCX = fileURLToPath(
  new URL('../../../../tests/test_documents/open-agreements/common-paper-mutual-nda.docx', import.meta.url),
);

/**
 * The structural projection both converters must agree on: visible body text plus the
 * paragraph/heading/list/table shape. Never bytes — LibreOffice rewrites styles, names,
 * and whitespace encodings freely.
 */
function projection(contentXml: string): {
  joinedText: string;
  headingCount: number;
  tableCount: number;
  hasLists: boolean;
} {
  const doc = OdfDocument.fromContentXml(contentXml);
  const joinedText = doc
    .getParagraphs()
    .map((b) => b.text)
    .filter((t) => t.trim() !== '')
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    joinedText,
    headingCount: (contentXml.match(/<text:h[\s>]/g) ?? []).length,
    tableCount: (contentXml.match(/<table:table[\s>]/g) ?? []).length,
    hasLists: /<text:list[\s>]/.test(contentXml),
  };
}

describe('convertDocxToOdt — LibreOffice differential oracle', () => {
  it(
    '[CONV-13] native conversion structurally agrees with a LibreOffice-converted reference (skips without a usable soffice)',
    async () => {
      const soffice = resolveSoffice();
      if (!soffice) {
        console.warn('[CONV-13] soffice not found — skipping differential test (set ODF_SOFFICE_BIN to enable).');
        return;
      }
      if (!(await probeSofficeUsable(soffice))) {
        console.warn('[CONV-13] soffice present but unusable (aborts on launch) — skipping differential test.');
        return;
      }

      const docx = readFileSync(NDA_DOCX);
      const { odt } = await convertDocxToOdt(docx);
      const nativeContentXml = await (await OdfArchive.load(odt)).getContentXml();

      const [referenceContentXml] = await runLibreOfficeOracle([{ op: 'identity', docx, saveAs: 'odt' }], soffice);

      const native = projection(nativeContentXml);
      const reference = projection(referenceContentXml!);

      expect(native.joinedText, 'visible text').toBe(reference.joinedText);
      expect(native.tableCount, 'table count').toBe(reference.tableCount);
      expect(native.headingCount, 'heading count').toBe(reference.headingCount);
      expect(native.hasLists, 'list presence').toBe(reference.hasLists);
    },
    240_000,
  );
});
