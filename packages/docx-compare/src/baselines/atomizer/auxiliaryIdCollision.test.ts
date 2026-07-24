/**
 * Characterization tests for auxiliaryIdCollision.ts
 *
 * Auxiliary part IDs (`w:id` on comments/footnotes/endnotes) and comment
 * `w14:paraId` values are document-local, so two independently authored inputs
 * routinely reuse the same numbers for different content. This module renumbers
 * / restamps the revised side before comparison so no anchor ever binds to the
 * other document's content. These tests pin that behaviour end-to-end against
 * in-memory archives, covering the collision fast paths, the cross-story anchor
 * rewrite, fresh-ID allocation over the union of both sides, and the comment
 * paraId ancillary-part axis (commentsExtended.xml / commentsIds.xml).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/107
 * @see https://github.com/UseJunior/safe-docx/issues/448
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { DocxArchive } from '@usejunior/docx-core';
import {
  AUXILIARY_PARTS,
  parseEntries,
  renumberCollidingAuxiliaryIds,
  restampCollidingCommentParaIds,
} from './auxiliaryIdCollision.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Auxiliary ID Collision' });

/** Build an in-memory archive seeded with the given part files. */
async function archiveWith(files: Record<string, string>): Promise<DocxArchive> {
  const archive = await DocxArchive.create();
  for (const [path, content] of Object.entries(files)) {
    archive.setFile(path, content);
  }
  return archive;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:w14="http://schemas.openxmlformats.org/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.openxmlformats.org/office/word/2012/wordml" ' +
  'xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"';

function commentsPart(comments: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${NS}>${comments}</w:comments>`;
}

function footnotesPart(footnotes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${NS}>${footnotes}</w:footnotes>`;
}

function documentPart(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}</w:body></w:document>`;
}

/** A comment definition whose text carries an optional paraId. */
function comment(id: string, text: string, paraId?: string): string {
  const paraIdAttr = paraId ? ` w14:paraId="${paraId}"` : '';
  return `<w:comment w:id="${id}"><w:p${paraIdAttr}><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
}

describe('parseEntries', () => {
  test('maps entry elements by w:id and skips entries without one', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let xml: string;
    let result: ReturnType<typeof parseEntries>;

    await given('a comments part with two id-bearing comments and one without an id', () => {
      xml = commentsPart(
        `${comment('1', 'first')}${comment('2', 'second')}<w:comment><w:p><w:r><w:t>orphan</w:t></w:r></w:p></w:comment>`
      );
    });

    await when('the entries are parsed by the w:comment tag', () => {
      result = parseEntries(xml, 'w:comment');
    });

    await then('only the id-bearing entries are keyed', () => {
      expect([...result.entries.keys()].sort()).toEqual(['1', '2']);
    });

    await and('each mapped value is the matching comment element', () => {
      expect(result.entries.get('1')?.getAttribute('w:id')).toBe('1');
      expect(result.entries.get('2')?.getAttribute('w:id')).toBe('2');
    });
  });
});

describe('AUXILIARY_PARTS descriptor table', () => {
  test('declares the comment part with all three id-bearing anchor tags', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let comment: (typeof AUXILIARY_PARTS)[number] | undefined;

    await given('the shared auxiliary part descriptor table', () => {
      expect(AUXILIARY_PARTS.map((d) => d.label).sort()).toEqual([
        'comment',
        'endnote',
        'footnote',
      ]);
    });

    await when('the comment descriptor is selected', () => {
      comment = AUXILIARY_PARTS.find((d) => d.label === 'comment');
    });

    await then('it anchors via reference plus both range markers', () => {
      expect(comment?.idBearingTags).toEqual([
        'w:commentReference',
        'w:commentRangeStart',
        'w:commentRangeEnd',
      ]);
    });
  });
});

