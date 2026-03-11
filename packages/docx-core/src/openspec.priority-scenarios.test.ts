import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { detectMovesInAtomList } from './move-detection.js';
import { detectFormatChangesInAtomList } from './format-detection.js';
import {
  ComparisonUnitAtom,
  CorrelationStatus,
  OpcPart,
} from './core-types.js';
import { assertDefined } from './testing/test-utils.js';
import { el } from './testing/dom-test-helpers.js';

const TEST_FEATURE = 'add-priority-scenario-mappings';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

function createTextAtom(
  text: string,
  status: CorrelationStatus
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
  return {
    sha1Hash: `${status}:${text}`,
    correlationStatus: status,
    contentElement: el('w:t', {}, undefined, text),
    ancestorElements: [],
    ancestorUnids: [],
    part,
  };
}

function createAtomWithRunProperties(
  text: string,
  runProperties: Element[],
  status: CorrelationStatus = CorrelationStatus.Equal
): ComparisonUnitAtom {
  const part: OpcPart = { uri: 'word/document.xml', contentType: 'text/xml' };
  const run = el('w:r', {}, [
    el('w:rPr', {}, runProperties),
    el('w:t', {}, undefined, text),
  ]);
  const paragraph = el('w:p', {}, [run]);

  return {
    sha1Hash: `${status}:${text}:${runProperties.map((prop) => prop.tagName).join(',')}`,
    correlationStatus: status,
    contentElement: el('w:t', {}, undefined, text),
    ancestorElements: [paragraph, run],
    ancestorUnids: [],
    part,
  };
}

describe('OpenSpec priority scenario mappings', () => {
  test.openspec('Move detection disabled')(
    'leaves deleted and inserted atoms unchanged when move detection is turned off',
    async ({ given, when, then }: AllureBddContext) => {
      const atoms = [
        createTextAtom('the quick brown fox moved to another section', CorrelationStatus.Deleted),
        createTextAtom('the quick brown fox moved to another section', CorrelationStatus.Inserted),
      ];

      await given('deleted and inserted blocks that would otherwise match', () => {
        expect(atoms).toHaveLength(2);
      });

      await when('move detection runs with detectMoves=false', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: false,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await then('correlation statuses remain deleted and inserted', () => {
        const deleted = atoms[0];
        const inserted = atoms[1];
        assertDefined(deleted, 'atoms[0]');
        assertDefined(inserted, 'atoms[1]');
        expect(deleted.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(inserted.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  test.openspec('Move detected between similar blocks')(
    'marks matching deleted and inserted blocks as move source and destination',
    async ({ given, when, then }: AllureBddContext) => {
      const atoms = [
        createTextAtom('the quick brown fox jumps over', CorrelationStatus.Deleted),
        createTextAtom('unchanged bridge text', CorrelationStatus.Equal),
        createTextAtom('the quick brown fox jumps over', CorrelationStatus.Inserted),
      ];

      await given('a deleted block and inserted block with matching text', () => {
        expect(atoms).toHaveLength(3);
      });

      await when('move detection runs with default matching thresholds', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await then('source and destination are marked as a paired move', () => {
        const source = atoms[0];
        const destination = atoms[2];
        assertDefined(source, 'atoms[0]');
        assertDefined(destination, 'atoms[2]');
        expect(source.correlationStatus).toBe(CorrelationStatus.MovedSource);
        expect(destination.correlationStatus).toBe(CorrelationStatus.MovedDestination);
        expect(source.moveGroupId).toBe(destination.moveGroupId);
        expect(source.moveName).toBe(destination.moveName);
      });
    },
  );

  test.openspec('Short blocks ignored')(
    'does not convert tiny deleted and inserted blocks into move markup',
    async ({ given, when, then }: AllureBddContext) => {
      const atoms = [
        createTextAtom('tiny', CorrelationStatus.Deleted),
        createTextAtom('tiny', CorrelationStatus.Inserted),
      ];

      await given('deleted and inserted blocks below the minimum word threshold', () => {
        expect(atoms).toHaveLength(2);
      });

      await when('move detection requires at least three words per block', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await then('both blocks remain separate deleted and inserted changes', () => {
        const deleted = atoms[0];
        const inserted = atoms[1];
        assertDefined(deleted, 'atoms[0]');
        assertDefined(inserted, 'atoms[1]');
        expect(deleted.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(inserted.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  test.openspec('Below threshold treated as separate changes')(
    'does not mark moves when similarity is below the configured threshold',
    async ({ given, when, then }: AllureBddContext) => {
      const atoms = [
        createTextAtom('the quick brown fox jumps', CorrelationStatus.Deleted),
        createTextAtom('a slow gray elephant sleeps', CorrelationStatus.Inserted),
      ];

      await given('deleted and inserted blocks with low textual overlap', () => {
        expect(atoms).toHaveLength(2);
      });

      await when('move detection runs with a strict similarity threshold', () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await then('both blocks stay as independent deletion and insertion', () => {
        const deleted = atoms[0];
        const inserted = atoms[1];
        assertDefined(deleted, 'atoms[0]');
        assertDefined(inserted, 'atoms[1]');
        expect(deleted.correlationStatus).toBe(CorrelationStatus.Deleted);
        expect(inserted.correlationStatus).toBe(CorrelationStatus.Inserted);
      });
    },
  );

  test.openspec('Format detection disabled')(
    'keeps equal status when format detection is disabled',
    async ({ given, when, then }: AllureBddContext) => {
      const atom = createAtomWithRunProperties('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithRunProperties('Test', []);

      await given('an equal atom where the revised run adds bold formatting', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
      });

      await when('format detection runs with detectFormatChanges=false', () => {
        detectFormatChangesInAtomList([atom], { detectFormatChanges: false });
      });

      await then('no format-change metadata is produced', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
        expect(atom.formatChange).toBeUndefined();
      });
    },
  );

  test.openspec('Text becomes bold')(
    'marks equal text with run-property delta as format changed',
    async ({ given, when, then }: AllureBddContext) => {
      const atom = createAtomWithRunProperties('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithRunProperties('Test', []);

      await given('identical text where the revised run has bold and original does not', () => {
        expect(atom.comparisonUnitAtomBefore).toBeDefined();
      });

      await when('format detection runs with default enabled behavior', () => {
        detectFormatChangesInAtomList([atom]);
      });

      await then('the atom is marked as format changed with bold listed', () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.FormatChanged);
        expect(atom.formatChange?.changedProperties).toContain('bold');
      });
    },
  );
});
