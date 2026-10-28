import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSyntheticDocx, DocxZip, escapeXmlAttr, OOXML } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { getComments } from './get_comments.js';
import { readFile } from './read_file.js';

const test = testAllure.epic('Document Reading').withLabels({ feature: 'Comment Threading' });

type Thread = { id: number; text: string; replies: Thread[] };
type ThreadedCommentFixture = { id: number; paragraphs: string[]; parentId?: number };

function threadContents(comments: Thread[]): Thread[] {
  return comments.map(({ id, text, replies }) => ({ id, text, replies: threadContents(replies) }));
}

async function writeFixture(comments: ThreadedCommentFixture[]) {
  const zip = await DocxZip.load(await buildSyntheticDocx({
    paragraphs: ['Discussion paragraph.'], commentOnParagraph: 0, commentAncillaryParts: true,
  }));
  // Independently author the issue #1224 shape, including anchors for replies.
  // MS-DOCX §2.5.3.1 identifies each comment and its parent by the last paragraph.
  const paragraphId = (id: number, index: number) =>
    (index === 0 ? 0x10000000 + id : 0x20000000 + id * 16 + index).toString(16).toUpperCase();
  const lastId = new Map(comments.map((comment) =>
    [comment.id, paragraphId(comment.id, comment.paragraphs.length - 1)]));
  const definitions = comments.map((comment) => `<w:comment w:id="${comment.id}" w:author="Author ${comment.id}">`
    + comment.paragraphs.map((text, index) => `<w:p w14:paraId="${paragraphId(comment.id, index)}">`
      + (index === 0 ? '<w:r><w:annotationRef/></w:r>' : '')
      + `<w:r><w:t>${escapeXmlAttr(text)}</w:t></w:r></w:p>`).join('')
    + '</w:comment>').join('');
  const extensions = comments.map((comment) => `<w15:commentEx w15:paraId="${lastId.get(comment.id)}"`
    + (comment.parentId === undefined ? '' : ` w15:paraIdParent="${lastId.get(comment.parentId)}"`)
    + ' w15:done="0"/>').join('');
  zip.writeText('word/comments.xml', `<w:comments xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}">${definitions}</w:comments>`);
  zip.writeText('word/commentsExtended.xml', `<w15:commentsEx xmlns:w15="${OOXML.W15_NS}">${extensions}</w15:commentsEx>`);
  const starts = comments.map(({ id }) => `<w:commentRangeStart w:id="${id}"/>`).join('');
  const ends = comments.map(({ id }) => `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`).join('');
  zip.writeText('word/document.xml', (await zip.readText('word/document.xml')).replace(
    /<w:p>.*?<\/w:p>/s, `<w:p>${starts}<w:r><w:t>Discussion paragraph.</w:t></w:r>${ends}</w:p>`,
  ));
  const dir = await createTrackedTempDir('safe-docx-comment-threading-');
  const filePath = path.join(dir, 'threaded-comments.docx');
  await fs.writeFile(filePath, await zip.toBuffer());
  return { mgr: createTestSessionManager(), filePath };
}

const scenarios: Array<{
  name: string;
  comments: ThreadedCommentFixture[];
  expected: Thread[];
  edges: Array<[number, number]>;
}> = [
  {
    name: 'single-paragraph parent with two replies',
    comments: [
      { id: 0, paragraphs: ['Parent comment.'] },
      { id: 1, paragraphs: ['Reply 1.'], parentId: 0 },
      { id: 2, paragraphs: ['Reply 2.'], parentId: 0 },
    ],
    expected: [{ id: 0, text: 'Parent comment.', replies: [
      { id: 1, text: 'Reply 1.', replies: [] },
      { id: 2, text: 'Reply 2.', replies: [] },
    ] }],
    edges: [[1, 0], [2, 0]],
  },
  {
    name: 'multi-paragraph parent with two replies',
    comments: [
      { id: 0, paragraphs: ['Parent paragraph 1.', 'Parent paragraph 2.'] },
      { id: 1, paragraphs: ['Reply 1.'], parentId: 0 },
      { id: 2, paragraphs: ['Reply 2.'], parentId: 0 },
    ],
    expected: [{ id: 0, text: 'Parent paragraph 1.\nParent paragraph 2.', replies: [
      { id: 1, text: 'Reply 1.', replies: [] },
      { id: 2, text: 'Reply 2.', replies: [] },
    ] }],
    edges: [[1, 0], [2, 0]],
  },
  {
    name: 'multi-paragraph reply with a nested reply and a sibling',
    comments: [
      { id: 0, paragraphs: ['Parent comment.'] },
      { id: 1, paragraphs: ['Reply paragraph 1.', 'Reply paragraph 2.'], parentId: 0 },
      { id: 2, paragraphs: ['Sibling reply.'], parentId: 0 },
      { id: 3, paragraphs: ['Nested reply.'], parentId: 1 },
    ],
    expected: [{ id: 0, text: 'Parent comment.', replies: [
      { id: 1, text: 'Reply paragraph 1.\nReply paragraph 2.', replies: [
        { id: 3, text: 'Nested reply.', replies: [] },
      ] },
      { id: 2, text: 'Sibling reply.', replies: [] },
    ] }],
    edges: [[1, 0], [3, 1], [2, 0]],
  },
];

describe('Word comment threading through MCP tools (#1224)', () => {
  registerCleanup();

  for (const scenario of scenarios) {
    test(`get_comments preserves a ${scenario.name}`, async ({ given, when, then }: AllureBddContext) => {
      const fixture = await given('a DOCX whose comment extensions identify the last paragraph', () => writeFixture(scenario.comments));
      const result = await when('get_comments reads the document', () => getComments(fixture.mgr, { file_path: fixture.filePath }));

      await then('all comments retain their text and original parent-child relationships', () => {
        assertSuccess(result, 'get_comments');
        expect(threadContents(result.comments as Thread[])).toEqual(scenario.expected);
      });
    });

    test(`read_file preserves a ${scenario.name} in TOON and JSON`, async ({ given, when, then }: AllureBddContext) => {
      const fixture = await given('a DOCX with independently authored comment parts', () => writeFixture(scenario.comments));
      const reads = await when('read_file renders TOON and JSON', async () => ({
        toon: await readFile(fixture.mgr, { file_path: fixture.filePath, format: 'toon' }),
        json: await readFile(fixture.mgr, { file_path: fixture.filePath, format: 'json' }),
      }));

      await then('each reply appears once under its immediate parent in both formats', () => {
        assertSuccess(reads.toon, 'read_file(toon)');
        assertSuccess(reads.json, 'read_file(json)');
        const lines = String(reads.toon.content).split('\n');
        expect(lines.filter((line) => line.startsWith('#COMMENT '))).toHaveLength(1);
        const replyEdges = lines.filter((line) => line.startsWith('#REPLY '))
          .map((line) => line.match(/^#REPLY c(\d+) -> c(\d+) /)?.slice(1).map(Number));
        expect(replyEdges).toEqual(scenario.edges);

        const nodes = JSON.parse(String(reads.json.content)) as Array<{ comments?: Thread[] }>;
        const comments = nodes.flatMap((node) => node.comments ?? []);
        expect(threadContents(comments)).toEqual(scenario.expected);
      });
    });
  }
});