describe('renumberCollidingAuxiliaryIds', () => {
  test('returns no renumberings when a part is missing on one side', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;

    await given('only the revised side defines comments', async () => {
      original = await archiveWith({});
      revised = await archiveWith({ 'word/comments.xml': commentsPart(comment('1', 'hello')) });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('nothing is renumbered because a collision needs both sides', () => {
      expect(result).toEqual([]);
    });
  });

  test('leaves content-identical definitions untouched (byte-stable derived docs)', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;
    const identical = commentsPart(comment('1', 'same text'));

    await given('both sides define comment id 1 with identical content', async () => {
      original = await archiveWith({ 'word/comments.xml': identical });
      revised = await archiveWith({ 'word/comments.xml': identical });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('no renumbering is applied', () => {
      expect(result).toEqual([]);
    });

    await and('the revised comment keeps its original id', async () => {
      expect(await revised.getFile('word/comments.xml')).toBe(identical);
    });
  });

  test('renumbers a colliding comment definition and its document anchors', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;

    await given('both sides define comment id 1 but with different content', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original note')),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised note')),
        'word/document.xml': documentPart(
          '<w:commentRangeStart w:id="1"/><w:r><w:t>body</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>'
        ),
      });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('the revised comment id is reported as renumbered to a fresh value', () => {
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ label: 'comment', fromId: '1' });
      expect(Number.parseInt(result[0]!.toId, 10)).toBeGreaterThan(1);
    });

    await and('the revised definition carries the new id', async () => {
      const xml = (await revised.getFile('word/comments.xml'))!;
      const toId = result[0]!.toId;
      expect(xml).toContain(`w:id="${toId}"`);
      expect(xml).not.toContain('w:id="1"');
    });

    await and('every id-bearing anchor in document.xml is rewritten to match', async () => {
      const xml = (await revised.getFile('word/document.xml'))!;
      const toId = result[0]!.toId;
      expect(xml).toContain(`<w:commentRangeStart w:id="${toId}"/>`);
      expect(xml).toContain(`<w:commentRangeEnd w:id="${toId}"/>`);
      expect(xml).toContain(`<w:commentReference w:id="${toId}"/>`);
      expect(xml).not.toContain('w:id="1"');
    });
  });

  test('allocates fresh ids above the union of both sides so nothing is reused', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;

    await given('the original also defines a high id 9 that the revised side lacks', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(
          `${comment('1', 'original one')}${comment('9', 'original nine')}`
        ),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised one')),
      });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('the fresh id clears the original-only id 9 (>= 10)', () => {
      expect(result).toHaveLength(1);
      expect(Number.parseInt(result[0]!.toId, 10)).toBeGreaterThanOrEqual(10);
    });
  });

  test('never renumbers footnote separator entries', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;
    const separators =
      '<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>';

    await given('both sides share separator entries but no real colliding footnote', async () => {
      original = await archiveWith({
        'word/footnotes.xml': footnotesPart(
          `${separators}<w:footnote w:id="1"><w:p><w:r><w:t>orig</w:t></w:r></w:p></w:footnote>`
        ),
      });
      revised = await archiveWith({
        'word/footnotes.xml': footnotesPart(
          `${separators}<w:footnote w:id="2"><w:p><w:r><w:t>rev</w:t></w:r></w:p></w:footnote>`
        ),
      });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('the shared separators alone trigger no renumbering', () => {
      expect(result).toEqual([]);
    });

    await and('the revised separators keep their canonical -1 / 0 ids', async () => {
      const xml = (await revised.getFile('word/footnotes.xml'))!;
      expect(xml).toContain('w:id="-1"');
      expect(xml).toContain('w:id="0"');
    });
  });

  test('ignores non-numeric ids and anchors missing w:id when allocating fresh ids', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;

    await given('the original mixes a non-numeric id and the document has an anchor lacking w:id', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(
          `${comment('1', 'original note')}<w:comment w:id="not-a-number"><w:p><w:r><w:t>weird</w:t></w:r></w:p></w:comment>`
        ),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised note')),
        // A stray commentReference with no w:id must not derail max-id tracking.
        'word/document.xml': documentPart(
          '<w:commentRangeStart w:id="1"/><w:r><w:t>b</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference/></w:r>'
        ),
      });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('the non-numeric id contributes nothing and a numeric fresh id is chosen', () => {
      expect(result).toHaveLength(1);
      expect(Number.parseInt(result[0]!.toId, 10)).toBeGreaterThan(1);
    });
  });

  test('rewrites a colliding comment anchored inside the footnotes story', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof renumberCollidingAuxiliaryIds>>;

    await given('the revised comment is anchored on footnote text, not document body', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original note')),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised note')),
        'word/footnotes.xml': footnotesPart(
          '<w:footnote w:id="2"><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>fn</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p></w:footnote>'
        ),
      });
    });

    await when('collisions are resolved', async () => {
      result = await renumberCollidingAuxiliaryIds(original, revised);
    });

    await then('the comment id is renumbered', () => {
      expect(result).toHaveLength(1);
      expect(result[0]!.fromId).toBe('1');
    });

    await and('the anchors living inside footnotes.xml are rewritten to the fresh id', async () => {
      const xml = (await revised.getFile('word/footnotes.xml'))!;
      const toId = result[0]!.toId;
      expect(xml).toContain(`<w:commentRangeStart w:id="${toId}"/>`);
      expect(xml).toContain(`<w:commentReference w:id="${toId}"/>`);
      expect(xml).not.toContain('w:commentRangeStart w:id="1"');
    });
  });
});

