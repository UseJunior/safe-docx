import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
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
import { el } from './testing/dom-test-helpers.js';
import { childElements } from './primitives/index.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Core Types' });

describe('CorrelationStatus', () => {
  test('has all expected values', async ({ given, when, then }: AllureBddContext) => {
    await given('the CorrelationStatus enum', () => {});
    await when('values are accessed', () => {});
    await then('all expected string values are present', () => {
      expect(CorrelationStatus.Unknown).toBe('Unknown');
      expect(CorrelationStatus.Equal).toBe('Equal');
      expect(CorrelationStatus.Deleted).toBe('Deleted');
      expect(CorrelationStatus.Inserted).toBe('Inserted');
      expect(CorrelationStatus.MovedSource).toBe('MovedSource');
      expect(CorrelationStatus.MovedDestination).toBe('MovedDestination');
      expect(CorrelationStatus.FormatChanged).toBe('FormatChanged');
    });
  });

  test('can be used as object keys', async ({ given, when, then }: AllureBddContext) => {
    let counts: Record<CorrelationStatus, number>;

    await given('a record keyed by CorrelationStatus', () => {
      counts = {
        [CorrelationStatus.Unknown]: 0,
        [CorrelationStatus.Equal]: 10,
        [CorrelationStatus.Deleted]: 5,
        [CorrelationStatus.Inserted]: 3,
        [CorrelationStatus.MovedSource]: 1,
        [CorrelationStatus.MovedDestination]: 1,
        [CorrelationStatus.FormatChanged]: 2,
      };
    });

    await when('a value is looked up', () => {});

    await then('the correct value is returned', () => {
      expect(counts[CorrelationStatus.Equal]).toBe(10);
    });
  });
});

describe('WmlElement', () => {
  test('can represent a text element', async ({ given, when, then }: AllureBddContext) => {
    let element: WmlElement;

    await given('a w:t element with text', () => {
      element = el('w:t', {}, undefined, 'Hello World');
    });

    await when('the element is inspected', () => {});

    await then('the tag name and text content are correct', () => {
      expect(element.tagName).toBe('w:t');
      expect(element.textContent).toBe('Hello World');
    });
  });

  test('can represent an element with attributes', async ({ given, when, then }: AllureBddContext) => {
    let element: WmlElement;

    await given('a w:ins element with attributes', () => {
      element = el('w:ins', {
        'w:id': '1',
        'w:author': 'John Doe',
        'w:date': '2025-01-15T10:00:00Z',
      });
    });

    await when('attributes are accessed', () => {});

    await then('the attribute values are correct', () => {
      expect(element.getAttribute('w:id')).toBe('1');
      expect(element.getAttribute('w:author')).toBe('John Doe');
    });
  });

  test('can represent nested elements', async ({ given, when, then }: AllureBddContext) => {
    let paragraph: WmlElement;

    await given('a nested paragraph with run and text', () => {
      const textEl = el('w:t', {}, undefined, 'Hello');
      const run = el('w:r', {}, [textEl]);
      paragraph = el('w:p', {}, [run]);
    });

    await when('child elements are accessed', () => {});

    await then('the nested structure is correct', () => {
      expect(childElements(paragraph)).toHaveLength(1);
      const firstChild = childElements(paragraph)[0];
      assertDefined(firstChild, 'paragraph child[0]');
      expect(firstChild.tagName).toBe('w:r');
      const runChild = childElements(firstChild)[0];
      assertDefined(runChild, 'run child[0]');
      expect(runChild.textContent).toBe('Hello');
    });
  });

  test('can have parent reference', async ({ given, when, then }: AllureBddContext) => {
    let child: WmlElement;
    let parent: WmlElement;

    await given('a child element inside a parent element', () => {
      child = el('w:t', {}, undefined, 'Test');
      parent = el('w:r', {}, [child]);
    });

    await when('the parent reference is checked', () => {});

    await then('the child references the parent', () => {
      expect(child.parentNode).toBe(parent);
    });
  });
});

describe('OpcPart', () => {
  test('represents a document.xml part', async ({ given, when, then }: AllureBddContext) => {
    let part: OpcPart;

    await given('an OpcPart for document.xml', () => {
      part = {
        uri: 'word/document.xml',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      };
    });

    await when('the part is inspected', () => {});

    await then('the uri and content type are correct', () => {
      expect(part.uri).toBe('word/document.xml');
      expect(part.contentType).toContain('wordprocessingml');
    });
  });
});

describe('ComparisonUnitAtom', () => {
  test('can represent a text atom', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('a text atom with Equal status', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'abc123',
        correlationStatus: CorrelationStatus.Equal,
        contentElement: el('w:t', {}, undefined, 'Hello'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
      };
    });

    await when('the atom is inspected', () => {});

    await then('the text content and status are correct', () => {
      expect(atom.contentElement.textContent).toBe('Hello');
      expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
    });
  });

  test('can have move tracking properties', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom with move tracking properties', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'def456',
        correlationStatus: CorrelationStatus.MovedSource,
        contentElement: el('w:t', {}, undefined, 'Moved'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
        moveGroupId: 1,
        moveName: 'move1',
      };
    });

    await when('the atom is inspected', () => {});

    await then('the move properties are correct', () => {
      expect(atom.moveGroupId).toBe(1);
      expect(atom.moveName).toBe('move1');
    });
  });

  test('can have format change information', async ({ given, when, then }: AllureBddContext) => {
    let atom: ComparisonUnitAtom;

    await given('an atom with format change information', () => {
      const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
      atom = {
        sha1Hash: 'ghi789',
        correlationStatus: CorrelationStatus.FormatChanged,
        contentElement: el('w:t', {}, undefined, 'Formatted'),
        ancestorElements: [],
        ancestorUnids: [],
        part,
        formatChange: {
          oldRunProperties: el('w:rPr'),
          newRunProperties: el('w:rPr', {}, [el('w:b')]),
          changedProperties: ['bold'],
        },
      };
    });

    await when('the atom is inspected', () => {});

    await then('the format change contains bold', () => {
      expect(atom.formatChange).toBeDefined();
      expect(atom.formatChange!.changedProperties).toContain('bold');
    });
  });
});

