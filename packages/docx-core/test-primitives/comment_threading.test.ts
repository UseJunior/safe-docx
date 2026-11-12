import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import {
  addComment, addCommentReply, deleteComment, getComment, getComments, updateCommentBody,
  type Comment,
} from '../src/primitives/comments.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { DocxZip } from '../src/primitives/zip.js';
import {
  buildCommentThreadingDocx, type ThreadedCommentFixture,
} from '../src/testing/comment-threading-fixture.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Comments' });
const nestedThread: ThreadedCommentFixture[] = [
  { id: 0, paragraphs: ['Parent first.', 'Parent last.'] },
  { id: 1, paragraphs: ['Reply first.', 'Reply last.'], parentId: 0 },
  { id: 2, paragraphs: ['Sibling reply.'], parentId: 0 },
  { id: 3, paragraphs: ['Nested first.', 'Nested last.'], parentId: 1 },
  { id: 4, paragraphs: ['Independent parent.'] },
  { id: 5, paragraphs: ['Independent reply.'], parentId: 4 },
];

async function loadFixture(comments: ThreadedCommentFixture[]) {
  const zip = await DocxZip.load(await buildCommentThreadingDocx(comments));
  return { zip, doc: parseXml(await zip.readText('word/document.xml')) };
}

function edges(comments: Comment[], parent = 'root'): string[] {
  return comments.flatMap((comment) => [`${comment.id}->${parent}`, ...edges(comment.replies, String(comment.id))]);
}

async function definitions(zip: DocxZip): Promise<Element[]> {
  return Array.from(parseXml(await zip.readText('word/comments.xml'))
    .getElementsByTagNameNS(OOXML.W_NS, 'comment')) as Element[];
}

async function extensionRows(zip: DocxZip): Promise<Element[]> {
  return Array.from(parseXml(await zip.readText('word/commentsExtended.xml'))
    .getElementsByTagNameNS(OOXML.W15_NS, 'commentEx')) as Element[];
}

function paragraphIds(comment: Element): (string | null)[] {
  return Array.from(comment.getElementsByTagNameNS(OOXML.W_NS, 'p'))
    .map((paragraph) => (paragraph as Element).getAttributeNS(OOXML.W14_NS, 'paraId'));
}

