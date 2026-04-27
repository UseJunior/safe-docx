/**
 * Integration Tests — Rebuild Auxiliary Part Merging (regression for issue #94)
 *
 * Verifies that footnote, endnote, and comment definitions are correctly
 * merged from the *revised* archive when reconstruction runs in rebuild mode
 * (e.g., when the inplace round-trip safety check fails and falls back).
 *
 * Reported in https://github.com/UseJunior/safe-docx/issues/94: the original
 * implementation gated mergeAuxiliaryPartDefinitions to inplace mode only,
 * leaving rebuild output with dangling references when the original lacked
 * an auxiliary part the revised side introduced — Word would refuse to open
 * such files.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Auxiliary Part Merging — Rebuild Mode' });

describe('Rebuild Auxiliary Part Merging (issue #94)', () => {
  describe('Footnote added on revised side', () => {
    test('rebuild output bundles footnotes.xml + OPC metadata', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no footnotes and revised adds one', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'A new footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('rebuild output is structurally complete (no dangling references)', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.documentXml).toContain('w:footnoteReference');
        expect(parts.documentXml).toContain('w:id="1"');

        expect(parts.footnotesXml).not.toBeNull();
        expect(parts.footnotesXml!).toContain('w:id="1"');
        expect(parts.footnotesXml!).toContain('A new footnote');

        expect(parts.footnotesXml!).toContain('w:id="-1"');
        expect(parts.footnotesXml!).toContain('w:id="0"');
        expect(parts.footnotesXml!).toContain('w:separator');
        expect(parts.footnotesXml!).toContain('w:continuationSeparator');

        expect(parts.contentTypesXml!).toContain('word/footnotes.xml');
        expect(parts.contentTypesXml!).toContain(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'
        );

        expect(parts.relsXml!).toContain('footnotes.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'
        );
      });
    });
  });

  describe('Comment added on revised side', () => {
    test('rebuild output bundles comments.xml + OPC metadata', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has no comments and revised adds one', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Review needed',
          commentAuthor: 'Reviewer',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('comment anchors survive atomization and comments.xml is bundled', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);

        expect(parts.documentXml).toContain('w:commentReference');
        expect(parts.documentXml).toContain('w:id="1"');

        expect(parts.commentsXml).not.toBeNull();
        expect(parts.commentsXml!).toContain('w:id="1"');
        expect(parts.commentsXml!).toContain('Review needed');
        expect(parts.commentsXml!).toContain('Reviewer');

        expect(parts.contentTypesXml!).toContain('word/comments.xml');
        expect(parts.contentTypesXml!).toContain(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
        );

        expect(parts.relsXml!).toContain('comments.xml');
        expect(parts.relsXml!).toContain(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
        );
      });
    });
  });

  describe('Footnote present on both sides', () => {
    test('rebuild does not duplicate footnote definitions', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both documents share an identical footnote', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared footnote',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['Para A', 'Para B'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('footnotes.xml has exactly one user-defined entry', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');

        const parts = await getResultParts(result.document);
        expect(parts.footnotesXml).not.toBeNull();

        const userFootnoteCount = (parts.footnotesXml!.match(/<w:footnote w:id="1"/g) ?? []).length;
        expect(userFootnoteCount).toBe(1);
      });
    });
  });
});
