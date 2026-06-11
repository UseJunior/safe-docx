/**
 * Integration Tests — Auxiliary Part ID Collisions (regression for issue #107)
 *
 * Auxiliary IDs reset to 1 per document, so two independently authored
 * documents routinely define *different* comments/footnotes/endnotes under
 * the same w:id. The definition merge used to treat "ID already present in
 * the result part" as success and skip the source side, leaving one side's
 * anchors bound to the other side's content (or missing entirely).
 *
 * The fix renumbers the revised side's colliding IDs before comparison, so
 * each anchor in the output resolves to the definition it was authored
 * against, in both reconstruction modes.
 *
 * Reported in https://github.com/UseJunior/safe-docx/issues/107 (surfaced by
 * peer review of PR #101).
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { buildSyntheticDocx, getResultParts } from './synthetic-docx-fixture.js';
import { parseXml } from '../primitives/xml.js';

/** Collect w:id values of every `tag` element in the XML. */
function idsOf(xml: string, tag: string): Set<string> {
  const ids = new Set<string>();
  const elements = parseXml(xml).getElementsByTagName(tag);
  for (let i = 0; i < elements.length; i++) {
    const id = elements[i]!.getAttribute('w:id');
    if (id) ids.add(id);
  }
  return ids;
}

/** Map each auxiliary entry's w:id to its author (comments) and text. */
function entriesById(
  partXml: string,
  entryTag: string
): Map<string, { author: string | null; text: string }> {
  const map = new Map<string, { author: string | null; text: string }>();
  const elements = parseXml(partXml).getElementsByTagName(entryTag);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    const id = el.getAttribute('w:id');
    if (!id) continue;
    map.set(id, { author: el.getAttribute('w:author'), text: el.textContent ?? '' });
  }
  return map;
}

/**
 * The issue-#107 acceptance invariant: every anchor in document.xml resolves
 * to a definition, and each side's content is present under its own ID.
 */
function expectAnchorsResolve(
  documentXml: string,
  partXml: string,
  referenceTag: string,
  entryTag: string
): Map<string, { author: string | null; text: string }> {
  const referencedIds = idsOf(documentXml, referenceTag);
  const definitions = entriesById(partXml, entryTag);
  expect(referencedIds.size).toBeGreaterThan(0);
  for (const id of referencedIds) {
    expect(definitions.has(id), `anchor w:id="${id}" has no ${entryTag} definition`).toBe(true);
  }
  return definitions;
}

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Auxiliary Part ID Collisions' });