describe('Default Settings', () => {
  describe('DEFAULT_MOVE_DETECTION_SETTINGS', () => {
    test('has expected default values', async ({ given, when, then }: AllureBddContext) => {
      await given('the DEFAULT_MOVE_DETECTION_SETTINGS', () => {});
      await when('values are inspected', () => {});
      await then('all defaults are correct', () => {
        expect(DEFAULT_MOVE_DETECTION_SETTINGS.detectMoves).toBe(true);
        expect(DEFAULT_MOVE_DETECTION_SETTINGS.moveSimilarityThreshold).toBe(0.8);
        expect(DEFAULT_MOVE_DETECTION_SETTINGS.moveMinimumWordCount).toBe(5);
        expect(DEFAULT_MOVE_DETECTION_SETTINGS.caseInsensitiveMove).toBe(true);
      });
    });
  });

  describe('DEFAULT_FORMAT_DETECTION_SETTINGS', () => {
    test('has expected default values', async ({ given, when, then }: AllureBddContext) => {
      await given('the DEFAULT_FORMAT_DETECTION_SETTINGS', () => {});
      await when('values are inspected', () => {});
      await then('detectFormatChanges is true', () => {
        expect(DEFAULT_FORMAT_DETECTION_SETTINGS.detectFormatChanges).toBe(true);
      });
    });
  });

  describe('DEFAULT_COMPARER_SETTINGS', () => {
    test('includes move and format detection settings', async ({ given, when, then }: AllureBddContext) => {
      await given('the DEFAULT_COMPARER_SETTINGS', () => {});
      await when('values are inspected', () => {});
      await then('move and format detection are enabled', () => {
        expect(DEFAULT_COMPARER_SETTINGS.detectMoves).toBe(true);
        expect(DEFAULT_COMPARER_SETTINGS.detectFormatChanges).toBe(true);
      });
    });

    test('has author and dateTime', async ({ given, when, then }: AllureBddContext) => {
      await given('the DEFAULT_COMPARER_SETTINGS', () => {});
      await when('author and dateTime are inspected', () => {});
      await then('author is Comparison and dateTime is a Date', () => {
        expect(DEFAULT_COMPARER_SETTINGS.author).toBe('Comparison');
        expect(DEFAULT_COMPARER_SETTINGS.dateTime).toBeInstanceOf(Date);
      });
    });
  });
});

describe('RUN_PROPERTY_FRIENDLY_NAMES', () => {
  test('maps common properties to friendly names', async ({ given, when, then }: AllureBddContext) => {
    await given('the RUN_PROPERTY_FRIENDLY_NAMES map', () => {});
    await when('common tags are looked up', () => {});
    await then('the friendly names are correct', () => {
      expect(RUN_PROPERTY_FRIENDLY_NAMES['w:b']).toBe('bold');
      expect(RUN_PROPERTY_FRIENDLY_NAMES['w:i']).toBe('italic');
      expect(RUN_PROPERTY_FRIENDLY_NAMES['w:u']).toBe('underline');
      expect(RUN_PROPERTY_FRIENDLY_NAMES['w:sz']).toBe('fontSize');
      expect(RUN_PROPERTY_FRIENDLY_NAMES['w:color']).toBe('color');
    });
  });

  test('has all expected mappings', async ({ given, when, then }: AllureBddContext) => {
    await given('the RUN_PROPERTY_FRIENDLY_NAMES map', () => {});
    await when('all expected tags are checked', () => {});
    await then('each expected tag has a mapping', () => {
      const expectedMappings = [
        'w:b', 'w:i', 'w:u', 'w:strike', 'w:sz', 'w:rFonts', 'w:color', 'w:highlight',
      ];

      for (const tag of expectedMappings) {
        expect(RUN_PROPERTY_FRIENDLY_NAMES[tag]).toBeDefined();
      }
    });
  });
});

describe('RESERVED_FOOTNOTE_IDS', () => {
  test('has separator and continuation separator', async ({ given, when, then }: AllureBddContext) => {
    await given('the RESERVED_FOOTNOTE_IDS constants', () => {});
    await when('values are inspected', () => {});
    await then('separator is 0 and continuation separator is 1', () => {
      expect(RESERVED_FOOTNOTE_IDS.SEPARATOR).toBe('0');
      expect(RESERVED_FOOTNOTE_IDS.CONTINUATION_SEPARATOR).toBe('1');
    });
  });
});

describe('WmlComparerRevisionType', () => {
  test('has all revision types', async ({ given, when, then }: AllureBddContext) => {
    await given('the WmlComparerRevisionType enum', () => {});
    await when('all values are accessed', () => {});
    await then('all expected revision types are present', () => {
      expect(WmlComparerRevisionType.Insertion).toBe('Insertion');
      expect(WmlComparerRevisionType.Deletion).toBe('Deletion');
      expect(WmlComparerRevisionType.MoveFrom).toBe('MoveFrom');
      expect(WmlComparerRevisionType.MoveTo).toBe('MoveTo');
      expect(WmlComparerRevisionType.FormatChanged).toBe('FormatChanged');
    });
  });
});
