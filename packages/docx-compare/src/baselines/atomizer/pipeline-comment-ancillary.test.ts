import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { compareDocumentsAtomizer } from './pipeline.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Pipeline Comment Ancillary Merge' });

const COMMENTS_IDS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml';
const COMMENTS_IDS_REL_TYPE =
  'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds';

async function resultParts(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const read = async (path: string): Promise<string | null> =>
    (await zip.file(path)?.async('string')) ?? null;
  return {
    documentXml: await read('word/document.xml'),
    commentsXml: await read('word/comments.xml'),
    commentsExtendedXml: await read('word/commentsExtended.xml'),
    commentsIdsXml: await read('word/commentsIds.xml'),
    peopleXml: await read('word/people.xml'),
    contentTypesXml: await read('[Content_Types].xml'),
    relsXml: await read('word/_rels/document.xml.rels'),
  };
}

async function withCommentsIds(
  docx: Buffer,
  rows: ReadonlyArray<{ paraId: string; durableId: string }>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
  const relationships = await zip.file('word/_rels/document.xml.rels')!.async('string');
  const rowsXml = rows
    .map(
      ({ paraId, durableId }) =>
        `<w16cid:commentId w16cid:paraId="${paraId}" w16cid:durableId="${durableId}"/>`,
    )
    .join('');

  zip.file(
    'word/commentsIds.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">` +
      `${rowsXml}</w16cid:commentsIds>`,
  );
  zip.file(
    '[Content_Types].xml',
    contentTypes.replace(
      '</Types>',
      `<Override PartName="/word/commentsIds.xml" ContentType="${COMMENTS_IDS_CONTENT_TYPE}"/></Types>`,
    ),
  );
  zip.file(
    'word/_rels/document.xml.rels',
    relationships.replace(
      '</Relationships>',
      `<Relationship Id="rId99" Type="${COMMENTS_IDS_REL_TYPE}" Target="commentsIds.xml"/></Relationships>`,
    ),
  );
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

describe('pipeline comment ancillary publication', () => {
  test('rebuild bootstraps a new threaded comment graph and its durable identities', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('a revised document with a root comment, an unanchored reply, and all ancillary rows', async () => {
      original = await buildSyntheticDocx({ paragraphs: ['Commented text'] });
      revised = await withCommentsIds(
        await buildSyntheticDocx({
          paragraphs: ['Commented text'],
          commentOnParagraph: 0,
          commentText: 'Root review',
          commentAuthor: 'Root Author',
          replyText: 'Thread reply',
          replyAuthor: 'Reply Author',
          commentAncillaryParts: true,
        }),
        [
          { paraId: '00000001', durableId: '11111111' },
          { paraId: '00000002', durableId: '22222222' },
          { paraId: 'UNRELATED', durableId: '99999999' },
        ],
      );
    });

    await when('the comparison publishes the inserted comment through rebuild mode', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        author: 'Pipeline test',
      });
    });

    await then('the anchored root and graph-discovered reply definitions are both present', async () => {
      const parts = await resultParts(result.document);
      expect(parts.documentXml).toContain('<w:commentReference w:id="1"');
      expect(parts.commentsXml).toContain('Root review');
      expect(parts.commentsXml).toContain('Thread reply');
    });

    await and('threading, durable ids, authors, and revised-base metadata are retained', async () => {
      const parts = await resultParts(result.document);
      expect(parts.commentsExtendedXml).toContain('w15:paraId="00000002"');
      expect(parts.commentsExtendedXml).toContain('w15:paraIdParent="00000001"');
      expect(parts.commentsIdsXml).toContain('w16cid:durableId="11111111"');
      expect(parts.commentsIdsXml).toContain('w16cid:durableId="22222222"');
      expect(parts.commentsIdsXml).toContain('99999999');
      expect(parts.peopleXml).toContain('w15:author="Root Author"');
      expect(parts.peopleXml).toContain('w15:author="Reply Author"');
    });

    await and('every newly created ancillary part has OPC metadata', async () => {
      const parts = await resultParts(result.document);
      for (const path of [
        '/word/comments.xml',
        '/word/commentsExtended.xml',
        '/word/commentsIds.xml',
        '/word/people.xml',
      ]) {
        expect(parts.contentTypesXml).toContain(`PartName="${path}"`);
      }
      expect(parts.relsXml).toContain('Target="comments.xml"');
      expect(parts.relsXml).toContain('Target="commentsExtended.xml"');
      expect(parts.relsXml).toContain('Target="commentsIds.xml"');
      expect(parts.relsXml).toContain('Target="people.xml"');
    });
  });

  test('rebuild appends a colliding revised comment thread to existing ancillary parts', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;

    await given('both sides contain distinct comment id 1 graphs with extension metadata', async () => {
      original = await withCommentsIds(
        await buildSyntheticDocx({
          paragraphs: ['Original commented text'],
          commentOnParagraph: 0,
          commentText: 'Original root',
          commentAuthor: 'Original Author',
          commentAncillaryParts: true,
        }),
        [{ paraId: '00000001', durableId: 'AAAAAAAA' }],
      );
      revised = await withCommentsIds(
        await buildSyntheticDocx({
          paragraphs: ['Revised commented text'],
          commentOnParagraph: 0,
          commentText: 'Revised root',
          commentAuthor: 'Revised Author',
          replyText: 'Revised reply',
          replyAuthor: 'Reply Author',
          commentAncillaryParts: true,
        }),
        [
          { paraId: '00000001', durableId: 'BBBBBBBB' },
          { paraId: '00000002', durableId: 'CCCCCCCC' },
        ],
      );
    });

    await when('the pipeline resolves collisions and merges the revised graph', async () => {
      result = await compareDocumentsAtomizer(original, revised, {
        moveDetection: { detectMoves: false },
      });
    });

    await then('all root and reply definitions survive under distinct ids', async () => {
      const parts = await resultParts(result.document);
      expect(parts.commentsXml).toContain('Original root');
      expect(parts.commentsXml).toContain('Revised root');
      expect(parts.commentsXml).toContain('Revised reply');
      expect(parts.documentXml).toMatch(/<w:commentReference w:id="3"/);
    });

    await and('existing extension parts receive the revised thread rows and authors', async () => {
      const parts = await resultParts(result.document);
      expect(parts.commentsExtendedXml).toContain('w15:paraIdParent=');
      expect(parts.commentsIdsXml).toContain('AAAAAAAA');
      expect(parts.commentsIdsXml).toContain('BBBBBBBB');
      expect(parts.commentsIdsXml).toContain('CCCCCCCC');
      expect(parts.peopleXml).toContain('Original Author');
      expect(parts.peopleXml).toContain('Revised Author');
      expect(parts.peopleXml).toContain('Reply Author');
    });
  });
});
