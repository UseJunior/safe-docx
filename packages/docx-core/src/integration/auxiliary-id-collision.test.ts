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
import type JSZip from 'jszip';

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

function firstCommentParagraphParaIds(commentsXml: string): string[] {
  const paraIds: string[] = [];
  const comments = parseXml(commentsXml).getElementsByTagName('w:comment');
  for (let i = 0; i < comments.length; i++) {
    const firstP = (comments[i] as Element).getElementsByTagName('w:p')[0] as Element | undefined;
    const paraId = firstP?.getAttribute('w14:paraId');
    if (paraId) paraIds.push(paraId);
  }
  return paraIds;
}

function commentParaIdByText(commentsXml: string): Map<string, string> {
  const byText = new Map<string, string>();
  const comments = parseXml(commentsXml).getElementsByTagName('w:comment');
  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i] as Element;
    const firstP = comment.getElementsByTagName('w:p')[0] as Element | undefined;
    const paraId = firstP?.getAttribute('w14:paraId');
    if (paraId) byText.set(comment.textContent ?? '', paraId);
  }
  return byText;
}

function commentExEntries(commentsExtendedXml: string): Array<{ paraId: string; parentParaId: string | null; done: string | null }> {
  const entries: Array<{ paraId: string; parentParaId: string | null; done: string | null }> = [];
  const elements = parseXml(commentsExtendedXml).getElementsByTagName('w15:commentEx');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Element;
    const paraId = el.getAttribute('w15:paraId');
    if (!paraId) continue;
    entries.push({
      paraId,
      parentParaId: el.getAttribute('w15:paraIdParent'),
      done: el.getAttribute('w15:done'),
    });
  }
  return entries;
}

function commentsIdsEntries(commentsIdsXml: string): Array<{ paraId: string; durableId: string | null }> {
  const entries: Array<{ paraId: string; durableId: string | null }> = [];
  const elements = parseXml(commentsIdsXml).getElementsByTagName('w16cid:commentId');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Element;
    const paraId = el.getAttribute('w16cid:paraId');
    if (!paraId) continue;
    entries.push({ paraId, durableId: el.getAttribute('w16cid:durableId') });
  }
  return entries;
}

async function expectThreadedCommentParaIdsCorrect(resultDoc: Buffer): Promise<void> {
  const parts = await getResultParts(resultDoc);
  expect(parts.commentsXml).not.toBeNull();
  expect(parts.commentsExtendedXml).not.toBeNull();

  const paraIds = firstCommentParagraphParaIds(parts.commentsXml!);
  expect(paraIds).toHaveLength(4);
  expect(new Set(paraIds).size).toBe(4);

  const paraIdSet = new Set(paraIds);
  const exEntries = commentExEntries(parts.commentsExtendedXml!);
  expect(exEntries).toHaveLength(4);
  for (const entry of exEntries) {
    expect(paraIdSet.has(entry.paraId), `commentEx paraId="${entry.paraId}" has no comment paragraph`).toBe(true);
  }

  const byText = commentParaIdByText(parts.commentsXml!);
  const revisedReply = exEntries.find((entry) => entry.paraId === byText.get('Revised reply'));
  const originalReply = exEntries.find((entry) => entry.paraId === byText.get('Original reply'));
  expect(revisedReply?.parentParaId).toBe(byText.get('Revised comment'));
  expect(originalReply?.parentParaId).toBe(byText.get('Original comment'));
}

async function spliceZip(buffer: Buffer, mutate: (zip: JSZip) => Promise<void>): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  await mutate(zip);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

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

