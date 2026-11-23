/**
 * A comment anchored inside a body text box lives in two places: its range
 * (`w:commentRangeStart`/`w:commentRangeEnd`) and reference mark
 * (`w:commentReference`) sit in the text-box story, and its content sits in
 * the comments part. A text box whose text changed is compared as a story of
 * its own; the comparison keeps the comment's anchor in that story and its
 * definition in the merged comments part, so every reference resolves to one
 * comment and Accept All / Reject All reproduce each side.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @see https://github.com/UseJunior/safe-docx/issues/1385
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { DocxArchive, DocxDocument, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Text-Box Comment Anchors',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.2' },
    { spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' },
  );

const W_NS = OOXML.W_NS;
const VML_NS = 'urn:schemas-microsoft-com:vml';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const COMMENTS_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-23T00:00:00.000Z') };
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const commented = (id: number, text: string): string =>
  `<w:commentRangeStart w:id="${id}"/>${run(text)}<w:commentRangeEnd w:id="${id}"/>` +
  `<w:r><w:commentReference w:id="${id}"/></w:r>`;

const textBoxParagraph = (lead: string, storyXml: string): string =>
  `<w:p>${run(lead)}<w:r><w:pict>` +
  `<v:shape id="box1" o:spid="_x0000_s1026" style="width:200pt;height:80pt">` +
  `<v:textbox><w:txbxContent><w:p>${storyXml}</w:p></w:txbxContent></v:textbox>` +
  `</v:shape></w:pict></w:r></w:p>`;

const commentsXml = (comments: Array<[id: number, text: string]>): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:comments xmlns:w="${W_NS}">` +
  comments.map(([id, text]) =>
    `<w:comment w:id="${id}" w:author="Reviewer" w:date="2026-11-01T00:00:00Z" w:initials="R">` +
    `<w:p>${run(text)}</w:p></w:comment>`).join('') +
  `</w:comments>`;

async function buildPackage(bodyXml: string, comments: Array<[number, string]>): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(bodyXml, [], {
    namespaces: { v: VML_NS, o: OFFICE_NS },
  }));
  archive.setFile('word/comments.xml', commentsXml(comments));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdComments" Type="${COMMENTS_TYPE}" Target="comments.xml"/></Relationships>`,
  );
  archive.setFile('[Content_Types].xml', (await archive.getFile('[Content_Types].xml'))!.replace(
    '</Types>',
    `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/></Types>`,
  ));
  return archive.save();
}

/** Paragraph texts of the body and its text boxes, with comment marks shown. */
async function view(buffer: Buffer, project: (xml: string) => string = (xml) => xml): Promise<string[]> {
  const archive = await DocxArchive.load(buffer);
  const document = parseXml(project(await archive.getDocumentXml()));
  const paragraphText = (paragraph: Element): string => {
    let text = '';
    const visit = (node: Node): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (element.namespaceURI !== W_NS) { visit(element); continue; }
        if (element.localName === 'p' || element.localName === 'txbxContent') continue;
        if (element.localName === 't') text += element.textContent ?? '';
        else if (element.localName === 'commentRangeStart') text += '[';
        else if (element.localName === 'commentRangeEnd') text += ']';
        else if (element.localName === 'commentReference') text += '*';
        else visit(element);
      }
    };
    visit(paragraph);
    return text;
  };
  return Array.from(document.getElementsByTagNameNS(W_NS, 'p'))
    .map((paragraph) => paragraphText(paragraph));
}

