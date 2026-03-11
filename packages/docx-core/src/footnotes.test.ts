import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  findReferencesInOrder,
  isReservedId,
  FootnoteNumberingTracker,
  findFootnoteById,
  findEndnoteById,
  extractNoteText,
} from './footnotes.js';
import { RESERVED_FOOTNOTE_IDS } from './core-types.js';
import { el } from './testing/dom-test-helpers.js';
import { assertDefined } from './testing/test-utils.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Footnotes' });

// Helper to create a document tree with footnote references
function createDocumentWithFootnotes(footnotesIds: string[]): Element {
  return el(
    'w:body',
    {},
    footnotesIds.map((id) =>
      el('w:p', {}, [
        el('w:r', {}, [el('w:footnoteReference', { 'w:id': id })]),
      ])
    )
  );
}

describe('isReservedId', () => {
  test('returns true for separator ID', async ({ given, when, then }: AllureBddContext) => {
    await given('the separator ID constants', () => {});
    await when('isReservedId is called', () => {});
    await then('true is returned for both "0" and SEPARATOR', () => {
      expect(isReservedId(RESERVED_FOOTNOTE_IDS.SEPARATOR)).toBe(true);
      expect(isReservedId('0')).toBe(true);
    });
  });

  test('returns true for continuation separator ID', async ({ given, when, then }: AllureBddContext) => {
    await given('the continuation separator ID constants', () => {});
    await when('isReservedId is called', () => {});
    await then('true is returned for both "1" and CONTINUATION_SEPARATOR', () => {
      expect(isReservedId(RESERVED_FOOTNOTE_IDS.CONTINUATION_SEPARATOR)).toBe(true);
      expect(isReservedId('1')).toBe(true);
    });
  });

  test('returns false for regular IDs', async ({ given, when, then }: AllureBddContext) => {
    await given('regular non-reserved IDs', () => {});
    await when('isReservedId is called', () => {});
    await then('false is returned', () => {
      expect(isReservedId('2')).toBe(false);
      expect(isReservedId('42')).toBe(false);
      expect(isReservedId('100')).toBe(false);
    });
  });
});

describe('findReferencesInOrder', () => {
  test('finds footnote references in document order', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let refs: Element[];

    await given('a document with three footnote references', () => {
      document = createDocumentWithFootnotes(['5', '3', '8']);
    });

    await when('footnote references are found', () => {
      refs = findReferencesInOrder(document, 'w:footnoteReference');
    });

    await then('references are returned in document order', () => {
      expect(refs).toHaveLength(3);
      const ref0 = refs[0];
      const ref1 = refs[1];
      const ref2 = refs[2];
      assertDefined(ref0, 'refs[0]');
      assertDefined(ref1, 'refs[1]');
      assertDefined(ref2, 'refs[2]');
      expect(ref0.getAttribute('w:id')).toBe('5');
      expect(ref1.getAttribute('w:id')).toBe('3');
      expect(ref2.getAttribute('w:id')).toBe('8');
    });
  });

  test('finds endnote references', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let refs: Element[];

    await given('a document with one endnote reference', () => {
      document = el('w:body', {}, [
        el('w:p', {}, [
          el('w:r', {}, [el('w:endnoteReference', { 'w:id': '2' })]),
        ]),
      ]);
    });

    await when('endnote references are found', () => {
      refs = findReferencesInOrder(document, 'w:endnoteReference');
    });

    await then('the endnote reference is returned', () => {
      expect(refs).toHaveLength(1);
      const endRef0 = refs[0];
      assertDefined(endRef0, 'refs[0]');
      expect(endRef0.getAttribute('w:id')).toBe('2');
    });
  });

  test('returns empty array when no references', async ({ given, when, then }: AllureBddContext) => {
    let document: Element;
    let refs: Element[];

    await given('a document with no footnote references', () => {
      document = el('w:body');
    });

    await when('footnote references are found', () => {
      refs = findReferencesInOrder(document, 'w:footnoteReference');
    });

    await then('an empty array is returned', () => {
      expect(refs).toHaveLength(0);
    });
  });
});

