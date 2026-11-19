import { afterEach, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdfArchive } from '@usejunior/odf-core';
import { testAllure } from '../../testing/allure-test.js';
import { SessionManager, isOdfSession } from '../../session/manager.js';
import { dispatchToolCall } from '../../server.js';

const TEST_FEATURE = 'preserve-odf-session-paragraph-ids';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const managers: SessionManager[] = [];
const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(managers.splice(0).map(m => m.clearAllSessions()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const manager = new SessionManager();
  managers.push(manager);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odf-session-ids-'));
  dirs.push(dir);
  const file = path.join(dir, 'synthetic.odt');
  const xml = '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>First</text:p><text:p>Second</text:p></office:text></office:body></office:document-content>';
  await fs.writeFile(file, await OdfArchive.create({ contentXml: xml }).save());
  const call = async (tool: string, args: Record<string, unknown> = {}) =>
    dispatchToolCall(manager, tool, { file_path: file, ...args });
  const read = await call('read_file', { format: 'json', limit: 500 });
  expect(read.success).toBe(true);
  const session = await manager.getSessionByFilePath(file);
  if (!session || !isOdfSession(session)) throw new Error('Expected ODF session');
  return { manager, session, dir, file, call };
}

test.openspec('[OSID-01] Retained anchors survive transactional insertions')(
  'MCP reads, grep, comments and later edits share stable IDs through before/after insertions', async () => {
    const { session, call } = await setup();
    expect(await call('add_comment', { target_paragraph_id: 'p1', author: 'Jane Doe', text: 'Original second' })).toMatchObject({ success: true });
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p0', position: 'BEFORE', new_string: 'New first', instruction: 'insert before' })).toMatchObject({
      success: true, new_paragraph_id: 'p2', new_paragraph_ids: ['p2'], anchor_paragraph_id: 'p0',
      invalidates_paragraph_ids_after: null, requires_reread_before_next_edit: false,
    });
    expect(await call('replace_text', { target_paragraph_id: 'p1', old_string: 'Second', new_string: 'Changed second', instruction: 'edit retained ID' })).toMatchObject({ success: true });
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p1', position: 'AFTER', new_string: 'New last\n\nLast again', instruction: 'insert after retained ID' })).toMatchObject({ success: true, new_paragraph_ids: ['p3', 'p4'] });
    expect(await call('replace_text', { target_paragraph_id: 'p2', old_string: 'New first', new_string: 'Changed first', instruction: 'edit inserted ID' })).toMatchObject({ success: true });
    expect(await call('add_comment', { target_paragraph_id: 'p2', author: 'Jane Doe', text: 'Inserted first' })).toMatchObject({ success: true });
    const expected = [
      { id: 'p2', text: 'Changed first' }, { id: 'p0', text: 'First' }, { id: 'p1', text: 'Changed second' },
      { id: 'p3', text: 'New last' }, { id: 'p4', text: 'Last again' },
    ];
    expect(session.doc.getParagraphs()).toEqual(expected);
    const read = await call('read_file', { format: 'json', limit: 500 });
    expect(read.success).toBe(true);
    expect(JSON.parse(String(read.content)).map(({ id, text }: { id: string; text: string }) => ({ id, text }))).toEqual(expected);
    expect(await call('grep', { pattern: 'Changed second' })).toMatchObject({ success: true, matches: [expect.objectContaining({ para_id: 'p1' })] });
    expect(await call('get_comments')).toMatchObject({ success: true, comments: [
      expect.objectContaining({ text: 'Inserted first', anchored_paragraph_id: 'p2' }),
      expect.objectContaining({ text: 'Original second', anchored_paragraph_id: 'p1' }),
    ] });
  },
);

test.openspec('[OSID-02] Failed insertion leaves active identities intact')(
  'failure after candidate allocation preserves the active document, counter and next ID', async () => {
    const { manager, session, call } = await setup();
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p0', position: 'BEFORE', new_string: 'Inserted', instruction: 'insert' })).toMatchObject({ success: true, new_paragraph_ids: ['p2'] });
    const original = session.doc;
    const paragraphs = original.getParagraphs();
    const xml = original.toXml();
    const archive = session.archive;
    const revision = session.editRevision;
    const count = session.editCount;
    const failure = vi.spyOn(manager, 'markEdited').mockImplementationOnce(() => { throw new Error('injected after allocation'); });
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p1', new_string: 'Discarded', instruction: 'injected failure' })).toMatchObject({ success: false, error: { code: 'INSERT_ERROR' } });
    failure.mockRestore();
    expect(session.doc).toBe(original);
    expect(session.doc.getParagraphs()).toEqual(paragraphs);
    expect(session.doc.toXml()).toBe(xml);
    expect(session.archive).toBe(archive);
    expect(session.editRevision).toBe(revision);
    expect(session.editCount).toBe(count);
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p1', new_string: 'Committed', instruction: 'retry' })).toMatchObject({ success: true, new_paragraph_ids: ['p3'] });
    expect(session.doc.getParagraphTextById('p3')).toBe('Committed');
    expect(session.doc.getParagraphTextById('p1')).toBe('Second');
  },
);

test.openspec('[OSID-03] Reopen renumbers only stored order')(
  'save preserves active identities while actual close/reopen renumbers paragraphs and comment anchors', async () => {
    const { dir, file, call } = await setup();
    expect(await call('add_comment', { target_paragraph_id: 'p1', author: 'Jane Doe', text: 'Original second' })).toMatchObject({ success: true });
    expect(await call('insert_paragraph', { positional_anchor_node_id: 'p0', position: 'BEFORE', new_string: 'New first', instruction: 'insert' })).toMatchObject({ success: true, new_paragraph_ids: ['p2'] });
    const output = path.join(dir, 'saved.odt');
    expect(await call('save', { save_to_local_path: output })).toMatchObject({ success: true });
    const active = await call('read_file', { format: 'json', node_ids: ['p1'] });
    expect(JSON.parse(String(active.content))).toEqual([expect.objectContaining({ id: 'p1', text: 'Second' })]);
    const content = await (await OdfArchive.load(await fs.readFile(output))).getContentXml();
    expect(content).not.toMatch(/xml:id|text:id|bookmark/);
    expect(await call('close_file')).toMatchObject({ success: true });
    // Load the saved bytes at the original path after retiring the original session.
    await fs.copyFile(output, file);
    const reopened = await call('read_file', { format: 'json', limit: 500 });
    expect(reopened.success).toBe(true);
    expect(JSON.parse(String(reopened.content)).map(({ id, text }: { id: string; text: string }) => ({ id, text }))).toEqual([
      { id: 'p0', text: 'New first' }, { id: 'p1', text: 'First' }, { id: 'p2', text: 'Second' },
    ]);
    expect(await call('get_comments')).toMatchObject({ success: true, comments: [expect.objectContaining({ anchored_paragraph_id: 'p2', text: 'Original second' })] });
  },
);