async function docxCoreProjection(buffer: Buffer, mode: 'accept' | 'reject'): Promise<Buffer> {
  const document = await DocxDocument.load(buffer);
  if (mode === 'accept') await document.acceptChanges();
  else await document.rejectChanges();
  return (await document.toBuffer()).buffer;
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1385-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Comment ids defined in the comments part, and those the document references. */
async function commentBindings(buffer: Buffer): Promise<{ defined: string[]; texts: Map<string, string>; referenced: string[]; ranged: string[] }> {
  const archive = await DocxArchive.load(buffer);
  const comments = await archive.getFile('word/comments.xml');
  const definitions = comments
    ? Array.from(parseXml(comments).getElementsByTagNameNS(W_NS, 'comment'))
    : [];
  const document = parseXml(await archive.getDocumentXml());
  const ids = (localName: string): string[] =>
    Array.from(document.getElementsByTagNameNS(W_NS, localName))
      .map((element) => element.getAttributeNS(W_NS, 'id') ?? '');
  return {
    defined: definitions.map((comment) => comment.getAttributeNS(W_NS, 'id') ?? ''),
    texts: new Map(definitions.map((comment) => [
      comment.getAttributeNS(W_NS, 'id') ?? '',
      comment.textContent ?? '',
    ])),
    referenced: ids('commentReference'),
    ranged: ids('commentRangeStart'),
  };
}

async function assertFaithfulRedline(original: Buffer, revised: Buffer, compared: Buffer): Promise<void> {
  const originalView = await view(original);
  const revisedView = await view(revised);
  expect(await view(compared, acceptAllChanges)).toEqual(revisedView);
  expect(await view(compared, rejectAllChanges)).toEqual(originalView);
  expect(await view(await docxCoreProjection(compared, 'accept'))).toEqual(revisedView);
  expect(await view(await docxCoreProjection(compared, 'reject'))).toEqual(originalView);
  await assertSchema(compared);
}

async function assertCommentsResolve(compared: Buffer, expected: Record<string, string>): Promise<void> {
  const bindings = await commentBindings(compared);
  // Every comment id is defined once, and every anchor resolves to one.
  expect(new Set(bindings.defined).size).toBe(bindings.defined.length);
  for (const id of [...bindings.referenced, ...bindings.ranged]) {
    expect(bindings.defined).toContain(id);
  }
  for (const [id, text] of Object.entries(expected)) {
    expect(bindings.referenced).toContain(id);
    expect(bindings.texts.get(id)).toBe(text);
  }
}

/** The tracked revisions inside the first body text box. */
async function textBoxRevisions(buffer: Buffer): Promise<{ ins: string; del: string }> {
  const document = parseXml(await (await DocxArchive.load(buffer)).getDocumentXml());
  const box = document.getElementsByTagNameNS(W_NS, 'txbxContent').item(0)!;
  const text = (localName: string, textName: string): string =>
    Array.from(box.getElementsByTagNameNS(W_NS, localName))
      .map((wrapper) => Array.from(wrapper.getElementsByTagNameNS(W_NS, textName))
        .map((node) => node.textContent ?? '').join(''))
      .join('|');
  return { ins: text('ins', 't'), del: text('del', 'delText') };
}

test('tracks an edit inside a commented text-box range and keeps the comment', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a text box whose commented "30" becomes "45"', async () => ({
    original: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' days')}`),
      [[0, 'Check the term']],
    ),
    revised: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '45')}${run(' days')}`),
      [[0, 'Check the term']],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('the edit is tracked in the box and the comment still resolves', async () => {
    expect(await textBoxRevisions(compared)).toEqual({ ins: '45', del: '30' });
    await assertCommentsResolve(compared, { 0: 'Check the term' });
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('tracks an edit beside a comment anchored in a text box, with a body comment too', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a body comment and a text-box comment, with edits in both stories', async () => ({
    original: await buildPackage(
      `<w:p>${commented(1, 'The parties agree.')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' days')}`),
      [[0, 'Check the term'], [1, 'Body note']],
    ),
    revised: await buildPackage(
      `<w:p>${commented(1, 'The parties now agree.')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' business days')}`),
      [[0, 'Check the term'], [1, 'Body note']],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('both comments resolve and both edits are tracked', async () => {
    expect((await textBoxRevisions(compared)).ins).toContain('business');
    await assertCommentsResolve(compared, { 0: 'Check the term', 1: 'Body note' });
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('tracks a comment added inside a text box', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a text box that gains a comment on "30"', async () => ({
    original: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within 30 days')}`),
      [],
    ),
    revised: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '45')}${run(' days')}`),
      [[0, 'New term']],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('the new comment resolves in the merged comments part', async () => {
    await assertCommentsResolve(compared, { 0: 'New term' });
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('keeps the definition of a comment removed from a text box', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a commented text box whose comment and term are both dropped', async () => ({
    original: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' days')}`),
      [[0, 'Old term']],
    ),
    revised: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within 45 days')}`),
      [],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('the deleted anchor still resolves to its comment', async () => {
    await assertCommentsResolve(compared, { 0: 'Old term' });
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('gives distinct comments that share an id across the two sides distinct ids', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('id 0 names one comment in the original box and another in the revised box', async () => ({
    original: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' days')}`),
      [[0, 'Old term']],
    ),
    revised: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within 45 days, ')}${commented(0, 'net')}`),
      [[0, 'New term']],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('both comments survive under unique ids', async () => {
    const bindings = await commentBindings(compared);
    expect(new Set(bindings.defined).size).toBe(bindings.defined.length);
    expect([...bindings.texts.values()].sort()).toEqual(['New term', 'Old term']);
    for (const id of [...bindings.referenced, ...bindings.ranged]) expect(bindings.defined).toContain(id);
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('tracks an inserted text box that carries a comment', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a revised document that adds a commented text box', async () => ({
    original: await buildPackage(`<w:p>${run('Body')}</w:p>`, []),
    revised: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '45')}${run(' days')}`),
      [[0, 'New box']],
    ),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('the box is tracked as inserted and its comment resolves', async () => {
    await assertCommentsResolve(compared, { 0: 'New box' });
    await assertFaithfulRedline(original, revised, compared);
  });
});

test('tracks a deleted text box that carries a comment', async ({
  given,
  when,
  then,
}: AllureBddContext) => {
  const { original, revised } = await given('a revised document that drops a commented text box', async () => ({
    original: await buildPackage(
      `<w:p>${run('Body')}</w:p>` +
        textBoxParagraph('Lead', `${run('Pay within ')}${commented(0, '30')}${run(' days')}`),
      [[0, 'Old box']],
    ),
    revised: await buildPackage(`<w:p>${run('Body')}</w:p>`, []),
  }));

  const compared = await when('the documents are compared', async () =>
    (await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS)).document);

  await then('the box is tracked as deleted and its comment resolves', async () => {
    await assertCommentsResolve(compared, { 0: 'Old box' });
    await assertFaithfulRedline(original, revised, compared);
  });
});