describe('FootnoteNumberingTracker', () => {
  describe('basic numbering', () => {
    test('assigns sequential display numbers', async ({ given, when, then }: AllureBddContext) => {
      let document: Element;
      let tracker: FootnoteNumberingTracker;

      await given('a document with three footnote references', () => {
        document = createDocumentWithFootnotes(['5', '3', '8']);
      });

      await when('a FootnoteNumberingTracker is created', () => {
        tracker = new FootnoteNumberingTracker(document);
      });

      await then('each footnote gets a sequential display number', () => {
        expect(tracker.getFootnoteDisplayNumber('5')).toBe(1);
        expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
        expect(tracker.getFootnoteDisplayNumber('8')).toBe(3);
      });
    });

    test('returns undefined for unknown ID', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with one footnote', () => {
        const document = createDocumentWithFootnotes(['5']);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('an unknown ID is looked up', () => {});

      await then('undefined is returned', () => {
        expect(tracker.getFootnoteDisplayNumber('999')).toBeUndefined();
      });
    });

    test('skips reserved IDs', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with reserved and regular footnote IDs', () => {
        const document = createDocumentWithFootnotes(['0', '1', '2', '3']);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('display numbers are retrieved', () => {});

      await then('reserved IDs have no display number and regular IDs are numbered', () => {
        // IDs 0 and 1 are reserved, so only 2 and 3 get numbers
        expect(tracker.getFootnoteDisplayNumber('0')).toBeUndefined();
        expect(tracker.getFootnoteDisplayNumber('1')).toBeUndefined();
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
        expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
      });
    });

    test('handles 91 footnotes correctly', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with 91 footnotes', () => {
        // Create IDs 2-92 (91 footnotes, skipping reserved 0 and 1)
        const ids = Array.from({ length: 91 }, (_, i) => (i + 2).toString());
        const document = createDocumentWithFootnotes(ids);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('display numbers are retrieved', () => {});

      await then('first is 1, last is 91, and total count is 91', () => {
        // First footnote (ID 2) should display as 1
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
        // Last footnote (ID 92) should display as 91
        expect(tracker.getFootnoteDisplayNumber('92')).toBe(91);
        // Total count
        expect(tracker.getFootnoteCount()).toBe(91);
      });
    });
  });

  describe('duplicate references', () => {
    test('handles duplicate references (same footnote referenced twice)', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document where footnote 5 is referenced twice', () => {
        const document = createDocumentWithFootnotes(['5', '3', '5', '8']);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('display numbers are retrieved', () => {});

      await then('duplicate references return the same number and count is not inflated', () => {
        // Same ID should return same display number
        expect(tracker.getFootnoteDisplayNumber('5')).toBe(1);
        expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
        expect(tracker.getFootnoteDisplayNumber('8')).toBe(3);

        // Count should not include duplicates
        expect(tracker.getFootnoteCount()).toBe(3);
      });
    });
  });

  describe('custom marks', () => {
    test('tracks footnotes with customMarkFollows', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with a custom-mark footnote and a regular footnote', () => {
        const document = el('w:body', {}, [
          el('w:p', {}, [
            el('w:r', {}, [
              el('w:footnoteReference', {
                'w:id': '2',
                'w:customMarkFollows': '1',
              }),
            ]),
          ]),
          el('w:p', {}, [
            el('w:r', {}, [el('w:footnoteReference', { 'w:id': '3' })]),
          ]),
        ]);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('display numbers are retrieved', () => {});

      await then('the custom-mark footnote has no display number and the regular one has 1', () => {
        // ID 2 has custom mark, no display number
        expect(tracker.getFootnoteDisplayNumber('2')).toBeUndefined();
        expect(tracker.hasFootnoteCustomMark('2')).toBe(true);

        // ID 3 gets display number 1
        expect(tracker.getFootnoteDisplayNumber('3')).toBe(1);
        expect(tracker.hasFootnoteCustomMark('3')).toBe(false);
      });
    });
  });

  describe('endnotes', () => {
    test('tracks endnotes separately from footnotes', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with both a footnote and endnote reference for the same ID', () => {
        const document = el('w:body', {}, [
          el('w:p', {}, [
            el('w:r', {}, [
              el('w:footnoteReference', { 'w:id': '2' }),
              el('w:endnoteReference', { 'w:id': '2' }),
            ]),
          ]),
        ]);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('display numbers are retrieved', () => {});

      await then('footnote and endnote counts are tracked separately', () => {
        expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
        expect(tracker.getEndnoteDisplayNumber('2')).toBe(1);
        expect(tracker.getFootnoteCount()).toBe(1);
        expect(tracker.getEndnoteCount()).toBe(1);
      });
    });
  });

  describe('getDisplayNumber (combined)', () => {
    test('checks both footnotes and endnotes', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;

      await given('a document with a footnote and an endnote', () => {
        const document = el('w:body', {}, [
          el('w:p', {}, [
            el('w:r', {}, [
              el('w:footnoteReference', { 'w:id': '5' }),
              el('w:endnoteReference', { 'w:id': '10' }),
            ]),
          ]),
        ]);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('getDisplayNumber is called', () => {});

      await then('footnote and endnote IDs both return 1 and unknown returns undefined', () => {
        expect(tracker.getDisplayNumber('5')).toBe(1);
        expect(tracker.getDisplayNumber('10')).toBe(1);
        expect(tracker.getDisplayNumber('999')).toBeUndefined();
      });
    });
  });

  describe('getFootnoteReferences', () => {
    test('returns all footnote references', async ({ given, when, then }: AllureBddContext) => {
      let tracker: FootnoteNumberingTracker;
      let refs: ReturnType<FootnoteNumberingTracker['getFootnoteReferences']>;

      await given('a document with two footnote references', () => {
        const document = createDocumentWithFootnotes(['5', '3']);
        tracker = new FootnoteNumberingTracker(document);
      });

      await when('getFootnoteReferences is called', () => {
        refs = tracker.getFootnoteReferences();
      });

      await then('all references with display numbers are returned', () => {
        expect(refs).toHaveLength(2);
        const fnRef0 = refs[0];
        const fnRef1 = refs[1];
        assertDefined(fnRef0, 'refs[0]');
        assertDefined(fnRef1, 'refs[1]');
        expect(fnRef0.xmlId).toBe('5');
        expect(fnRef0.displayNumber).toBe(1);
        expect(fnRef1.xmlId).toBe('3');
        expect(fnRef1.displayNumber).toBe(2);
      });
    });
  });
});

