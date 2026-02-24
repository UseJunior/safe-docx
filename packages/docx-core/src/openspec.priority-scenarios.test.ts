import { describe, expect } from 'vitest';
import { testAllure, allureStep } from './testing/allure-test.js';
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
    async () => {
      const atoms = [
        createTextAtom('the quick brown fox moved to another section', CorrelationStatus.Deleted),
        createTextAtom('the quick brown fox moved to another section', CorrelationStatus.Inserted),
      ];

      await allureStep('Given deleted and inserted blocks that would otherwise match', async () => {
        expect(atoms).toHaveLength(2);
      });

      await allureStep('When move detection runs with detectMoves=false', async () => {
        detectMovesInAtomList(atoms, {
          detectMoves: false,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then correlation statuses remain deleted and inserted', async () => {
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
    async () => {
      const atoms = [
        createTextAtom('the quick brown fox jumps over', CorrelationStatus.Deleted),
        createTextAtom('unchanged bridge text', CorrelationStatus.Equal),
        createTextAtom('the quick brown fox jumps over', CorrelationStatus.Inserted),
      ];

      await allureStep('Given a deleted block and inserted block with matching text', async () => {
        expect(atoms).toHaveLength(3);
      });

      await allureStep('When move detection runs with default matching thresholds', async () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then source and destination are marked as a paired move', async () => {
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
    async () => {
      const atoms = [
        createTextAtom('tiny', CorrelationStatus.Deleted),
        createTextAtom('tiny', CorrelationStatus.Inserted),
      ];

      await allureStep('Given deleted and inserted blocks below the minimum word threshold', async () => {
        expect(atoms).toHaveLength(2);
      });

      await allureStep('When move detection requires at least three words per block', async () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then both blocks remain separate deleted and inserted changes', async () => {
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
    async () => {
      const atoms = [
        createTextAtom('the quick brown fox jumps', CorrelationStatus.Deleted),
        createTextAtom('a slow gray elephant sleeps', CorrelationStatus.Inserted),
      ];

      await allureStep('Given deleted and inserted blocks with low textual overlap', async () => {
        expect(atoms).toHaveLength(2);
      });

      await allureStep('When move detection runs with a strict similarity threshold', async () => {
        detectMovesInAtomList(atoms, {
          detectMoves: true,
          moveSimilarityThreshold: 0.8,
          moveMinimumWordCount: 3,
          caseInsensitiveMove: true,
        });
      });

      await allureStep('Then both blocks stay as independent deletion and insertion', async () => {
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
    async () => {
      const atom = createAtomWithRunProperties('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithRunProperties('Test', []);

      await allureStep('Given an equal atom where the revised run adds bold formatting', async () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
      });

      await allureStep('When format detection runs with detectFormatChanges=false', async () => {
        detectFormatChangesInAtomList([atom], { detectFormatChanges: false });
      });

      await allureStep('Then no format-change metadata is produced', async () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.Equal);
        expect(atom.formatChange).toBeUndefined();
      });
    },
  );

  test.openspec('Text becomes bold')(
    'marks equal text with run-property delta as format changed',
    async () => {
      const atom = createAtomWithRunProperties('Test', [el('w:b')]);
      atom.comparisonUnitAtomBefore = createAtomWithRunProperties('Test', []);

      await allureStep('Given identical text where the revised run has bold and original does not', async () => {
        expect(atom.comparisonUnitAtomBefore).toBeDefined();
      });

      await allureStep('When format detection runs with default enabled behavior', async () => {
        detectFormatChangesInAtomList([atom]);
      });

      await allureStep('Then the atom is marked as format changed with bold listed', async () => {
        expect(atom.correlationStatus).toBe(CorrelationStatus.FormatChanged);
        expect(atom.formatChange?.changedProperties).toContain('bold');
      });
    },
  );
});