describe('restampCollidingCommentParaIds', () => {
  test('returns nothing when the original defines no comments', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;

    await given('the original side has no comments.xml', async () => {
      original = await archiveWith({});
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'rev', '0A0A0A0A')),
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the pass is a no-op', () => {
      expect(result).toEqual([]);
    });
  });

  test('leaves an identical single-owner comment paraId untouched', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const identical = commentsPart(comment('1', 'same', '0A0A0A0A'));

    await given('both sides carry the same paraId on identical comment content', async () => {
      original = await archiveWith({ 'word/comments.xml': identical });
      revised = await archiveWith({ 'word/comments.xml': identical });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('no restamp is applied', () => {
      expect(result).toEqual([]);
    });
  });

  test('restamps a colliding paraId across comments, extended, and ids parts', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const paraId = '0A0A0A0A';

    await given('both sides reuse paraId 0A0A0A0A for different comment content', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original text', paraId)),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised text', paraId)),
        'word/commentsExtended.xml': `<?xml version="1.0"?>\n<w15:commentsEx ${NS}><w15:commentEx w15:paraId="${paraId}" w15:done="0"/></w15:commentsEx>`,
        'word/commentsIds.xml': `<?xml version="1.0"?>\n<w16cid:commentsIds ${NS}><w16cid:commentId w16cid:paraId="${paraId}" w16cid:durableId="11111111"/></w16cid:commentsIds>`,
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the colliding paraId is restamped to a fresh 8-hex-digit value', () => {
      expect(result).toHaveLength(1);
      expect(result[0]!.fromParaId).toBe(paraId);
      expect(result[0]!.toParaId).toMatch(/^[0-9A-F]{8}$/);
      expect(result[0]!.toParaId).not.toBe('00000000');
    });

    await and('the comment, extended, and ids parts all reference the new paraId', async () => {
      const toParaId = result[0]!.toParaId;
      const comments = (await revised.getFile('word/comments.xml'))!;
      const extended = (await revised.getFile('word/commentsExtended.xml'))!;
      const ids = (await revised.getFile('word/commentsIds.xml'))!;
      expect(comments).toContain(`w14:paraId="${toParaId}"`);
      expect(extended).toContain(`w15:paraId="${toParaId}"`);
      expect(ids).toContain(`w16cid:paraId="${toParaId}"`);
      expect(comments).not.toContain(`w14:paraId="${paraId}"`);
    });
  });

  test('restamps a paraId that only the ancillary parts reference on the revised side', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const paraId = '0B0B0B0B';

    await given('the revised paraId is absent from comments.xml but present in commentsExtended', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original', paraId)),
      });
      revised = await archiveWith({
        // Revised comment paragraph carries a *different*, non-colliding paraId...
        'word/comments.xml': commentsPart(comment('1', 'revised', 'CCCCCCCC')),
        // ...but an ancillary row still references the colliding paraId.
        'word/commentsExtended.xml': `<?xml version="1.0"?>\n<w15:commentsEx ${NS}><w15:commentEx w15:paraId="${paraId}" w15:done="0"/></w15:commentsEx>`,
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the ancillary-only paraId is still restamped', () => {
      expect(result.map((r) => r.fromParaId)).toContain(paraId);
    });

    await and('the extended part is rewritten to the fresh value', async () => {
      const restamp = result.find((r) => r.fromParaId === paraId)!;
      const extended = (await revised.getFile('word/commentsExtended.xml'))!;
      expect(extended).toContain(`w15:paraId="${restamp.toParaId}"`);
    });
  });

  test('returns nothing when the original comments carry no paraIds at all', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;

    await given('the original comment paragraph has no w14:paraId', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original, unstamped')),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised', '0A0A0A0A')),
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('there is nothing to collide against, so the pass is a no-op', () => {
      expect(result).toEqual([]);
    });
  });

  test('flags a multi-owner paraId as colliding even when content matches', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const paraId = '0C0C0C0C';

    await given('the original binds one paraId to two distinct comments', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(
          `${comment('1', 'first owner', paraId)}${comment('2', 'second owner', paraId)}`
        ),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised', paraId)),
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the shared paraId is restamped because it is not a clean single-owner match', () => {
      expect(result).toHaveLength(1);
      expect(result[0]!.fromParaId).toBe(paraId);
    });

    await and('the revised comment is rewritten to the fresh paraId', async () => {
      const comments = (await revised.getFile('word/comments.xml'))!;
      expect(comments).toContain(`w14:paraId="${result[0]!.toParaId}"`);
    });
  });

  test('deduplicates a paraId repeated across paragraphs within one comment', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const paraId = '0D0D0D0D';
    // A comment whose two paragraphs both carry the same paraId — the owner
    // must be recorded once, not twice.
    const twoParaComment = `<w:comment w:id="1"><w:p w14:paraId="${paraId}"><w:r><w:t>a</w:t></w:r></w:p><w:p w14:paraId="${paraId}"><w:r><w:t>b</w:t></w:r></w:p></w:comment>`;

    await given('a revised comment repeats one paraId across two paragraphs', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original', paraId)),
      });
      revised = await archiveWith({ 'word/comments.xml': commentsPart(twoParaComment) });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the collision is detected once and restamped once', () => {
      expect(result).toHaveLength(1);
      expect(result[0]!.fromParaId).toBe(paraId);
    });
  });

  test('restamps an ancillary-only paraId when the revised side has no comments.xml', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;
    const paraId = '0E0E0E0E';

    await given('the revised side ships commentsExtended but no comments.xml', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original', paraId)),
      });
      revised = await archiveWith({
        'word/commentsExtended.xml': `<?xml version="1.0"?>\n<w15:commentsEx ${NS}><w15:commentEx w15:paraId="${paraId}" w15:done="0"/></w15:commentsEx>`,
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the ancillary reference is still restamped', () => {
      expect(result.map((r) => r.fromParaId)).toContain(paraId);
    });

    await and('the extended part carries the fresh paraId', async () => {
      const restamp = result.find((r) => r.fromParaId === paraId)!;
      const extended = (await revised.getFile('word/commentsExtended.xml'))!;
      expect(extended).toContain(`w15:paraId="${restamp.toParaId}"`);
    });
  });

  test('treats paraId collisions case-insensitively', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let original: DocxArchive;
    let revised: DocxArchive;
    let result: Awaited<ReturnType<typeof restampCollidingCommentParaIds>>;

    await given('the two sides spell the same paraId in different letter case', async () => {
      original = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'original', 'abcd1234')),
      });
      revised = await archiveWith({
        'word/comments.xml': commentsPart(comment('1', 'revised', 'ABCD1234')),
      });
    });

    await when('paraId collisions are resolved', async () => {
      result = await restampCollidingCommentParaIds(original, revised);
    });

    await then('the case-different paraId is recognized as a collision and restamped', () => {
      expect(result).toHaveLength(1);
      expect(result[0]!.fromParaId).toBe('ABCD1234');
    });
  });
});