describe('comment threading uses the last paragraph identity (#1224)', () => {
  for (const paragraphs of [['Parent comment.'], ['Parent first.', 'Parent last.']]) {
    test(`retains both replies under a ${paragraphs.length}-paragraph parent`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      let comments!: Comment[];
      await given('Word-style XML with two independently authored replies', async () => {
        fixture = await loadFixture([
          { id: 0, paragraphs },
          { id: 1, paragraphs: ['Reply one.'], parentId: 0, author: 'Reviewer A' },
          { id: 2, paragraphs: ['Reply two.'], parentId: 0, author: 'Reviewer B' },
        ]);
      });
      await when('comments are loaded', async () => {
        comments = await getComments(fixture.zip, fixture.doc);
      });
      await then('the parent and both replies retain their content and exact relationships', async () => {
        expect(edges(comments)).toEqual(['0->root', '1->0', '2->0']);
        expect(comments[0]!.text).toBe(paragraphs.join('\n'));
        expect(comments[0]!.paragraphId).toBe(paragraphs.length === 1 ? '10000000' : '20000001');
        expect(comments[0]!.replies.map(({ text, author }) => ({ text, author }))).toEqual([
          { text: 'Reply one.', author: 'Reviewer A' }, { text: 'Reply two.', author: 'Reviewer B' },
        ]);
      });
    });
  }

  test('retains multi-paragraph replies, nested replies, and an independent thread', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('two threads including a multi-paragraph reply with its own reply', async () => {
      fixture = await loadFixture(nestedThread);
    });
    await when('the complete thread tree is read', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('every comment appears exactly once under its immediate parent', async () => {
      expect(edges(comments)).toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
      expect(await getComment(fixture.zip, fixture.doc, 3)).toMatchObject({
        text: 'Nested first.\nNested last.', paragraphId: '20000031',
      });
    });
  });

  for (const [parentId, expectedParaId] of [[0, '20000001'], [1, '20000011']] as const) {
    test(`links a new reply to multi-paragraph comment ${parentId} without changing existing edges`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      let priorRows!: string[];
      let newId!: number;
      await given('an existing nested thread and an independent thread', async () => {
        fixture = await loadFixture(nestedThread);
        priorRows = (await extensionRows(fixture.zip)).map(serializeXml);
      });
      await when('a reply is added to the selected parent', async () => {
        newId = (await addCommentReply(fixture.doc, fixture.zip, {
          parentCommentId: parentId, author: 'New reviewer', text: 'New reply.',
        })).commentId;
      });
      await then('the new edge uses the last paragraph and every existing edge survives', async () => {
        const rows = await extensionRows(fixture.zip);
        expect(rows.slice(0, priorRows.length).map(serializeXml)).toEqual(priorRows);
        expect(rows[priorRows.length]!.getAttributeNS(OOXML.W15_NS, 'paraIdParent')).toBe(expectedParaId);
        const comments = await getComments(fixture.zip, fixture.doc);
        expect(edges(comments).filter((edge) => !edge.startsWith(`${newId}->`)))
          .toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
        expect(edges(comments)).toContain(`${newId}->${parentId}`);
      });
    });
  }

  for (const [commentId, expectedIds, expectedEdges] of [
    [0, [4, 5], ['4->root', '5->4']],
    [1, [0, 2, 4, 5], ['0->root', '2->0', '4->root', '5->4']],
  ] as const) {
    test(`deletes multi-paragraph comment ${commentId} and its descendants while retaining other relationships`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      await given('a nested thread with a sibling and an independent thread', async () => {
        fixture = await loadFixture(nestedThread);
      });
      await when('the selected subtree is deleted', async () => {
        await deleteComment(fixture.doc, fixture.zip, { commentId });
      });
      await then('comment definitions, extension rows, and range markers agree on the surviving threads', async () => {
        const remaining = await definitions(fixture.zip);
        expect(remaining.map((comment) => Number(comment.getAttributeNS(OOXML.W_NS, 'id')))).toEqual(expectedIds);
        expect((await extensionRows(fixture.zip)).map((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId')))
          .toEqual(remaining.map((comment) => paragraphIds(comment).at(-1)));
        for (const tag of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
          expect(Array.from(fixture.doc.getElementsByTagNameNS(OOXML.W_NS, tag))
            .map((marker) => Number((marker as Element).getAttributeNS(OOXML.W_NS, 'id')))).toEqual(expectedIds);
        }
        expect(edges(await getComments(fixture.zip, fixture.doc))).toEqual(expectedEdges);
      });
    });
  }

  test('creates structured multi-paragraph roots and replies with their identity on the final paragraph', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    await given('a document without comments', async () => {
      fixture = await loadFixture([]);
    });
    await when('a two-paragraph root, two-paragraph reply, and nested reply are added', async () => {
      const root = await addComment(fixture.doc, fixture.zip, {
        paragraphEl: fixture.doc.getElementsByTagNameNS(OOXML.W_NS, 'p').item(0) as Element,
        author: 'Reviewer', text: '', body: [{ runs: [{ text: 'Root first.' }] }, { runs: [{ text: 'Root last.' }] }],
      });
      const reply = await addCommentReply(fixture.doc, fixture.zip, {
        parentCommentId: root.commentId, author: 'Reviewer', text: '',
        body: [{ runs: [{ text: 'Reply first.' }] }, { runs: [{ text: 'Reply last.' }] }],
      });
      await addCommentReply(fixture.doc, fixture.zip, { parentCommentId: reply.commentId, author: 'Reviewer', text: 'Nested.' });
    });
    await then('serialized extension rows identify each definition by its final paragraph', async () => {
      const comments = await definitions(fixture.zip);
      const lastIds = comments.map((comment) => paragraphIds(comment).at(-1));
      for (const id of lastIds) expect(id).toMatch(/^[0-9A-F]{8}$/);
      const rows = await extensionRows(fixture.zip);
      expect(rows.map((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId')).sort()).toEqual([...lastIds].sort());
      expect(rows.find((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId') === lastIds[1])!
        .getAttributeNS(OOXML.W15_NS, 'paraIdParent')).toBe(lastIds[0]);
      expect(rows.find((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId') === lastIds[2])!
        .getAttributeNS(OOXML.W15_NS, 'paraIdParent')).toBe(lastIds[1]);
      expect(edges(await getComments(fixture.zip, fixture.doc))).toEqual(['0->root', '1->0', '2->1']);
    });
  });

  for (const [commentId, newCount] of [[0, 1], [0, 3], [1, 1], [1, 3]] as const) {
    test(`preserves thread identity when comment ${commentId} changes from two paragraphs to ${newCount}`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      let extensionBefore!: string;
      let durableIdsBefore!: string;
      let documentBefore!: string;
      await given('a Word-authored nested thread with durable IDs', async () => {
        fixture = await loadFixture(nestedThread);
        extensionBefore = await fixture.zip.readText('word/commentsExtended.xml');
        durableIdsBefore = await fixture.zip.readText('word/commentsIds.xml');
        documentBefore = serializeXml(fixture.doc);
      });
      await when('the root or reply body changes paragraph count', async () => {
        await updateCommentBody(fixture.zip, { commentId, text: '',
          body: Array.from({ length: newCount }, (_, index) => ({ runs: [{ text: `Updated ${index + 1}.` }] })),
        });
      });
      await then('its original identity follows the last paragraph without changing any side-part relationships', async () => {
        const comment = (await definitions(fixture.zip)).find((element) => element.getAttributeNS(OOXML.W_NS, 'id') === String(commentId))!;
        const ids = paragraphIds(comment);
        const identity = commentId === 0 ? '20000001' : '20000011';
        expect(ids).toHaveLength(newCount);
        expect(ids.at(-1)).toBe(identity);
        expect(ids.filter((id) => id === identity)).toHaveLength(1);
        expect(comment.getAttributeNS(OOXML.W_NS, 'author')).toBe(`Author ${commentId}`);
        expect(comment.getAttributeNS(OOXML.W_NS, 'date')).toBe('2026-01-01T00:00:00Z');
        expect(comment.getElementsByTagNameNS(OOXML.W_NS, 'annotationRef')).toHaveLength(1);
        expect(await fixture.zip.readText('word/commentsExtended.xml')).toBe(extensionBefore);
        expect(await fixture.zip.readText('word/commentsIds.xml')).toBe(durableIdsBefore);
        expect(serializeXml(fixture.doc)).toBe(documentBefore);
        expect(edges(await getComments(fixture.zip, fixture.doc)))
          .toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
      });
    });
  }

  test('retains legacy first-only paragraph identities and preserves their relationships during body updates', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    await given('older SafeDocX multi-paragraph output with IDs only on first paragraphs', async () => {
      fixture = await loadFixture(nestedThread.map((comment) => ({ ...comment, legacyFirstParaId: true })));
      expect(edges(await getComments(fixture.zip, fixture.doc)))
        .toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
    });
    await when('the legacy root is expanded to three paragraphs', async () => {
      await updateCommentBody(fixture.zip, { commentId: 0, text: '',
        body: ['One.', 'Two.', 'Three.'].map((text) => ({ runs: [{ text }] })),
      });
    });
    await then('the existing identity moves to the final paragraph and all replies remain attached', async () => {
      const ids = paragraphIds((await definitions(fixture.zip))[0]!);
      expect(ids.at(-1)).toBe('10000000');
      expect(ids.filter((id) => id === '10000000')).toHaveLength(1);
      expect(edges(await getComments(fixture.zip, fixture.doc)))
        .toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
    });
  });

  test('resolves final paragraph IDs with alternate Word and extension namespace prefixes', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('multi-paragraph comments whose namespace prefixes differ from Word defaults', async () => {
      fixture = await loadFixture(nestedThread);
      for (const part of ['word/comments.xml', 'word/commentsExtended.xml']) {
        fixture.zip.writeText(part, (await fixture.zip.readText(part))
          .replaceAll('xmlns:w=', 'xmlns:x=').replaceAll('w:', 'x:')
          .replaceAll('xmlns:w14=', 'xmlns:y=').replaceAll('w14:', 'y:')
          .replaceAll('xmlns:w15=', 'xmlns:z=').replaceAll('w15:', 'z:'));
      }
    });
    await when('the comment tree is read', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('namespace-aware final paragraph lookup retains every relationship', async () => {
      expect(edges(comments)).toEqual(['0->root', '1->0', '3->1', '2->0', '4->root', '5->4']);
    });
  });
});

function unresolvedParents(comments: Comment[]): Array<[number, Comment['unresolvedThreadParent']]> {
  return comments.flatMap((comment) => [
    ...(comment.unresolvedThreadParent ? [[comment.id, comment.unresolvedThreadParent] as [number, Comment['unresolvedThreadParent']]] : []),
    ...unresolvedParents(comment.replies),
  ]);
}

describe('comment threading keeps replies whose parent link cannot be followed (#1353)', () => {
  test('lists a reply with a dangling parent link as a root', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('a two-paragraph root and a reply whose w15:paraIdParent names no comment', async () => {
      fixture = await loadFixture([
        { id: 0, paragraphs: ['Root first.', 'Root last.'] },
        { id: 1, paragraphs: ['Reply.'], rawParentParaId: 'DEADBEEF' },
      ]);
    });
    await when('comments are loaded', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('both comments are returned and the reply carries a missing-parent diagnostic', async () => {
      expect(edges(comments)).toEqual(['0->root', '1->root']);
      expect(comments[1]!.text).toBe('Reply.');
      expect(unresolvedParents(comments)).toEqual([[1, { paraIdParent: 'DEADBEEF', reason: 'missing-parent' }]]);
      expect(comments[0]).not.toHaveProperty('unresolvedThreadParent');
    });
  });

  test('keeps an orphaned reply\'s own descendants nested beneath it', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('an intact thread plus an orphan with a two-level descendant chain', async () => {
      fixture = await loadFixture([
        { id: 0, paragraphs: ['Root.'] },
        { id: 1, paragraphs: ['Reply to root.'], parentId: 0 },
        { id: 2, paragraphs: ['Orphan first.', 'Orphan last.'], rawParentParaId: 'DEADBEEF' },
        { id: 3, paragraphs: ['Reply to orphan.'], parentId: 2 },
        { id: 4, paragraphs: ['Nested under orphan.'], parentId: 3 },
      ]);
    });
    await when('comments are loaded', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('every comment appears exactly once and only the orphan is flagged', async () => {
      expect(edges(comments)).toEqual(['0->root', '1->0', '2->root', '3->2', '4->3']);
      expect(unresolvedParents(comments)).toEqual([[2, { paraIdParent: 'DEADBEEF', reason: 'missing-parent' }]]);
      expect(await getComment(fixture.zip, fixture.doc, 4)).toMatchObject({ text: 'Nested under orphan.' });
    });
  });

  test('lists a self-parented comment as a root and keeps its replies', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('a comment whose w15:paraIdParent is its own paragraph ID, with a reply', async () => {
      fixture = await loadFixture([
        { id: 0, paragraphs: ['Independent root.'] },
        { id: 1, paragraphs: ['Self-parented.'], parentId: 1 },
        { id: 2, paragraphs: ['Reply.'], parentId: 1 },
      ]);
    });
    await when('comments are loaded', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('the self link is not followed and the reply stays nested', async () => {
      expect(edges(comments)).toEqual(['0->root', '1->root', '2->1']);
      expect(unresolvedParents(comments)).toEqual([[1, { paraIdParent: '10000001', reason: 'self-parent' }]]);
    });
  });

  for (const [name, fixtureComments, expectedEdges, expectedUnresolved] of [
    ['two-comment cycle', [
      { id: 0, paragraphs: ['A.'], parentId: 1 },
      { id: 1, paragraphs: ['B.'], parentId: 0 },
      { id: 2, paragraphs: ['Reply to B.'], parentId: 1 },
    ], ['0->root', '1->0', '2->1'], [[0, { paraIdParent: '10000001', reason: 'cycle' }]]],
    ['three-comment cycle entered from a tail', [
      { id: 0, paragraphs: ['Independent root.'] },
      { id: 1, paragraphs: ['A.'], parentId: 3 },
      { id: 2, paragraphs: ['B.'], parentId: 1 },
      { id: 3, paragraphs: ['C.'], parentId: 2 },
      { id: 4, paragraphs: ['Tail into C.'], parentId: 3 },
    ], ['0->root', '1->root', '2->1', '3->2', '4->3'], [[1, { paraIdParent: '10000003', reason: 'cycle' }]]],
  ] as Array<[string, ThreadedCommentFixture[], string[], Array<[number, Comment['unresolvedThreadParent']]>]>) {
    test(`breaks a ${name} at its first comment without dropping or repeating any`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      let comments!: Comment[];
      await given(`commentsExtended.xml rows forming a ${name}`, async () => {
        fixture = await loadFixture(fixtureComments);
      });
      await when('comments are loaded', async () => {
        comments = await getComments(fixture.zip, fixture.doc);
      });
      await then('the tree is finite, lists each comment once, and flags the broken link', async () => {
        expect(edges(comments)).toEqual(expectedEdges);
        expect(unresolvedParents(comments)).toEqual(expectedUnresolved);
      });
    });
  }

  test('follows only the first commentEx row when a comment names two parents', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    let comments!: Comment[];
    await given('a reply with a second commentEx row naming a different parent', async () => {
      fixture = await loadFixture([
        { id: 0, paragraphs: ['Root A.'] },
        { id: 1, paragraphs: ['Root B.'] },
        { id: 2, paragraphs: ['Reply.'], parentId: 0 },
      ]);
      const part = 'word/commentsExtended.xml';
      fixture.zip.writeText(part, (await fixture.zip.readText(part)).replace('</w15:commentsEx>',
        '<w15:commentEx w15:paraId="10000002" w15:paraIdParent="10000001" w15:done="0"/></w15:commentsEx>'));
    });
    await when('comments are loaded', async () => {
      comments = await getComments(fixture.zip, fixture.doc);
    });
    await then('the reply appears once, under the parent its first row names', async () => {
      expect(edges(comments)).toEqual(['0->root', '2->0', '1->root']);
    });
  });

  for (const [scenario, fixtureComments, commentId, expectedIds, expectedEdges] of [
    ['an orphan', [
      { id: 0, paragraphs: ['Root.'] },
      { id: 1, paragraphs: ['Orphan.'], rawParentParaId: 'DEADBEEF' },
      { id: 2, paragraphs: ['Reply to orphan.'], parentId: 1 },
    ], 1, [0], ['0->root']],
    ['the reply side of a broken cycle', [
      { id: 0, paragraphs: ['A.'], parentId: 1 },
      { id: 1, paragraphs: ['B.'], parentId: 0 },
      { id: 2, paragraphs: ['Reply to B.'], parentId: 1 },
    ], 1, [0], ['0->root']],
  ] as Array<[string, ThreadedCommentFixture[], number, number[], string[]]>) {
    test(`deleting ${scenario} cascades only through the subtree get_comments shows`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      await given(`a document containing ${scenario}`, async () => {
        fixture = await loadFixture(fixtureComments);
      });
      await when(`comment ${commentId} is deleted`, async () => {
        await deleteComment(fixture.doc, fixture.zip, { commentId });
      });
      await then('its listed descendants are removed and every comment outside that subtree survives', async () => {
        const remaining = await definitions(fixture.zip);
        expect(remaining.map((comment) => Number(comment.getAttributeNS(OOXML.W_NS, 'id')))).toEqual(expectedIds);
        expect((await extensionRows(fixture.zip)).map((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId')))
          .toEqual(remaining.map((comment) => paragraphIds(comment).at(-1)));
        expect(edges(await getComments(fixture.zip, fixture.doc))).toEqual(expectedEdges);
      });
    });
  }

  test('deleting a comment also drops commentEx rows that describe no comment but hang off it', async ({ given, when, then }: AllureBddContext) => {
    let fixture!: Awaited<ReturnType<typeof loadFixture>>;
    await given('a root whose commentEx subtree includes two rows with no comment definition', async () => {
      fixture = await loadFixture([
        { id: 0, paragraphs: ['Root.'] },
        { id: 1, paragraphs: ['Other root.'] },
      ]);
      const part = 'word/commentsExtended.xml';
      fixture.zip.writeText(part, (await fixture.zip.readText(part)).replace('</w15:commentsEx>',
        '<w15:commentEx w15:paraId="0BADF00D" w15:paraIdParent="0DEADC0D" w15:done="0"/>'
        + '<w15:commentEx w15:paraId="0DEADC0D" w15:paraIdParent="10000000" w15:done="0"/></w15:commentsEx>'));
    });
    await when('the root is deleted', async () => {
      await deleteComment(fixture.doc, fixture.zip, { commentId: 0 });
    });
    await then('only the surviving comment keeps a commentEx row', async () => {
      expect((await extensionRows(fixture.zip)).map((row) => row.getAttributeNS(OOXML.W15_NS, 'paraId'))).toEqual(['10000001']);
    });
  });
  for (const [scenario, rewrite, commentId, expectedBefore, expectedAfter] of [
    ['two comments share a paragraph ID', (xml: string) => xml.replace('w14:paraId="10000000"', 'w14:paraId="10000001"'),
      0, ['0->root', '1->root', '2->1'], ['1->root', '2->1']],
    ['two definitions share a w:id', (xml: string) => xml.replace('w:id="2"', 'w:id="0"'),
      1, ['0->root', '1->0'], ['0->root']],
  ] as Array<[string, (xml: string) => string, number, string[], string[]]>) {
    test(`deleting a comment when ${scenario} follows the tree getComments shows`, async ({ given, when, then }: AllureBddContext) => {
      let fixture!: Awaited<ReturnType<typeof loadFixture>>;
      await given(`a cyclic thread in which ${scenario}`, async () => {
        fixture = await loadFixture([
          { id: 0, paragraphs: ['A'], parentId: 1 },
          { id: 1, paragraphs: ['B'], parentId: 2 },
          { id: 2, paragraphs: ['C'], parentId: 1 },
        ]);
        fixture.zip.writeText('word/comments.xml', rewrite(await fixture.zip.readText('word/comments.xml')));
        expect(edges(await getComments(fixture.zip, fixture.doc))).toEqual(expectedBefore);
      });
      await when(`comment ${commentId} is deleted`, async () => {
        await deleteComment(fixture.doc, fixture.zip, { commentId });
      });
      await then('only that comment and the replies listed beneath it are removed', async () => {
        expect(edges(await getComments(fixture.zip, fixture.doc))).toEqual(expectedAfter);
      });
    });
  }
});