describe('Comment paraId collisions (issue #448)', () => {
  const buildThreadedInputs = async () => {
    const original = await buildSyntheticDocx({
      paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
      commentOnParagraph: 1,
      commentText: 'Original comment',
      commentAuthor: 'A',
      replyText: 'Original reply',
      replyAuthor: 'AA',
      commentAncillaryParts: true,
    });
    const revised = await buildSyntheticDocx({
      paragraphs: ['First paragraph', 'Commented paragraph', 'Third paragraph'],
      commentOnParagraph: 1,
      commentText: 'Revised comment',
      commentAuthor: 'B',
      replyText: 'Revised reply',
      replyAuthor: 'BB',
      commentAncillaryParts: true,
    });
    return { original, revised };
  };

  test('rebuild keeps commentEx threading bound to each side after paraId restamp', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('both sides have threaded comments with colliding comment paragraph paraIds', async () => {
      ({ original, revised } = await buildThreadedInputs());
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in rebuild mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
    });

    await then('all commentEx rows resolve and reply parents stay on the same side', async () => {
      expect(result.reconstructionModeUsed).toBe('rebuild');
      await expectThreadedCommentParaIdsCorrect(result.document);
    });
  });

  test('inplace keeps commentEx threading bound to each side after paraId restamp', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('both sides have threaded comments with colliding comment paragraph paraIds', async () => {
      ({ original, revised } = await buildThreadedInputs());
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in inplace mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
    });

    await then('all commentEx rows resolve and reply parents stay on the same side', async () => {
      expect(result.reconstructionModeUsed).toBe('inplace');
      await expectThreadedCommentParaIdsCorrect(result.document);
    });
  });

  test('identical threaded comments are not restamped', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('both sides carry byte-identical threaded comments and ancillary rows', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Shared comment',
        commentAuthor: 'Alice',
        replyText: 'Shared reply',
        replyAuthor: 'Bob',
        commentAncillaryParts: true,
      });
      revised = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Shared comment',
        commentAuthor: 'Alice',
        replyText: 'Shared reply',
        replyAuthor: 'Bob',
        commentAncillaryParts: true,
      });
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in rebuild mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
    });

    await then('the shared paraIds remain unchanged and are not duplicated', async () => {
      const parts = await getResultParts(result.document);
      expect(parts.commentsXml).not.toBeNull();
      expect(parts.commentsExtendedXml).not.toBeNull();
      expect(new Set(firstCommentParagraphParaIds(parts.commentsXml!))).toEqual(
        new Set(['00000001', '00000002'])
      );
      expect(commentExEntries(parts.commentsExtendedXml!).map((entry) => entry.paraId)).toEqual([
        '00000001',
        '00000002',
      ]);
      expect(parts.commentsExtendedXml!).toContain('w15:paraIdParent="00000001"');
    });
  });

  test('same paraId with different comment IDs still restamps', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('comment IDs do not collide but comment paragraph paraIds do', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Original comment',
        commentAuthor: 'A',
        commentAncillaryParts: true,
      });
      const baseRevised = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Revised comment',
        commentAuthor: 'B',
        commentAncillaryParts: true,
      });
      revised = await spliceZip(baseRevised, async (zip) => {
        const commentsXml = await zip.file('word/comments.xml')!.async('string');
        zip.file('word/comments.xml', commentsXml.replace('w:id="1"', 'w:id="5"'));
        const documentXml = await zip.file('word/document.xml')!.async('string');
        zip.file(
          'word/document.xml',
          documentXml
            .replaceAll('w:commentRangeStart w:id="1"', 'w:commentRangeStart w:id="5"')
            .replaceAll('w:commentRangeEnd w:id="1"', 'w:commentRangeEnd w:id="5"')
            .replaceAll('w:commentReference w:id="1"', 'w:commentReference w:id="5"')
        );
      });
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in rebuild mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'rebuild',
      });
    });

    await then('both comments ship with distinct paraIds and commentEx rows', async () => {
      const parts = await getResultParts(result.document);
      expect(parts.commentsXml).not.toBeNull();
      expect(parts.commentsExtendedXml).not.toBeNull();
      const byText = commentParaIdByText(parts.commentsXml!);
      expect(byText.get('Original comment')).toBeDefined();
      expect(byText.get('Revised comment')).toBeDefined();
      expect(byText.get('Original comment')).not.toBe(byText.get('Revised comment'));
      const exParaIds = new Set(commentExEntries(parts.commentsExtendedXml!).map((entry) => entry.paraId));
      expect(exParaIds.has(byText.get('Original comment')!)).toBe(true);
      expect(exParaIds.has(byText.get('Revised comment')!)).toBe(true);
    });
  });

  test('inplace restamps commentsIds.xml durable ID rows with revised comments', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('the revised archive carries Word commentsIds.xml rows for colliding paraIds', async () => {
      ({ original, revised } = await buildThreadedInputs());
      revised = await spliceZip(revised, async (zip) => {
        zip.file(
          'word/commentsIds.xml',
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">` +
            `<w16cid:commentId w16cid:paraId="00000001" w16cid:durableId="11111111"/>` +
            `<w16cid:commentId w16cid:paraId="00000002" w16cid:durableId="22222222"/>` +
            `</w16cid:commentsIds>`
        );
        const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
        zip.file(
          '[Content_Types].xml',
          contentTypes.replace(
            '</Types>',
            `<Override PartName="/word/commentsIds.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml"/></Types>`
          )
        );
        const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
        zip.file(
          'word/_rels/document.xml.rels',
          rels.replace(
            '</Relationships>',
            `<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="commentsIds.xml"/></Relationships>`
          )
        );
      });
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in inplace mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
    });

    await then('commentsIds rows point at the restamped revised comment paragraphs', async () => {
      const parts = await getResultParts(result.document);
      expect(parts.commentsXml).not.toBeNull();
      expect(parts.commentsIdsXml).not.toBeNull();
      const commentParaIds = new Set(firstCommentParagraphParaIds(parts.commentsXml!));
      const idsEntries = commentsIdsEntries(parts.commentsIdsXml!);
      expect(idsEntries.map((entry) => entry.durableId)).toEqual(['11111111', '22222222']);
      for (const entry of idsEntries) {
        expect(commentParaIds.has(entry.paraId), `commentsIds paraId="${entry.paraId}" has no comment paragraph`).toBe(true);
      }
    });
  });

  test('inplace restamps dangling ancillary paraIds that would bind to original comments', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer, revised: Buffer;
    await given('a revised dangling commentEx row collides with an original comment paraId', async () => {
      original = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Original comment',
        commentAuthor: 'A',
        commentAncillaryParts: true,
      });
      const baseRevised = await buildSyntheticDocx({
        paragraphs: ['First paragraph', 'Commented paragraph'],
        commentOnParagraph: 1,
        commentText: 'Revised comment',
        commentAuthor: 'B',
        commentAncillaryParts: true,
      });
      revised = await spliceZip(baseRevised, async (zip) => {
        const commentsXml = await zip.file('word/comments.xml')!.async('string');
        zip.file('word/comments.xml', commentsXml.replace('w14:paraId="00000001"', 'w14:paraId="00000009"'));
        const commentsExtendedXml = await zip.file('word/commentsExtended.xml')!.async('string');
        zip.file(
          'word/commentsExtended.xml',
          commentsExtendedXml
            .replace('w15:paraId="00000001"', 'w15:paraId="00000009"')
            .replace(
              '</w15:commentsEx>',
              `<w15:commentEx w15:paraId="00000001" w15:done="1"/></w15:commentsEx>`
            )
        );
      });
    });

    let result: Awaited<ReturnType<typeof compareDocuments>>;
    await when('documents are compared in inplace mode', async () => {
      result = await compareDocuments(original, revised, {
        engine: 'atomizer',
        reconstructionMode: 'inplace',
      });
    });

    await then('the dangling row no longer uses the original comment paraId', async () => {
      const parts = await getResultParts(result.document);
      expect(parts.commentsXml).not.toBeNull();
      expect(parts.commentsExtendedXml).not.toBeNull();
      const originalParaId = commentParaIdByText(parts.commentsXml!).get('Original comment');
      const danglingEntry = commentExEntries(parts.commentsExtendedXml!).find((entry) => entry.done === '1');
      expect(danglingEntry).toBeDefined();
      expect(danglingEntry!.paraId).not.toBe(originalParaId);
    });
  });
});
