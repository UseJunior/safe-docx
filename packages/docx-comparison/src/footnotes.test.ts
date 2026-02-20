import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import {
  findReferencesInOrder,
  isReservedId,
  FootnoteNumberingTracker,
  findFootnoteById,
  findEndnoteById,
  extractNoteText,
} from './footnotes.js';
import { WmlElement, RESERVED_FOOTNOTE_IDS } from './core-types.js';
import { assertDefined } from './testing/test-utils.js';

// Helper to create a document tree with footnote references
function createDocumentWithFootnotes(footnotesIds: string[]): WmlElement {
  return {
    tagName: 'w:body',
    attributes: {},
    children: footnotesIds.map((id) => ({
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            { tagName: 'w:footnoteReference', attributes: { 'w:id': id } },
          ],
        },
      ],
    })),
  };
}

describe('isReservedId', () => {
  it('returns true for separator ID', () => {
    expect(isReservedId(RESERVED_FOOTNOTE_IDS.SEPARATOR)).toBe(true);
    expect(isReservedId('0')).toBe(true);
  });

  it('returns true for continuation separator ID', () => {
    expect(isReservedId(RESERVED_FOOTNOTE_IDS.CONTINUATION_SEPARATOR)).toBe(true);
    expect(isReservedId('1')).toBe(true);
  });

  it('returns false for regular IDs', () => {
    expect(isReservedId('2')).toBe(false);
    expect(isReservedId('42')).toBe(false);
    expect(isReservedId('100')).toBe(false);
  });
});

describe('findReferencesInOrder', () => {
  it('finds footnote references in document order', () => {
    const document = createDocumentWithFootnotes(['5', '3', '8']);
    const refs = findReferencesInOrder(document, 'w:footnoteReference');

    expect(refs).toHaveLength(3);
    const ref0 = refs[0];
    const ref1 = refs[1];
    const ref2 = refs[2];
    assertDefined(ref0, 'refs[0]');
    assertDefined(ref1, 'refs[1]');
    assertDefined(ref2, 'refs[2]');
    expect(ref0.attributes['w:id']).toBe('5');
    expect(ref1.attributes['w:id']).toBe('3');
    expect(ref2.attributes['w:id']).toBe('8');
  });

  it('finds endnote references', () => {
    const document: WmlElement = {
      tagName: 'w:body',
      attributes: {},
      children: [
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [
                { tagName: 'w:endnoteReference', attributes: { 'w:id': '2' } },
              ],
            },
          ],
        },
      ],
    };

    const refs = findReferencesInOrder(document, 'w:endnoteReference');
    expect(refs).toHaveLength(1);
    const endRef0 = refs[0];
    assertDefined(endRef0, 'refs[0]');
    expect(endRef0.attributes['w:id']).toBe('2');
  });

  it('returns empty array when no references', () => {
    const document: WmlElement = {
      tagName: 'w:body',
      attributes: {},
      children: [],
    };

    const refs = findReferencesInOrder(document, 'w:footnoteReference');
    expect(refs).toHaveLength(0);
  });
});

