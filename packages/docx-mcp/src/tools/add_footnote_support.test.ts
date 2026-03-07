import { describe, expect } from 'vitest';
import { testAllure, allureJsonAttachment, allureStep } from '../testing/allure-test.js';
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
    const { opened, listed } = await allureStep('Given a document with two footnotes added to two paragraphs', async () => {
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

      return { opened, listed };
    });

    await allureStep('Then both footnotes are returned with correct metadata', () => {
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
  });

  humanReadableTest.openspec('empty document returns empty array')(
    'Scenario: empty document returns empty array',
    async () => {
      const listed = await allureStep('Given a document with no footnotes', async () => {
        const opened = await openSession(['No footnotes in this paragraph.']);
        const listed = await getFootnotes(opened.mgr, { session_id: opened.sessionId });
        assertSuccess(listed, 'get_footnotes');
        return listed;
      });

      await allureStep('Then get_footnotes returns an empty array', () => {
        expect(listed.footnotes).toEqual([]);
      });
    },
  );

  humanReadableTest.openspec('add footnote successfully')('Scenario: add footnote successfully', async () => {
    const { opened, result } = await allureStep('Given a session with a footnote added to a paragraph', async () => {
      const opened = await openSession(['Contract text paragraph.']);
      const result = await addFootnote(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: opened.firstParaId,
        text: 'Tool-level note',
      });
      return { opened, result };
    });

    await allureStep('Then add_footnote succeeds and returns a numeric note_id', () => {
      assertSuccess(result, 'add_footnote');
      expect(result.note_id).toBeTypeOf('number');
      expect(result.session_id).toBe(opened.sessionId);
    });
  });

  humanReadableTest.openspec('error when anchor paragraph not found')(
    'Scenario: error when anchor paragraph not found',
    async () => {
      const result = await allureStep('Given an add_footnote call targeting a non-existent paragraph', async () => {
        const opened = await openSession(['Anchor validation.']);
        return addFootnote(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: '_bk_missing',
          text: 'Should fail',
        });
      });

      await allureStep('Then the result is an ANCHOR_NOT_FOUND error', () => {
        assertFailure(result, 'ANCHOR_NOT_FOUND', 'add_footnote');
      });
    },
  );

  humanReadableTest.openspec('error when after_text not found')(
    'Scenario: error when after_text not found',
    async () => {
      const result = await allureStep('Given an add_footnote call with after_text that does not exist in the paragraph', async () => {
        const opened = await openSession(['Anchor text present here.']);
        return addFootnote(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: opened.firstParaId,
          after_text: 'Not in paragraph',
          text: 'Should fail',
        });
      });

      await allureStep('Then the result is a TEXT_NOT_FOUND error', () => {
        assertFailure(result, 'TEXT_NOT_FOUND', 'add_footnote');
      });
    },
  );

  humanReadableTest.openspec('update footnote successfully')(
    'Scenario: update footnote successfully',
    async () => {
      const listed = await allureStep('Given a footnote is created and then updated with new text', async () => {
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
        return listed;
      });

      await allureStep('Then the footnote text reflects the update', () => {
        const first = (listed.footnotes as Array<Record<string, unknown>>)[0]!;
        expect(String(first.text)).toContain('Updated note body');
      });
    },
  );

  humanReadableTest.openspec('error when note not found')('Scenario: error when note not found', async () => {
    const result = await allureStep('Given an update_footnote call with a non-existent note_id', async () => {
      const opened = await openSession(['Missing-note validation paragraph.']);
      return updateFootnote(opened.mgr, {
        session_id: opened.sessionId,
        note_id: 999999,
        new_text: 'No-op',
      });
    });

    await allureStep('Then the result is a NOTE_NOT_FOUND error', () => {
      assertFailure(result, 'NOTE_NOT_FOUND', 'update_footnote');
    });
  });

  humanReadableTest.openspec('delete footnote successfully')(
    'Scenario: delete footnote successfully',
    async () => {
      const listed = await allureStep('Given a footnote is created and then deleted', async () => {
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
        return listed;
      });

      await allureStep('Then get_footnotes returns an empty array', () => {
        expect(listed.footnotes).toEqual([]);
      });
    },
  );

  humanReadableTest.openspec('error when note not found')(
    'Scenario: error when note not found',
    async () => {
      const result = await allureStep('Given a delete_footnote call with a non-existent note_id', async () => {
        const opened = await openSession(['Delete-missing validation paragraph.']);
        return deleteFootnote(opened.mgr, {
          session_id: opened.sessionId,
          note_id: 123456,
        });
      });

      await allureStep('Then the result is a NOTE_NOT_FOUND error', () => {
        assertFailure(result, 'NOTE_NOT_FOUND', 'delete_footnote');
      });
    },
  );

  humanReadableTest.openspec('error when deleting reserved type')(
    'Scenario: error when deleting reserved type',
    async () => {
      const result = await allureStep('Given a delete_footnote call targeting a reserved note_id (-1)', async () => {
        const opened = await openSession(['Reserved delete validation paragraph.']);
        const seeded = await addFootnote(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: opened.firstParaId,
          text: 'Seed real note to bootstrap footnotes.xml',
        });
        assertSuccess(seeded, 'add_footnote');

        return deleteFootnote(opened.mgr, {
          session_id: opened.sessionId,
          note_id: -1,
        });
      });

      await allureStep('Then the result is a RESERVED_TYPE error', () => {
        assertFailure(result, 'RESERVED_TYPE', 'delete_footnote');
      });
    },
  );

  humanReadableTest.openspec('markers present in document view')(
    'Scenario: markers present in document view',
    async () => {
      const content = await allureStep('Given a document with a footnote and its simple-format read output', async () => {
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
        return String(read.content);
      });

      await allureStep('Then the document view contains the footnote marker [^1]', () => {
        expect(content).toContain('[^1]');
      });
    },
  );

  humanReadableTest.openspec('markers absent from edit matching')(
    'Scenario: markers absent from edit matching',
    async () => {
      const opened = await allureStep('Given a document with a footnote attached to a paragraph', async () => {
        const opened = await openSession(['Replace target sentence.']);
        const created = await addFootnote(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: opened.firstParaId,
          text: 'Matching note',
        });
        assertSuccess(created, 'add_footnote');
        return opened;
      });

      await allureStep('Then replace_text using a marker token in old_string fails with TEXT_NOT_FOUND', async () => {
        const withMarker = await replaceText(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: opened.firstParaId,
          old_string: 'Replace target sentence.[^1]',
          new_string: 'Should not apply',
          instruction: 'Attempt replace using marker token',
        });
        assertFailure(withMarker, 'TEXT_NOT_FOUND', 'replace_text(marker token)');
      });

      await allureStep('Then replace_text using raw paragraph text succeeds', async () => {
        const withoutMarker = await replaceText(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: opened.firstParaId,
          old_string: 'Replace target sentence.',
          new_string: 'Replaced sentence.',
          instruction: 'Replace using raw paragraph text',
        });
        assertSuccess(withoutMarker, 'replace_text(raw text)');
      });
    },
  );
});
