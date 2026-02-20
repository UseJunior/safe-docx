import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import {
  CorrelationStatus,
  WmlElement,
  ComparisonUnitAtom,
  OpcPart,
  DEFAULT_MOVE_DETECTION_SETTINGS,
  DEFAULT_FORMAT_DETECTION_SETTINGS,
  DEFAULT_COMPARER_SETTINGS,
  RUN_PROPERTY_FRIENDLY_NAMES,
  RESERVED_FOOTNOTE_IDS,
  WmlComparerRevisionType,
} from './core-types.js';
import { assertDefined } from './testing/test-utils.js';

describe('CorrelationStatus', () => {
  it('has all expected values', () => {
    expect(CorrelationStatus.Unknown).toBe('Unknown');
    expect(CorrelationStatus.Equal).toBe('Equal');
    expect(CorrelationStatus.Deleted).toBe('Deleted');
    expect(CorrelationStatus.Inserted).toBe('Inserted');
    expect(CorrelationStatus.MovedSource).toBe('MovedSource');
    expect(CorrelationStatus.MovedDestination).toBe('MovedDestination');
    expect(CorrelationStatus.FormatChanged).toBe('FormatChanged');
  });

  it('can be used as object keys', () => {
    const counts: Record<CorrelationStatus, number> = {
      [CorrelationStatus.Unknown]: 0,
      [CorrelationStatus.Equal]: 10,
      [CorrelationStatus.Deleted]: 5,
      [CorrelationStatus.Inserted]: 3,
      [CorrelationStatus.MovedSource]: 1,
      [CorrelationStatus.MovedDestination]: 1,
      [CorrelationStatus.FormatChanged]: 2,
    };

    expect(counts[CorrelationStatus.Equal]).toBe(10);
  });
});

describe('WmlElement', () => {
  it('can represent a text element', () => {
    const element: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'Hello World',
    };

    expect(element.tagName).toBe('w:t');
    expect(element.textContent).toBe('Hello World');
  });

  it('can represent an element with attributes', () => {
    const element: WmlElement = {
      tagName: 'w:ins',
      attributes: {
        'w:id': '1',
        'w:author': 'John Doe',
        'w:date': '2025-01-15T10:00:00Z',
      },
    };

    expect(element.attributes['w:id']).toBe('1');
    expect(element.attributes['w:author']).toBe('John Doe');
  });

  it('can represent nested elements', () => {
    const paragraph: WmlElement = {
      tagName: 'w:p',
      attributes: {},
      children: [
        {
          tagName: 'w:r',
          attributes: {},
          children: [
            {
              tagName: 'w:t',
              attributes: {},
              textContent: 'Hello',
            },
          ],
        },
      ],
    };

    expect(paragraph.children).toHaveLength(1);
    const run = paragraph.children![0];
    assertDefined(run, 'paragraph.children[0]');
    expect(run.tagName).toBe('w:r');
    const textEl = run.children![0];
    assertDefined(textEl, 'run.children[0]');
    expect(textEl.textContent).toBe('Hello');
  });

  it('can have parent reference', () => {
    const parent: WmlElement = {
      tagName: 'w:r',
      attributes: {},
    };

    const child: WmlElement = {
      tagName: 'w:t',
      attributes: {},
      textContent: 'Test',
      parent: parent,
    };

    expect(child.parent).toBe(parent);
  });
});