describe('FootnoteNumberingTracker', () => {
  describe('basic numbering', () => {
    it('assigns sequential display numbers', () => {
      const document = createDocumentWithFootnotes(['5', '3', '8']);
      const tracker = new FootnoteNumberingTracker(document);

      expect(tracker.getFootnoteDisplayNumber('5')).toBe(1);
      expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
      expect(tracker.getFootnoteDisplayNumber('8')).toBe(3);
    });

    it('returns undefined for unknown ID', () => {
      const document = createDocumentWithFootnotes(['5']);
      const tracker = new FootnoteNumberingTracker(document);

      expect(tracker.getFootnoteDisplayNumber('999')).toBeUndefined();
    });

    it('skips reserved IDs', () => {
      const document = createDocumentWithFootnotes(['0', '1', '2', '3']);
      const tracker = new FootnoteNumberingTracker(document);

      // IDs 0 and 1 are reserved, so only 2 and 3 get numbers
      expect(tracker.getFootnoteDisplayNumber('0')).toBeUndefined();
      expect(tracker.getFootnoteDisplayNumber('1')).toBeUndefined();
      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
    });

    it('handles 91 footnotes correctly', () => {
      // Create IDs 2-92 (91 footnotes, skipping reserved 0 and 1)
      const ids = Array.from({ length: 91 }, (_, i) => (i + 2).toString());
      const document = createDocumentWithFootnotes(ids);
      const tracker = new FootnoteNumberingTracker(document);

      // First footnote (ID 2) should display as 1
      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      // Last footnote (ID 92) should display as 91
      expect(tracker.getFootnoteDisplayNumber('92')).toBe(91);
      // Total count
      expect(tracker.getFootnoteCount()).toBe(91);
    });
  });

  describe('duplicate references', () => {
    it('handles duplicate references (same footnote referenced twice)', () => {
      const document = createDocumentWithFootnotes(['5', '3', '5', '8']);
      const tracker = new FootnoteNumberingTracker(document);

      // Same ID should return same display number
      expect(tracker.getFootnoteDisplayNumber('5')).toBe(1);
      expect(tracker.getFootnoteDisplayNumber('3')).toBe(2);
      expect(tracker.getFootnoteDisplayNumber('8')).toBe(3);

      // Count should not include duplicates
      expect(tracker.getFootnoteCount()).toBe(3);
    });
  });

  describe('custom marks', () => {
    it('tracks footnotes with customMarkFollows', () => {
      const document: WmlElement = {
        tagName: 'w:body',
        attributes: {},
        children: [
          {
            tagName: 'w:p',
            attributes: {},
            children: [
              {
                tagName: 'w:r',
                attributes: {},
                children: [
                  {
                    tagName: 'w:footnoteReference',
                    attributes: { 'w:id': '2', 'w:customMarkFollows': '1' },
                  },
                ],
              },
            ],
          },
          {
            tagName: 'w:p',
            attributes: {},
            children: [
              {
                tagName: 'w:r',
                attributes: {},
                children: [
                  { tagName: 'w:footnoteReference', attributes: { 'w:id': '3' } },
                ],
              },
            ],
          },
        ],
      };

      const tracker = new FootnoteNumberingTracker(document);

      // ID 2 has custom mark, no display number
      expect(tracker.getFootnoteDisplayNumber('2')).toBeUndefined();
      expect(tracker.hasFootnoteCustomMark('2')).toBe(true);

      // ID 3 gets display number 1
      expect(tracker.getFootnoteDisplayNumber('3')).toBe(1);
      expect(tracker.hasFootnoteCustomMark('3')).toBe(false);
    });
  });

  describe('endnotes', () => {
    it('tracks endnotes separately from footnotes', () => {
      const document: WmlElement = {
        tagName: 'w:body',
        attributes: {},
        children: [
          {
            tagName: 'w:p',
            attributes: {},
            children: [
              {
                tagName: 'w:r',
                attributes: {},
                children: [
                  { tagName: 'w:footnoteReference', attributes: { 'w:id': '2' } },
                  { tagName: 'w:endnoteReference', attributes: { 'w:id': '2' } },
                ],
              },
            ],
          },
        ],
      };

      const tracker = new FootnoteNumberingTracker(document);

      expect(tracker.getFootnoteDisplayNumber('2')).toBe(1);
      expect(tracker.getEndnoteDisplayNumber('2')).toBe(1);
      expect(tracker.getFootnoteCount()).toBe(1);
      expect(tracker.getEndnoteCount()).toBe(1);
    });
  });

  describe('getDisplayNumber (combined)', () => {
    it('checks both footnotes and endnotes', () => {
      const document: WmlElement = {
        tagName: 'w:body',
        attributes: {},
        children: [
          {
            tagName: 'w:p',
            attributes: {},
            children: [
              {
                tagName: 'w:r',
                attributes: {},
                children: [
                  { tagName: 'w:footnoteReference', attributes: { 'w:id': '5' } },
                  { tagName: 'w:endnoteReference', attributes: { 'w:id': '10' } },
                ],
              },
            ],
          },
        ],
      };

      const tracker = new FootnoteNumberingTracker(document);

      expect(tracker.getDisplayNumber('5')).toBe(1);
      expect(tracker.getDisplayNumber('10')).toBe(1);
      expect(tracker.getDisplayNumber('999')).toBeUndefined();
    });
  });

  describe('getFootnoteReferences', () => {
    it('returns all footnote references', () => {
      const document = createDocumentWithFootnotes(['5', '3']);
      const tracker = new FootnoteNumberingTracker(document);

      const refs = tracker.getFootnoteReferences();

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

describe('findFootnoteById', () => {
  it('finds footnote by ID', () => {
    const footnotes: WmlElement = {
      tagName: 'w:footnotes',
      attributes: {},
      children: [
        { tagName: 'w:footnote', attributes: { 'w:id': '0' } },
        { tagName: 'w:footnote', attributes: { 'w:id': '1' } },
        {
          tagName: 'w:footnote',
          attributes: { 'w:id': '2' },
          children: [
            {
              tagName: 'w:p',
              attributes: {},
              children: [
                {
                  tagName: 'w:r',
                  attributes: {},
                  children: [{ tagName: 'w:t', attributes: {}, textContent: 'Test' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const found = findFootnoteById(footnotes, '2');

    expect(found).toBeDefined();
    expect(found!.attributes['w:id']).toBe('2');
  });

  it('returns undefined for unknown ID', () => {
    const footnotes: WmlElement = {
      tagName: 'w:footnotes',
      attributes: {},
      children: [{ tagName: 'w:footnote', attributes: { 'w:id': '2' } }],
    };

    expect(findFootnoteById(footnotes, '999')).toBeUndefined();
  });

  it('returns undefined for wrong root element', () => {
    const wrong: WmlElement = { tagName: 'w:document', attributes: {} };
    expect(findFootnoteById(wrong, '2')).toBeUndefined();
  });
});

describe('findEndnoteById', () => {
  it('finds endnote by ID', () => {
    const endnotes: WmlElement = {
      tagName: 'w:endnotes',
      attributes: {},
      children: [
        { tagName: 'w:endnote', attributes: { 'w:id': '0' } },
        { tagName: 'w:endnote', attributes: { 'w:id': '2' } },
      ],
    };

    const found = findEndnoteById(endnotes, '2');
    expect(found).toBeDefined();
    expect(found!.attributes['w:id']).toBe('2');
  });

  it('returns undefined for wrong root element', () => {
    const wrong: WmlElement = { tagName: 'w:footnotes', attributes: {} };
    expect(findEndnoteById(wrong, '2')).toBeUndefined();
  });
});

describe('extractNoteText', () => {
  it('extracts text from footnote', () => {
    const footnote: WmlElement = {
      tagName: 'w:footnote',
      attributes: { 'w:id': '2' },
      children: [
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [
                { tagName: 'w:t', attributes: {}, textContent: 'This is ' },
              ],
            },
            {
              tagName: 'w:r',
              attributes: {},
              children: [
                { tagName: 'w:t', attributes: {}, textContent: 'footnote text.' },
              ],
            },
          ],
        },
      ],
    };

    expect(extractNoteText(footnote)).toBe('This is footnote text.');
  });

  it('handles empty footnote', () => {
    const footnote: WmlElement = {
      tagName: 'w:footnote',
      attributes: { 'w:id': '2' },
    };

    expect(extractNoteText(footnote)).toBe('');
  });

  it('handles multiple paragraphs', () => {
    const footnote: WmlElement = {
      tagName: 'w:footnote',
      attributes: { 'w:id': '2' },
      children: [
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'Para 1.' }],
            },
          ],
        },
        {
          tagName: 'w:p',
          attributes: {},
          children: [
            {
              tagName: 'w:r',
              attributes: {},
              children: [{ tagName: 'w:t', attributes: {}, textContent: 'Para 2.' }],
            },
          ],
        },
      ],
    };

    expect(extractNoteText(footnote)).toBe('Para 1.Para 2.');
  });
});
