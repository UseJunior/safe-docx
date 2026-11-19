import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
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
      file_path: opened.inputPath,
      target_paragraph_id: opened.paraIds[0]!,
      text: 'First footnote',
    });
    assertSuccess(addOne, 'add_footnote #1');

    const addTwo = await addFootnote(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.paraIds[1]!,
      text: 'Second footnote',
    });
    assertSuccess(addTwo, 'add_footnote #2');

    const listed = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
    assertSuccess(listed, 'get_footnotes');

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

      const listed = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(listed, 'get_footnotes');
      expect(listed.footnotes).toEqual([]);
    },
  );

  humanReadableTest.openspec('add footnote successfully')('Scenario: add footnote successfully', async () => {
    const opened = await openSession(['Contract text paragraph.']);

    const result = await addFootnote(opened.mgr, {
      file_path: opened.inputPath,
      target_paragraph_id: opened.firstParaId,
      text: 'Tool-level note',
    });

    assertSuccess(result, 'add_footnote');
    expect(result.note_id).toBeTypeOf('number');
    expect(result.file_path).toBe(opened.filePath);
  });

  humanReadableTest.openspec('error when anchor paragraph not found')(
    'Scenario: error when anchor paragraph not found',
    async () => {
      const opened = await openSession(['Anchor validation.']);

      const result = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: '_bk_missing',
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
        file_path: opened.inputPath,
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
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Old note body',
      });
      assertSuccess(created, 'add_footnote');

      const updated = await updateFootnote(opened.mgr, {
        file_path: opened.inputPath,
        note_id: created.note_id as number,
        new_text: 'Updated note body',
      });
      assertSuccess(updated, 'update_footnote');

      const listed = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(listed, 'get_footnotes');
      const first = (listed.footnotes as Array<Record<string, unknown>>)[0]!;
      expect(String(first.text)).toContain('Updated note body');
    },
  );

  humanReadableTest.openspec('error when note not found')('Scenario: error when note not found', async () => {
    const opened = await openSession(['Missing-note validation paragraph.']);

    const result = await updateFootnote(opened.mgr, {
      file_path: opened.inputPath,
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
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Delete me',
      });
      assertSuccess(created, 'add_footnote');

      const deleted = await deleteFootnote(opened.mgr, {
        file_path: opened.inputPath,
        note_id: created.note_id as number,
      });
      assertSuccess(deleted, 'delete_footnote');

      const listed = await getFootnotes(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(listed, 'get_footnotes');
      expect(listed.footnotes).toEqual([]);
    },
  );

  humanReadableTest.openspec('error when note not found')(
    'Scenario: error when note not found',
    async () => {
      const opened = await openSession(['Delete-missing validation paragraph.']);

      const result = await deleteFootnote(opened.mgr, {
        file_path: opened.inputPath,
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
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Seed real note to bootstrap footnotes.xml',
      });
      assertSuccess(seeded, 'add_footnote');

      const result = await deleteFootnote(opened.mgr, {
        file_path: opened.inputPath,
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
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Display marker note',
      });
      assertSuccess(created, 'add_footnote');

      const read = await readFile(opened.mgr, {
        file_path: opened.inputPath,
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
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        text: 'Matching note',
      });
      assertSuccess(created, 'add_footnote');

      const withMarker = await replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Replace target sentence.[^1]',
        new_string: 'Should not apply',
        instruction: 'Attempt replace using marker token',
      });
      assertFailure(withMarker, 'TEXT_NOT_FOUND', 'replace_text(marker token)');

      const withoutMarker = await replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Replace target sentence.',
        new_string: 'Replaced sentence.',
        instruction: 'Replace using raw paragraph text',
      });
      assertSuccess(withoutMarker, 'replace_text(raw text)');
    },
  );
});

/**
 * A `w:sym` glyph is one character of the paragraph text since issue #1046.
 * Footnote insertion resolves `after_text` in that text and splits the run
 * with the shared splitter, and the document view places the `[^N]` marker
 * with the same per-element lengths, so a reference anchored after a symbol
 * that sits mid-run lands right after the glyph.
 */
describe('add_footnote — symbol characters in the anchor text (#1046)', () => {
  registerCleanup();

  const DOCUMENT_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t><w:sym w:font="Wingdings" w:char="F0A8"/>' +
    '<w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>' +
    '</w:body></w:document>';

  test('a footnote anchored after a mid-run symbol lands right after the glyph', async ({ given, when, then }: AllureBddContext) => {
    const opened = await given('one run "Alpha <checkbox> Bravo" with the checkbox mid-run', () =>
      openSession([], { xml: DOCUMENT_XML }),
    );
    expect(opened.content).toContain('Alpha \uF0A8 Bravo');

    await when('add_footnote anchors a note after "Alpha <checkbox>"', async () => {
      const added = await addFootnote(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0]!,
        after_text: 'Alpha \uF0A8',
        text: 'About the checkbox',
      });
      assertSuccess(added, 'add_footnote');
    });

    await then('read_file shows the marker between the glyph and " Bravo", and the raw paragraph text is unchanged', async () => {
      const read = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
      assertSuccess(read, 'read_file');
      const [node] = JSON.parse(String(read.content)) as Array<{ raw_text: string; text: string; tagged_text: string }>;
      expect(node!.raw_text).toBe('Alpha \uF0A8 Bravo');
      expect(node!.text).toBe('Alpha \uF0A8[^1] Bravo');
      expect(node!.tagged_text).toBe('Alpha \uF0A8[^1] Bravo');
    });
  });
});
