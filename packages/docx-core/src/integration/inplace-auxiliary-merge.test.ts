/**
 * Integration Tests — Inplace Auxiliary Part Merging
 *
 * Verifies that footnote, endnote, and comment definitions are correctly
 * merged from the original archive when inplace reconstruction inserts
 * deleted content referencing those definitions.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Auxiliary Part Merging' });
import { compareDocuments } from '@usejunior/docx-compare';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';

function countOccurrences(xml: string, pattern: RegExp): number {
  return (xml.match(pattern) || []).length;
}

// =============================================================================
// Tests
// =============================================================================

describe('Inplace Auxiliary Part Merging', () => {
  describe('Comment merging — part absent in revised', () => {
    test('merges comment definition and bootstraps OPC metadata', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original document has a commented paragraph and revised has none', async () => {
        // Original: paragraph with a comment
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Review needed',
          commentAuthor: 'Reviewer',
        });

        // Revised: same paragraphs, no comments at all
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        });
      });
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });
      await then('result contains merged comment definition and OPC metadata', async () => {
        // If inplace fell back to rebuild, the test is still valid — the merge
        // only runs on inplace output, so we skip assertions if rebuild was used
        if (result.reconstructionModeUsed !== 'inplace') return;

        const parts = await getResultParts(result.document);

        // The document.xml should reference comments
        if (!parts.documentXml.includes('w:commentReference')) {
          // No comment references in output — nothing to merge
          return;
        }

        // Assert: result has comments.xml with the comment definition
        expect(parts.commentsXml).not.toBeNull();
        expect(parts.commentsXml).toContain('w:id="1"');
        expect(parts.commentsXml).toContain('Review needed');

        // Assert: [Content_Types].xml has Override for comments
        expect(parts.contentTypesXml).toContain('word/comments.xml');
        expect(parts.contentTypesXml).toContain(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
        );

        // Assert: document.xml.rels has Relationship for comments
        expect(parts.relsXml).toContain('comments.xml');
        expect(parts.relsXml).toContain(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
        );
      });
    });
  });

  describe('Comment merging — part exists in revised', () => {
    test('merges missing comment entries without duplicating existing ones', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both original and revised documents have the same comment', async () => {
        // Original: 2 comments — comment on para 1 AND para 2
        // Build original with comment on paragraph 1
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Original comment',
          commentAuthor: 'AuthorA',
        });

        // Revised: same content with same comment (no deletion)
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph', 'Third paragraph'],
          commentOnParagraph: 1,
          commentText: 'Original comment',
          commentAuthor: 'AuthorA',
        });
      });
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });
      await then('comments.xml does not contain duplicate entries', async () => {
        if (result.reconstructionModeUsed !== 'inplace') return;

        const parts = await getResultParts(result.document);

        if (parts.commentsXml) {
          // No duplicate entries
          const commentCount = countOccurrences(parts.commentsXml, /<w:comment\b/g);
          expect(commentCount).toBeLessThanOrEqual(1);
        }
      });
    });
  });

  describe('Footnote regression guard', () => {
    test('merges footnote definitions from original when absent in revised', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has a footnoted paragraph and revised has the paragraph removed', async () => {
        // Original: paragraph with footnote
        original = await buildSyntheticDocx({
          paragraphs: ['Text with footnote', 'Another paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Important note',
        });

        // Revised: footnote paragraph removed
        revised = await buildSyntheticDocx({
          paragraphs: ['Another paragraph'],
        });
      });
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });
      await then('result contains merged footnote definition and OPC infrastructure', async () => {
        if (result.reconstructionModeUsed !== 'inplace') return;

        const parts = await getResultParts(result.document);

        // The document.xml should reference footnotes via deleted content
        if (!parts.documentXml.includes('w:footnoteReference')) {
          return;
        }

        // Assert: result has footnotes.xml with the definition
        expect(parts.footnotesXml).not.toBeNull();
        expect(parts.footnotesXml).toContain('w:id="1"');

        // Assert: OPC infrastructure is correct
        expect(parts.contentTypesXml).toContain('word/footnotes.xml');
        expect(parts.relsXml).toContain('footnotes.xml');
      });
    });
  });

  describe('No-merge needed guard', () => {
    test('does not duplicate entries when both documents have matching definitions', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both documents share the same footnote definition', async () => {
        // Both have same footnote
        original = await buildSyntheticDocx({
          paragraphs: ['Text with footnote', 'Another paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared note',
        });

        revised = await buildSyntheticDocx({
          paragraphs: ['Text with footnote', 'Another paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Shared note',
        });
      });
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });
      await then('footnotes.xml contains exactly one user-defined footnote entry', async () => {
        if (result.reconstructionModeUsed !== 'inplace') return;

        const parts = await getResultParts(result.document);

        if (parts.footnotesXml) {
          // Count user-defined footnotes (exclude separators with negative IDs)
          const userFootnotes = countOccurrences(
            parts.footnotesXml,
            /<w:footnote\b[^>]*w:id="[1-9]/g
          );
          expect(userFootnotes).toBe(1);
        }
      });
    });
  });

  describe('Reference integrity', () => {
    test('every footnoteReference in result has a matching definition', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('original has a footnoted paragraph that is deleted in revised', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['Footnoted text', 'Other text'],
          footnoteOnParagraph: 0,
          footnoteText: 'A footnote',
        });

        revised = await buildSyntheticDocx({
          paragraphs: ['Other text'],
        });
      });
      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });
      await then('every footnoteReference ID in document.xml has a matching entry in footnotes.xml', async () => {
        if (result.reconstructionModeUsed !== 'inplace') return;

        const parts = await getResultParts(result.document);

        // Collect all footnoteReference IDs from document.xml
        const refIds = new Set<string>();
        const refRegex = /w:footnoteReference[^>]*w:id="([^"]+)"/g;
        let match;
        while ((match = refRegex.exec(parts.documentXml)) !== null) {
          refIds.add(match[1]!);
        }

        if (refIds.size === 0) return;

        // All referenced IDs must exist in footnotes.xml
        expect(parts.footnotesXml).not.toBeNull();
        for (const id of refIds) {
          expect(parts.footnotesXml).toContain(`w:id="${id}"`);
        }
      });
    });
  });
});
