import { describe, expect } from 'vitest';
import { testAllure, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { addFootnote } from './add_footnote.js';
import { getFootnotes } from './get_footnotes.js';
import { updateFootnote } from './update_footnote.js';
import { deleteFootnote } from './delete_footnote.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';

const TEST_FEATURE = 'add-footnote-support';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('OpenSpec traceability: add-footnote-support', () => {
  registerCleanup();

  humanReadableTest.openspec('read all footnotes')('Scenario: read all footnotes', async () => {
    const opened = await openSession([
      'Alpha paragraph for note one.',
      'Beta paragraph for note two.',
    ]);

    const addOne = await addFootnote(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: opened.paraIds[0]!,
      text: 'First footnote',
    });
    assertSuccess(addOne, 'add_footnote #1');

    const addTwo = await addFootnote(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: opened.paraIds[1]!,
      text: 'Second footnote',
    });
    assertSuccess(addTwo, 'add_footnote #2');

    const listed = await getFootnotes(opened.mgr, { session_id: opened.sessionId });
    assertSuccess(listed, 'get_footnotes');
    await allureJsonAttachment('get_footnotes-response', listed);

    const notes = listed.footnotes as Array<Record<string, unknown>>;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      display_number: 1,
      text: expect.any(String),
      anchored_paragraph_id: opened.paraIds[0],
    }));
    expect(notes[1]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      display_number: 2,
      text: expect.any(String),
      anchored_paragraph_id: opened.paraIds[1],
    }));
  });

  humanReadableTest.openspec('empty document returns empty array')(
    'Scenario: empty document returns empty array',
    async () => {
      const opened = await openSession(['No footnotes in this paragraph.']);

      const listed = await getFootnotes(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(listed, 'get_footnotes');
      expect(listed.footnotes).toEqual([]);
    },
  );

  humanReadableTest.openspec('add footnote successfully')('Scenario: add footnote successfully', async () => {
    const opened = await openSession(['Contract text paragraph.']);

    const result = await addFootnote(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: opened.firstParaId,
      text: 'Tool-level note',
    });

    assertSuccess(result, 'add_footnote');
    expect(result.note_id).toBeTypeOf('number');
    expect(result.session_id).toBe(opened.sessionId);
  });

  humanReadableTest.openspec('error when anchor paragraph not found')(
    'Scenario: error when anchor paragraph not found',
    async () => {
      const opened = await openSession(['Anchor validation.']);

      const result = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: 'jr_para_missing',
        text: 'Should fail',
      });

      assertFailure(result, 'ANCHOR_NOT_FOUND', 'add_footnote');
    },
  );

  humanReadableTest.openspec('error when after_text not found')(
    'Scenario: error when after_text not found',
    async () => {
      const opened = await openSession(['Anchor text present here.']);

      const result = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        after_text: 'Not in paragraph',
        text: 'Should fail',
      });

      assertFailure(result, 'TEXT_NOT_FOUND', 'add_footnote');
    },
  );

  humanReadableTest.openspec('update footnote successfully')(
    'Scenario: update footnote successfully',
    async () => {
      const opened = await openSession(['Update flow paragraph.']);
      const created = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Old note body',
      });
      assertSuccess(created, 'add_footnote');

      const updated = await updateFootnote(opened.mgr, {
        session_id: opened.sessionId,
        note_id: created.note_id as number,
        new_text: 'Updated note body',
      });
      assertSuccess(updated, 'update_footnote');

      const listed = await getFootnotes(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(listed, 'get_footnotes');
      const first = (listed.footnotes as Array<Record<string, unknown>>)[0]!;
      expect(String(first.text)).toContain('Updated note body');
    },
  );

  humanReadableTest.openspec('error when note not found')('Scenario: error when note not found', async () => {
    const opened = await openSession(['Missing-note validation paragraph.']);

    const result = await updateFootnote(opened.mgr, {
      session_id: opened.sessionId,
      note_id: 999999,
      new_text: 'No-op',
    });

    assertFailure(result, 'NOTE_NOT_FOUND', 'update_footnote');
  });

  humanReadableTest.openspec('delete footnote successfully')(
    'Scenario: delete footnote successfully',
    async () => {
      const opened = await openSession(['Delete flow paragraph.']);
      const created = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Delete me',
      });
      assertSuccess(created, 'add_footnote');

      const deleted = await deleteFootnote(opened.mgr, {
        session_id: opened.sessionId,
        note_id: created.note_id as number,
      });
      assertSuccess(deleted, 'delete_footnote');

      const listed = await getFootnotes(opened.mgr, { session_id: opened.sessionId });
      assertSuccess(listed, 'get_footnotes');
      expect(listed.footnotes).toEqual([]);
    },
  );

  humanReadableTest.openspec('error when note not found')(
    'Scenario: error when note not found',
    async () => {
      const opened = await openSession(['Delete-missing validation paragraph.']);

      const result = await deleteFootnote(opened.mgr, {
        session_id: opened.sessionId,
        note_id: 123456,
      });

      assertFailure(result, 'NOTE_NOT_FOUND', 'delete_footnote');
    },
  );

  humanReadableTest.openspec('error when deleting reserved type')(
    'Scenario: error when deleting reserved type',
    async () => {
      const opened = await openSession(['Reserved delete validation paragraph.']);
      const seeded = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Seed real note to bootstrap footnotes.xml',
      });
      assertSuccess(seeded, 'add_footnote');

      const result = await deleteFootnote(opened.mgr, {
        session_id: opened.sessionId,
        note_id: -1,
      });

      assertFailure(result, 'RESERVED_TYPE', 'delete_footnote');
    },
  );

  humanReadableTest.openspec('markers present in document view')(
    'Scenario: markers present in document view',
    async () => {
      const opened = await openSession(['Marker display paragraph.']);
      const created = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Display marker note',
      });
      assertSuccess(created, 'add_footnote');

      const read = await readFile(opened.mgr, {
        session_id: opened.sessionId,
        format: 'simple',
        show_formatting: false,
      });
      assertSuccess(read, 'read_file');
      const content = String(read.content);
      expect(content).toContain('[^1]');
    },
  );

  humanReadableTest.openspec('markers absent from edit matching')(
    'Scenario: markers absent from edit matching',
    async () => {
      const opened = await openSession(['Replace target sentence.']);
      const created = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Matching note',
      });
      assertSuccess(created, 'add_footnote');

      const withMarker = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Replace target sentence.[^1]',
        new_string: 'Should not apply',
        instruction: 'Attempt replace using marker token',
      });
      assertFailure(withMarker, 'TEXT_NOT_FOUND', 'replace_text(marker token)');

      const withoutMarker = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Replace target sentence.',
        new_string: 'Replaced sentence.',
        instruction: 'Replace using raw paragraph text',
      });
      assertSuccess(withoutMarker, 'replace_text(raw text)');
    },
  );
});