describe('Auxiliary part ID collisions (issue #107)', () => {
  describe('Comment w:id="1" means different content on each side', () => {
    const buildInputs = async () => {
      const original = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        commentOnParagraph: 1,
        commentText: 'Original comment',
        commentAuthor: 'A',
      });
      const revised = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
        commentOnParagraph: 1,
        commentText: 'Revised comment',
        commentAuthor: 'B',
      });
      return { original, revised };
    };

    const expectBothCommentsCorrectlyBound = async (resultDoc: Buffer) => {
      const parts = await getResultParts(resultDoc);
      expect(parts.commentsXml).not.toBeNull();

      const definitions = expectAnchorsResolve(
        parts.documentXml, parts.commentsXml!, 'w:commentReference', 'w:comment'
      );

      // Both threads survive, each under its own ID with its own author.
      const byText = new Map(
        Array.from(definitions.entries()).map(([id, def]) => [def.text, { id, author: def.author }])
      );
      expect(byText.get('Original comment')?.author).toBe('A');
      expect(byText.get('Revised comment')?.author).toBe('B');
      expect(byText.get('Original comment')!.id).not.toBe(byText.get('Revised comment')!.id);

      // Range markers were renumbered in lockstep with the references.
      const startIds = idsOf(parts.documentXml, 'w:commentRangeStart');
      const endIds = idsOf(parts.documentXml, 'w:commentRangeEnd');
      expect(startIds).toEqual(endIds);
      for (const id of startIds) {
        expect(definitions.has(id), `commentRangeStart w:id="${id}" has no definition`).toBe(true);
      }
    };

    test('rebuild binds each anchor to its own side\'s comment', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides define a different comment under w:id="1"', async () => {
        ({ original, revised } = await buildInputs());
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('both comments ship under distinct IDs and every anchor resolves', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        await expectBothCommentsCorrectlyBound(result.document);
      });
    });

    test('inplace binds each anchor to its own side\'s comment', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides define a different comment under w:id="1"', async () => {
        ({ original, revised } = await buildInputs());
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in inplace mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'inplace',
        });
      });

      await then('both comments ship under distinct IDs and every anchor resolves', async () => {
        await expectBothCommentsCorrectlyBound(result.document);
      });
    });
  });

  describe('Footnote w:id="1" means different content on each side', () => {
    test('rebuild ships both footnotes under distinct IDs', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides define a different footnote under w:id="1"', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Original footnote',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Revised footnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('both footnotes ship and every reference resolves', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);
        expect(parts.footnotesXml).not.toBeNull();

        const definitions = expectAnchorsResolve(
          parts.documentXml, parts.footnotesXml!, 'w:footnoteReference', 'w:footnote'
        );
        const texts = new Set(Array.from(definitions.values()).map((d) => d.text));
        expect(texts).toContain('Original footnote');
        expect(texts).toContain('Revised footnote');
      });
    });
  });

  describe('Endnote w:id="1" means different content on each side', () => {
    test('rebuild ships both endnotes under distinct IDs', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides define a different endnote under w:id="1"', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          endnoteOnParagraph: 0,
          endnoteText: 'Original endnote',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          endnoteOnParagraph: 0,
          endnoteText: 'Revised endnote',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('both endnotes ship and every reference resolves', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);
        expect(parts.endnotesXml).not.toBeNull();

        const definitions = expectAnchorsResolve(
          parts.documentXml, parts.endnotesXml!, 'w:endnoteReference', 'w:endnote'
        );
        const texts = new Set(Array.from(definitions.values()).map((d) => d.text));
        expect(texts).toContain('Original endnote');
        expect(texts).toContain('Revised endnote');
      });
    });
  });

  describe('Comment anchored on footnote text (note-story anchors)', () => {
    test('rebuild renumbers the footnote-hosted comment anchor and ships its definition', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both w:id="1" spaces collide and the revised comment is anchored only inside its footnote', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Original footnote',
          commentOnParagraph: 1,
          commentText: 'Original comment',
          commentAuthor: 'A',
        });

        // The synthetic fixture can't anchor a comment inside a footnote
        // body, and this nesting is the subject of the test (surfaced by
        // peer review of this fix), so splice it in via archive mutation.
        const baseRevised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Second paragraph'],
          footnoteOnParagraph: 0,
          footnoteText: 'Revised footnote',
        });
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(baseRevised);

        const footnotesXml = await zip.file('word/footnotes.xml')!.async('string');
        zip.file(
          'word/footnotes.xml',
          footnotesXml.replace(
            '<w:t>Revised footnote</w:t></w:r>',
            '<w:t>Revised footnote</w:t></w:r>' +
              '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>'
          )
        );

        zip.file(
          'word/comments.xml',
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
            ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
            `<w:comment w:id="1" w:author="B" w:date="2025-01-01T00:00:00Z">` +
            `<w:p w14:paraId="00000009"><w:r><w:t>Revised comment</w:t></w:r></w:p>` +
            `</w:comment></w:comments>`
        );

        const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
        zip.file(
          '[Content_Types].xml',
          contentTypes.replace(
            '</Types>',
            `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`
          )
        );
        const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
        zip.file(
          'word/_rels/document.xml.rels',
          rels.replace(
            '</Relationships>',
            `<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`
          )
        );

        revised = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('the footnote-hosted anchor binds to the revised comment, not the original', async () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        const parts = await getResultParts(result.document);
        expect(parts.footnotesXml).not.toBeNull();
        expect(parts.commentsXml).not.toBeNull();

        const commentDefs = entriesById(parts.commentsXml!, 'w:comment');
        const footnoteDefs = entriesById(parts.footnotesXml!, 'w:footnote');

        // Both footnotes and both comments ship.
        const footnoteTexts = new Set(Array.from(footnoteDefs.values()).map((d) => d.text));
        expect(footnoteTexts).toContain('Original footnote');
        const commentTexts = new Set(Array.from(commentDefs.values()).map((d) => d.text));
        expect(commentTexts).toContain('Original comment');
        expect(commentTexts).toContain('Revised comment');

        // The revised footnote's internal comment anchor resolves to the
        // REVISED comment (pre-fix it kept w:id="1" → original's content).
        const revisedFootnote = Array.from(footnoteDefs.entries())
          .find(([, d]) => d.text.includes('Revised footnote'));
        expect(revisedFootnote).toBeDefined();
        const revisedFootnoteEl = parseXml(parts.footnotesXml!)
          .getElementsByTagName('w:footnote');
        let anchorId: string | null = null;
        for (let i = 0; i < revisedFootnoteEl.length; i++) {
          const el = revisedFootnoteEl[i]!;
          if ((el.textContent ?? '').includes('Revised footnote')) {
            anchorId = el.getElementsByTagName('w:commentReference')[0]?.getAttribute('w:id') ?? null;
          }
        }
        expect(anchorId).not.toBeNull();
        expect(commentDefs.get(anchorId!)?.text).toBe('Revised comment');
        expect(commentDefs.get(anchorId!)?.author).toBe('B');

        // No dangling comment anchors anywhere (body or note stories).
        for (const xml of [parts.documentXml, parts.footnotesXml!]) {
          for (const id of idsOf(xml, 'w:commentReference')) {
            expect(commentDefs.has(id), `dangling comment anchor w:id="${id}"`).toBe(true);
          }
        }
      });
    });
  });

  describe('Identical comment on both sides is NOT a collision', () => {
    test('shared comment keeps its ID and is not duplicated', async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer, revised: Buffer;
      await given('both sides carry the byte-identical comment under w:id="1"', async () => {
        original = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph'],
          commentOnParagraph: 1,
          commentText: 'Shared comment',
          commentAuthor: 'Alice',
        });
        revised = await buildSyntheticDocx({
          paragraphs: ['First paragraph', 'Commented paragraph'],
          commentOnParagraph: 1,
          commentText: 'Shared comment',
          commentAuthor: 'Alice',
        });
      });

      let result: Awaited<ReturnType<typeof compareDocuments>>;
      await when('documents are compared in rebuild mode', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
      });

      await then('exactly one comment definition ships under the original ID', async () => {
        const parts = await getResultParts(result.document);
        expect(parts.commentsXml).not.toBeNull();

        const definitions = entriesById(parts.commentsXml!, 'w:comment');
        expect(Array.from(definitions.keys())).toEqual(['1']);
        expect(idsOf(parts.documentXml, 'w:commentReference')).toEqual(new Set(['1']));
      });
    });
  });
});
