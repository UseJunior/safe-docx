/**
 * End-to-end coverage for revised insertion claims that collide with settled
 * original content.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/359
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  acceptAllChanges,
  compareDocuments,
  extractTextWithParagraphs,
  normalizeText,
  rejectAllChanges,
} from '../../index.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  paragraphWithText,
} from '../../testing/ooxml-fixtures.js';

const TEST_FEATURE = 'Inplace Insertion Provenance';
const TRACKED_AUTHOR = 'Revised Author';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });

async function documentXml(docx: Buffer): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file('word/document.xml');
  if (!part) throw new Error('comparison result omitted word/document.xml');
  return part.async('string');
}

function projectionText(xml: string, projection: 'accept' | 'reject'): string {
  const projected = projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml);
  return normalizeText(extractTextWithParagraphs(projected));
}

describe('Inplace revised insertion provenance collisions', () => {
  test(
    'promotes a colliding inline insertion to settled content',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        paragraphWithText('!') + paragraphWithText('!') + paragraphWithText('I'),
      );
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:r><w:t>6.</w:t></w:r>` +
          `<w:ins w:id="7" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z">` +
          `<w:r><w:t>I</w:t></w:r></w:ins></w:p>`,
      );

      await given('settled original text matched by a revised-side inline insertion', () => {});
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      const combined = await documentXml(result.document);
      await when('the documents are compared in inplace mode', () => {});

      await then('the comparison remains inplace and removes the stale insertion claim', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(combined).not.toContain(`w:author="${TRACKED_AUTHOR}"`);
      });
      await and('accept and reject preserve the revised and original projections', () => {
        expect(projectionText(combined, 'accept')).toBe('6.I');
        expect(projectionText(combined, 'reject')).toBe('!\n!\nI');
      });
    },
  );

  test(
    'promotes a colliding inserted paragraph to settled content',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        paragraphWithText('Alpha text.') + paragraphWithText('Added para.'),
      );
      const revised = await buildDocxFromBodyXml(
        paragraphWithText('Alpha text.') +
          `<w:p><w:pPr><w:rPr>` +
          `<w:ins w:id="8" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z"/>` +
          `</w:rPr></w:pPr>` +
          `<w:ins w:id="9" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z">` +
          `<w:r><w:t>Added para.</w:t></w:r></w:ins></w:p>`,
      );

      await given('a settled original paragraph marked inserted on the revised side', () => {});
      const result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
      const combined = await documentXml(result.document);
      await when('the documents are compared in inplace mode', () => {});

      await then('the comparison remains inplace and removes both insertion markers', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(combined).not.toContain(`w:author="${TRACKED_AUTHOR}"`);
      });
      await and('both projections keep the settled paragraph', () => {
        expect(projectionText(combined, 'accept')).toBe('Alpha text.\nAdded para.');
        expect(projectionText(combined, 'reject')).toBe('Alpha text.\nAdded para.');
      });
    },
  );
});