describe('findFootnoteById', () => {
  test('finds footnote by ID', async ({ given, when, then }: AllureBddContext) => {
    let footnotes: Element;
    let found: Element | undefined;

    await given('a footnotes element with IDs 0, 1, and 2', () => {
      footnotes = el('w:footnotes', {}, [
        el('w:footnote', { 'w:id': '0' }),
        el('w:footnote', { 'w:id': '1' }),
        el('w:footnote', { 'w:id': '2' }, [
          el('w:p', {}, [
            el('w:r', {}, [el('w:t', {}, undefined, 'Test')]),
          ]),
        ]),
      ]);
    });

    await when('footnote 2 is looked up', () => {
      found = findFootnoteById(footnotes, '2');
    });

    await then('the correct footnote is returned', () => {
      expect(found).toBeDefined();
      expect(found!.getAttribute('w:id')).toBe('2');
    });
  });

  test('returns undefined for unknown ID', async ({ given, when, then }: AllureBddContext) => {
    let footnotes: Element;

    await given('a footnotes element with ID 2', () => {
      footnotes = el('w:footnotes', {}, [el('w:footnote', { 'w:id': '2' })]);
    });

    await when('a non-existent ID is looked up', () => {});

    await then('undefined is returned', () => {
      expect(findFootnoteById(footnotes, '999')).toBeUndefined();
    });
  });

  test('returns undefined for wrong root element', async ({ given, when, then }: AllureBddContext) => {
    let wrong: Element;

    await given('a non-footnotes element', () => {
      wrong = el('w:document');
    });

    await when('a footnote is looked up', () => {});

    await then('undefined is returned', () => {
      expect(findFootnoteById(wrong, '2')).toBeUndefined();
    });
  });
});

describe('findEndnoteById', () => {
  test('finds endnote by ID', async ({ given, when, then }: AllureBddContext) => {
    let endnotes: Element;
    let found: Element | undefined;

    await given('an endnotes element with IDs 0 and 2', () => {
      endnotes = el('w:endnotes', {}, [
        el('w:endnote', { 'w:id': '0' }),
        el('w:endnote', { 'w:id': '2' }),
      ]);
    });

    await when('endnote 2 is looked up', () => {
      found = findEndnoteById(endnotes, '2');
    });

    await then('the correct endnote is returned', () => {
      expect(found).toBeDefined();
      expect(found!.getAttribute('w:id')).toBe('2');
    });
  });

  test('returns undefined for wrong root element', async ({ given, when, then }: AllureBddContext) => {
    let wrong: Element;

    await given('a footnotes element instead of endnotes', () => {
      wrong = el('w:footnotes');
    });

    await when('an endnote is looked up', () => {});

    await then('undefined is returned', () => {
      expect(findEndnoteById(wrong, '2')).toBeUndefined();
    });
  });
});

describe('extractNoteText', () => {
  test('extracts text from footnote', async ({ given, when, then }: AllureBddContext) => {
    let footnote: Element;

    await given('a footnote with two text runs', () => {
      footnote = el('w:footnote', { 'w:id': '2' }, [
        el('w:p', {}, [
          el('w:r', {}, [el('w:t', {}, undefined, 'This is ')]),
          el('w:r', {}, [el('w:t', {}, undefined, 'footnote text.')]),
        ]),
      ]);
    });

    await when('text is extracted', () => {});

    await then('the concatenated text is returned', () => {
      expect(extractNoteText(footnote)).toBe('This is footnote text.');
    });
  });

  test('handles empty footnote', async ({ given, when, then }: AllureBddContext) => {
    let footnote: Element;

    await given('an empty footnote', () => {
      footnote = el('w:footnote', { 'w:id': '2' });
    });

    await when('text is extracted', () => {});

    await then('an empty string is returned', () => {
      expect(extractNoteText(footnote)).toBe('');
    });
  });

  test('handles multiple paragraphs', async ({ given, when, then }: AllureBddContext) => {
    let footnote: Element;

    await given('a footnote with two paragraphs', () => {
      footnote = el('w:footnote', { 'w:id': '2' }, [
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'Para 1.')])]),
        el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'Para 2.')])]),
      ]);
    });

    await when('text is extracted', () => {});

    await then('all paragraph texts are concatenated', () => {
      expect(extractNoteText(footnote)).toBe('Para 1.Para 2.');
    });
  });
});