describe('OpcPart', () => {
  it('represents a document.xml part', () => {
    const part: OpcPart = {
      uri: 'word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    };

    expect(part.uri).toBe('word/document.xml');
    expect(part.contentType).toContain('wordprocessingml');
  });
});

describe('ComparisonUnitAtom', () => {
  it('can represent a text atom', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'abc123',
      correlationStatus: CorrelationStatus.Equal,
      contentElement: {
        tagName: 'w:t',
        attributes: {},
        textContent: 'Hello',
      },
      ancestorElements: [],
      ancestorUnids: [],
      part,
    };

    expect(atom.contentElement.textContent).toBe('Hello');
    expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
  });

  it('can have move tracking properties', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'def456',
      correlationStatus: CorrelationStatus.MovedSource,
      contentElement: { tagName: 'w:t', attributes: {}, textContent: 'Moved' },
      ancestorElements: [],
      ancestorUnids: [],
      part,
      moveGroupId: 1,
      moveName: 'move1',
    };

    expect(atom.moveGroupId).toBe(1);
    expect(atom.moveName).toBe('move1');
  });

  it('can have format change information', () => {
    const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };

    const atom: ComparisonUnitAtom = {
      sha1Hash: 'ghi789',
      correlationStatus: CorrelationStatus.FormatChanged,
      contentElement: { tagName: 'w:t', attributes: {}, textContent: 'Formatted' },
      ancestorElements: [],
      ancestorUnids: [],
      part,
      formatChange: {
        oldRunProperties: { tagName: 'w:rPr', attributes: {}, children: [] },
        newRunProperties: {
          tagName: 'w:rPr',
          attributes: {},
          children: [{ tagName: 'w:b', attributes: {} }],
        },
        changedProperties: ['bold'],
      },
    };

    expect(atom.formatChange).toBeDefined();
    expect(atom.formatChange!.changedProperties).toContain('bold');
  });
});

describe('Default Settings', () => {
  describe('DEFAULT_MOVE_DETECTION_SETTINGS', () => {
    it('has expected default values', () => {
      expect(DEFAULT_MOVE_DETECTION_SETTINGS.detectMoves).toBe(true);
      expect(DEFAULT_MOVE_DETECTION_SETTINGS.moveSimilarityThreshold).toBe(0.8);
      expect(DEFAULT_MOVE_DETECTION_SETTINGS.moveMinimumWordCount).toBe(5);
      expect(DEFAULT_MOVE_DETECTION_SETTINGS.caseInsensitiveMove).toBe(true);
    });
  });

  describe('DEFAULT_FORMAT_DETECTION_SETTINGS', () => {
    it('has expected default values', () => {
      expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
    });
  });

  describe('DEFAULT_COMPARER_SETTINGS', () => {
    it('includes move and format detection settings', () => {
      expect(DEFAULT_COMPARER_SETTINGS.detectMoves).toBe(true);
      expect(DEFAULT_COMPARER_SETTINGS.detectFormatChanges).toBe(true);
    });

    it('has author and dateTime', () => {
      expect(DEFAULT_COMPARER_SETTINGS.author).toBe('Comparison');
      expect(DEFAULT_COMPARER_SETTINGS.dateTime).toBeInstanceOf(Date);
    });
  });
});

describe('RUN_PROPERTY_FRIENDLY_NAMES', () => {
  it('maps common properties to friendly names', () => {
    expect(RUN_PROPERTY_FRIENDLY_NAMES['w:b']).toBe('bold');
    expect(RUN_PROPERTY_FRIENDLY_NAMES['w:i']).toBe('italic');
    expect(RUN_PROPERTY_FRIENDLY_NAMES['w:u']).toBe('underline');
    expect(RUN_PROPERTY_FRIENDLY_NAMES['w:sz']).toBe('fontSize');
    expect(RUN_PROPERTY_FRIENDLY_NAMES['w:color']).toBe('color');
  });

  it('has all expected mappings', () => {
    const expectedMappings = [
      'w:b',
      'w:i',
      'w:u',
      'w:strike',
      'w:sz',
      'w:rFonts',
      'w:color',
      'w:highlight',
    ];

    for (const tag of expectedMappings) {
      expect(RUN_PROPERTY_FRIENDLY_NAMES[tag]).toBeDefined();
    }
  });
});

describe('RESERVED_FOOTNOTE_IDS', () => {
  it('has separator and continuation separator', () => {
    expect(RESERVED_FOOTNOTE_IDS.SEPARATOR).toBe('0');
    expect(RESERVED_FOOTNOTE_IDS.CONTINUATION_SEPARATOR).toBe('1');
  });
});

describe('WmlComparerRevisionType', () => {
  it('has all revision types', () => {
    expect(WmlComparerRevisionType.Insertion).toBe('Insertion');
    expect(WmlComparerRevisionType.Deletion).toBe('Deletion');
    expect(WmlComparerRevisionType.MoveFrom).toBe('MoveFrom');
    expect(WmlComparerRevisionType.MoveTo).toBe('MoveTo');
    expect(WmlComparerRevisionType.FormatChanged).toBe('FormatChanged');
  });
});
