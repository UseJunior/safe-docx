import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  wrapAsInserted,
  wrapAsDeleted,
  insertDeletedRun,
  insertDeletedParagraph,
  insertMoveFromRun,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  addFormatChange,
  addParagraphPropertyChange,
  wrapParagraphAsInserted,
  wrapParagraphAsDeleted,
  preSplitMixedStatusRuns,
  preSplitInterleavedWordRuns,
  groupDeletionsBeforeInsertions,
  createRevisionIdState,
  suppressNoOpChangePairs,
  mergeWhitespaceBridgedTrackChanges,
  coalesceDelInsPairChains,
  runHasVisibleContent,
} from './inPlaceModifier.js';
import { childElements, findAllByTagName } from '../../primitives/index.js';
import { el } from '../../testing/dom-test-helpers.js';
import { assertDefined } from '../../testing/test-utils.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Inplace Modifier' });

/**
 * Create a mock atom for testing.
 */
function createMockAtom(overrides: Partial<ComparisonUnitAtom> = {}): ComparisonUnitAtom {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  return {
    contentElement: el('w:t', {}, undefined, 'text'),
    ancestorElements: [],
    ancestorUnids: [],
    part: mockPart,
    sha1Hash: 'abc123',
    correlationStatus: CorrelationStatus.Unknown,
    ...overrides,
  };
}

describe('inPlaceModifier', () => {
  const author = 'Test Author';
  const dateStr = '2025-01-01T00:00:00Z';

  describe('wrapAsInserted', () => {
    test('should wrap a run element with w:ins', async ({ given, when, then, and }: AllureBddContext) => {
      let t: Element, r: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run element with text content in a paragraph', () => {
        t = el('w:t', {}, undefined, 'inserted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsInserted is called', () => {
        result = wrapAsInserted(r, author, dateStr, state);
      });

      await then('the result is true', () => {
        expect(result).toBe(true);
      });

      await and('the paragraph child is a w:ins with correct attributes', () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.tagName).toBe('w:ins');
        expect(ins.getAttribute('w:author')).toBe(author);
        expect(ins.getAttribute('w:date')).toBe(dateStr);
        expect(ins.getAttribute('w:id')).toBe('1');
        // ins should have r as child
        const insChildren = childElements(ins);
        expect(insChildren[0]).toBe(r);
      });
    });

    test('should not wrap the same run twice', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run already wrapped with w:ins', () => {
        r = el('w:r');
        el('w:p', {}, [r]); // parent needed for DOM tree structure
        state = createRevisionIdState();
        wrapAsInserted(r, author, dateStr, state);
      });

      await when('wrapAsInserted is called again on the same run', () => {
        result = wrapAsInserted(r, author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });

    test('should increment revision IDs', async ({ given, when, then }: AllureBddContext) => {
      let r1: Element, r2: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('two run elements in a paragraph', () => {
        r1 = el('w:r');
        r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);
        state = createRevisionIdState();
      });

      await when('wrapAsInserted is called on each run', () => {
        wrapAsInserted(r1, author, dateStr, state);
        wrapAsInserted(r2, author, dateStr, state);
      });

      await then('each w:ins wrapper has an incrementing w:id', () => {
        const pChildren = childElements(p);
        const first = pChildren[0];
        assertDefined(first, 'p children[0]');
        expect(first.getAttribute('w:id')).toBe('1');
        const second = pChildren[1];
        assertDefined(second, 'p children[1]');
        expect(second.getAttribute('w:id')).toBe('2');
      });
    });
  });

  describe('wrapAsDeleted', () => {
    test('should wrap a run element with w:del', async ({ given, when, then, and }: AllureBddContext) => {
      let t: Element, r: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run element with text content in a paragraph', () => {
        t = el('w:t', {}, undefined, 'deleted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        result = wrapAsDeleted(r, author, dateStr, state);
      });

      await then('the result is true', () => {
        expect(result).toBe(true);
      });

      await and('the paragraph child is a w:del containing the run', () => {
        const pChildren = childElements(p);
        const del = pChildren[0];
        assertDefined(del, 'p children[0]');
        expect(del.tagName).toBe('w:del');
        const delChildren = childElements(del);
        expect(delChildren[0]).toBe(r);
      });
    });

    test('should convert w:t to w:delText', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with a w:t text element', () => {
        const t = el('w:t', {}, undefined, 'deleted text');
        r = el('w:r', {}, [t]);
        el('w:p', {}, [r]); // parent needed for DOM tree structure
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        wrapAsDeleted(r, author, dateStr, state);
      });

      await then('the w:t is replaced by w:delText with the original content', () => {
        // After conversion, the original t element is replaced in the DOM.
        // Find the delText within the run.
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('deleted text');
      });
    });
  });

  describe('insertDeletedRun', () => {
    test('should clone and insert a deleted run', async ({ given, when, then, and }: AllureBddContext) => {
      let existingR: Element, targetP: Element;
      let deletedAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom and a target paragraph with an existing run', () => {
        // Create the original (deleted) run
        const originalT = el('w:t', {}, undefined, 'deleted');
        const originalR = el('w:r', { id: 'original' }, [originalT]);
        const originalP = el('w:p', {}, [originalR]);

        // Create the target paragraph
        const existingT = el('w:t', {}, undefined, 'existing');
        existingR = el('w:r', {}, [existingT]);
        targetP = el('w:p', {}, [existingR]);

        // Create a mock deleted atom
        deletedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: originalR,
          sourceParagraphElement: originalP,
          contentElement: el('w:t', {}, undefined, 'deleted'),
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called after the existing run', () => {
        result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);
      });

      await then('the result is a w:del element inserted after the existing run', () => {
        assertDefined(result, 'result');
        expect(result.tagName).toBe('w:del');
        // Should be inserted after existingR
        const targetChildren = childElements(targetP);
        expect(targetChildren).toHaveLength(2);
        expect(targetChildren[1]).toBe(result);
      });

      await and('the w:del contains a cloned run with w:delText', () => {
        assertDefined(result, 'result');
        // The cloned run should be inside the del
        const resultChildren = childElements(result);
        const clonedRun = resultChildren[0];
        assertDefined(clonedRun, 'result children[0]');
        expect(clonedRun.tagName).toBe('w:r');
        // The text should be converted to delText
        const clonedRunChildren = childElements(clonedRun);
        const delText = clonedRunChildren[0];
        assertDefined(delText, 'clonedRun children[0]');
        expect(delText.tagName).toBe('w:delText');
      });
    });

    test('should insert only the deleted atom fragment, not the full source run text', async ({ given, when, then, and }: AllureBddContext) => {
      let existingR: Element, targetP: Element;
      let deletedAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom whose content is a sub-token of a larger source run', () => {
        const originalRPr = el('w:rPr', {}, [el('w:b')]);
        const originalT = el('w:t', {}, undefined, 'prefix and deleted token');
        const originalR = el('w:r', { id: 'original' }, [originalRPr, originalT]);
        const originalP = el('w:p', {}, [originalR]);

        existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
        targetP = el('w:p', {}, [existingR]);

        deletedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: originalR,
          sourceParagraphElement: originalP,
          contentElement: el('w:t', {}, undefined, 'deleted token'),
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called', () => {
        result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);
      });

      await then('the inserted run preserves formatting from the source run', () => {
        assertDefined(result, 'result');
        const resultChildren = childElements(result);
        const insertedRun = resultChildren[0];
        assertDefined(insertedRun, 'result children[0]');
        expect(insertedRun.tagName).toBe('w:r');
        const insertedRunChildren = childElements(insertedRun);
        expect(insertedRunChildren.some((c) => c.tagName === 'w:rPr')).toBe(true);
      });

      await and('the w:delText contains only the atom fragment text', () => {
        assertDefined(result, 'result');
        const insertedRun = childElements(result)[0]!;
        const insertedRunChildren = childElements(insertedRun);
        const delText = insertedRunChildren.find((c) => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('deleted token');
        expect(delText.textContent).not.toContain('prefix and');
      });
    });

    test('should insert at beginning if insertAfterRun is null', async ({ given, when, then }: AllureBddContext) => {
      let targetP: Element;
      let deletedAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom and a target paragraph with no insertion anchor', () => {
        const originalR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted')]);
        el('w:p', {}, [originalR]); // parent needed for DOM tree structure

        const existingR = el('w:r');
        targetP = el('w:p', {}, [existingR]);

        deletedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: originalR,
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called with null insertAfterRun', () => {
        result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);
      });

      await then('the deleted run is inserted at the beginning of the paragraph', () => {
        expect(result).not.toBeNull();
        // Should be at the beginning
        const targetChildren = childElements(targetP);
        expect(targetChildren[0]).toBe(result);
      });
    });

    test('should insert after pPr if present and insertAfterRun is null', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, existingR: Element, targetP: Element;
      let deletedAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a target paragraph with a pPr and an existing run', () => {
        const originalR = el('w:r');
        el('w:p', {}, [originalR]); // parent needed for DOM tree structure

        pPr = el('w:pPr');
        existingR = el('w:r');
        targetP = el('w:p', {}, [pPr, existingR]);

        deletedAtom = createMockAtom({
          sourceRunElement: originalR,
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called with null insertAfterRun', () => {
        result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);
      });

      await then('the deleted run is inserted after pPr but before the existing run', () => {
        expect(result).not.toBeNull();
        // Order should be: pPr, del, existingR
        const targetChildren = childElements(targetP);
        expect(targetChildren[0]).toBe(pPr);
        expect(targetChildren[1]).toBe(result);
        expect(targetChildren[2]).toBe(existingR);
      });
    });

    test('clones adjacent source bookmark markers once when the source run is split into multiple atoms', async ({ given, when, then }: AllureBddContext) => {
      let existingR: Element, targetP: Element;
      let firstAtom: ComparisonUnitAtom, secondAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let firstInsert: Element | null, secondInsert: Element | null;

      await given('a source run with adjacent bookmark markers split into two atoms', () => {
        const sourceStart = el('w:bookmarkStart', {
          'w:id': '10',
          'w:name': '_RefSplitDeleted',
        });
        const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'deleted text')]);
        const sourceEnd = el('w:bookmarkEnd', { 'w:id': '10' });
        const sourceP = el('w:p', {}, [sourceStart, sourceRun, sourceEnd]);

        existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
        targetP = el('w:p', {}, [existingR]);

        firstAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: sourceRun,
          sourceParagraphElement: sourceP,
          contentElement: el('w:t', {}, undefined, 'deleted'),
        });
        secondAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: sourceRun,
          sourceParagraphElement: sourceP,
          contentElement: el('w:t', {}, undefined, ' text'),
        });

        state = createRevisionIdState();
      });

      await when('both atoms are inserted sequentially', () => {
        firstInsert = insertDeletedRun(firstAtom, existingR, targetP, author, dateStr, state);
        secondInsert = insertDeletedRun(secondAtom, firstInsert, targetP, author, dateStr, state);
      });

      await then('bookmark markers are cloned exactly once in the target paragraph', () => {
        expect(firstInsert).not.toBeNull();
        expect(secondInsert).not.toBeNull();

        const bookmarkStarts = findAllByTagName(targetP, 'w:bookmarkStart');
        const bookmarkEnds = findAllByTagName(targetP, 'w:bookmarkEnd');
        const startNames = bookmarkStarts.map((c) => c.getAttribute('w:name'));

        expect(bookmarkStarts).toHaveLength(1);
        expect(bookmarkEnds).toHaveLength(1);
        expect(startNames).toContain('_RefSplitDeleted');
      });
    });
  });

  describe('insertMoveFromRun', () => {
    test('clones adjacent source bookmark markers once when source run is split', async ({ given, when, then }: AllureBddContext) => {
      let existingR: Element, targetP: Element;
      let firstAtom: ComparisonUnitAtom, secondAtom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let firstInsert: Element | null, secondInsert: Element | null;

      await given('a moved source run with adjacent bookmark markers split into two atoms', () => {
        const sourceStart = el('w:bookmarkStart', {
          'w:id': '11',
          'w:name': '_RefSplitMove',
        });
        const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved text')]);
        const sourceEnd = el('w:bookmarkEnd', { 'w:id': '11' });
        const sourceP = el('w:p', {}, [sourceStart, sourceRun, sourceEnd]);

        existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
        targetP = el('w:p', {}, [existingR]);

        firstAtom = createMockAtom({
          correlationStatus: CorrelationStatus.MovedSource,
          sourceRunElement: sourceRun,
          sourceParagraphElement: sourceP,
          contentElement: el('w:t', {}, undefined, 'moved'),
          moveName: 'move-split',
        });
        secondAtom = createMockAtom({
          correlationStatus: CorrelationStatus.MovedSource,
          sourceRunElement: sourceRun,
          sourceParagraphElement: sourceP,
          contentElement: el('w:t', {}, undefined, ' text'),
          moveName: 'move-split',
        });

        state = createRevisionIdState();
      });

      await when('both atoms are inserted sequentially via insertMoveFromRun', () => {
        firstInsert = insertMoveFromRun(
          firstAtom,
          'move-split',
          existingR,
          targetP,
          author,
          dateStr,
          state
        );
        secondInsert = insertMoveFromRun(
          secondAtom,
          'move-split',
          firstInsert,
          targetP,
          author,
          dateStr,
          state
        );
      });

      await then('bookmark markers are cloned exactly once in the target paragraph', () => {
        expect(firstInsert).not.toBeNull();
        expect(secondInsert).not.toBeNull();

        const bookmarkStarts = findAllByTagName(targetP, 'w:bookmarkStart');
        const bookmarkEnds = findAllByTagName(targetP, 'w:bookmarkEnd');
        const startNames = bookmarkStarts.map((c) => c.getAttribute('w:name'));

        expect(bookmarkStarts).toHaveLength(1);
        expect(bookmarkEnds).toHaveLength(1);
        expect(startNames).toContain('_RefSplitMove');
      });
    });
  });

  describe('wrapAsMoveFrom', () => {
    test('should wrap with moveFrom and add range markers', async ({ given, when, then }: AllureBddContext) => {
      let r: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run element with text in a paragraph', () => {
        const t = el('w:t', {}, undefined, 'moved text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsMoveFrom is called', () => {
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await then('the result is true and the paragraph has three children in order', () => {
        expect(result).toBe(true);
        // Order: moveFromRangeStart, moveFrom (with r), moveFromRangeEnd
        const pChildren = childElements(p);
        expect(pChildren).toHaveLength(3);
        const rangeStart = pChildren[0];
        assertDefined(rangeStart, 'p children[0]');
        expect(rangeStart.tagName).toBe('w:moveFromRangeStart');
        expect(rangeStart.getAttribute('w:name')).toBe('move1');
        const moveFrom = pChildren[1];
        assertDefined(moveFrom, 'p children[1]');
        expect(moveFrom.tagName).toBe('w:moveFrom');
        const moveFromChildren = childElements(moveFrom);
        expect(moveFromChildren[0]).toBe(r);
        const rangeEnd = pChildren[2];
        assertDefined(rangeEnd, 'p children[2]');
        expect(rangeEnd.tagName).toBe('w:moveFromRangeEnd');
      });
    });

    test('should convert w:t to w:delText for moved-from content', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with a w:t element', () => {
        const t = el('w:t', {}, undefined, 'moved');
        r = el('w:r', {}, [t]);
        el('w:p', {}, [r]); // parent needed for DOM tree structure
        state = createRevisionIdState();
      });

      await when('wrapAsMoveFrom is called', () => {
        wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await then('the w:t is replaced by w:delText with the original content', () => {
        // After conversion, the original w:t is replaced. Find delText in the run.
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('moved');
      });
    });

    test('should use same range ID for same move name', async ({ given, when, then }: AllureBddContext) => {
      let p: Element;
      let r1: Element, r2: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('two runs in a paragraph', () => {
        r1 = el('w:r');
        r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);
        state = createRevisionIdState();
      });

      await when('one run is wrapped as moveFrom and the other as moveTo with the same move name', () => {
        wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
        wrapAsMoveTo(r2, 'move1', author, dateStr, state);
      });

      await then('the source and dest range markers have distinct sequential IDs', () => {
        // Both should reference the same move range
        const pChildren = childElements(p);
        const rangeStart1 = pChildren[0];
        assertDefined(rangeStart1, 'p children[0]');
        const rangeStart2 = pChildren[3]; // After moveFromRangeEnd
        assertDefined(rangeStart2, 'p children[3]');
        expect(rangeStart1.getAttribute('w:id')).toBe('1'); // sourceRangeId
        expect(rangeStart2.getAttribute('w:id')).toBe('2'); // destRangeId
      });
    });
  });

  describe('wrapAsMoveTo', () => {
    test('should wrap with moveTo and add range markers', async ({ given, when, then }: AllureBddContext) => {
      let r: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run element with text in a paragraph', () => {
        const t = el('w:t', {}, undefined, 'moved text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsMoveTo is called', () => {
        result = wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await then('the paragraph has three children: range start, moveTo wrapper, range end', () => {
        expect(result).toBe(true);
        const pChildren = childElements(p);
        expect(pChildren).toHaveLength(3);
        const moveToStart = pChildren[0];
        assertDefined(moveToStart, 'p children[0]');
        expect(moveToStart.tagName).toBe('w:moveToRangeStart');
        const moveTo = pChildren[1];
        assertDefined(moveTo, 'p children[1]');
        expect(moveTo.tagName).toBe('w:moveTo');
        const moveToEnd = pChildren[2];
        assertDefined(moveToEnd, 'p children[2]');
        expect(moveToEnd.tagName).toBe('w:moveToRangeEnd');
      });
    });

    test('should not convert w:t to w:delText for moved-to content', async ({ given, when, then }: AllureBddContext) => {
      let t: Element, r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with a w:t element', () => {
        t = el('w:t', {}, undefined, 'moved');
        r = el('w:r', {}, [t]);
        el('w:p', {}, [r]); // parent needed for DOM tree structure
        state = createRevisionIdState();
      });

      await when('wrapAsMoveTo is called', () => {
        wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await then('the w:t element retains its original tag name', () => {
        // moveTo content keeps w:t
        expect(t.tagName).toBe('w:t');
      });
    });
  });

  describe('addFormatChange', () => {
    test('should add rPrChange to existing rPr', async ({ given, when, then, and }: AllureBddContext) => {
      let rPr: Element, r: Element;
      let oldRPr: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with bold+italic formatting and old run properties with only bold', () => {
        rPr = el('w:rPr', {}, [
          el('w:b'),
          el('w:i'),
        ]);
        const t = el('w:t', {}, undefined, 'formatted');
        r = el('w:r', {}, [rPr, t]);

        oldRPr = el('w:rPr', {}, [
          el('w:b'),
        ]);

        state = createRevisionIdState();
      });

      await when('addFormatChange is called', () => {
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await then('rPrChange is added to the existing rPr with the correct author', () => {
        // rPr should now contain rPrChange
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        expect(rPrChange.getAttribute('w:author')).toBe(author);
      });

      await and('the old properties are wrapped in a w:rPr inside rPrChange per OOXML spec', () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange')!;
        // Old properties should be wrapped in a w:rPr inside rPrChange (OOXML spec)
        const rPrChangeChildren = childElements(rPrChange);
        expect(rPrChangeChildren).toHaveLength(1);
        const innerRPr = rPrChangeChildren[0];
        assertDefined(innerRPr, 'rPrChange w:rPr wrapper');
        expect(innerRPr.tagName).toBe('w:rPr');
        const innerChildren = childElements(innerRPr);
        expect(innerChildren).toHaveLength(1);
        expect(innerChildren[0]!.tagName).toBe('w:b');
      });
    });

    test('should create rPr if it does not exist', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with no rPr element', () => {
        const t = el('w:t', {}, undefined, 'text');
        r = el('w:r', {}, [t]);
        state = createRevisionIdState();
      });

      await when('addFormatChange is called with old run properties', () => {
        const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await then('a new rPr is created containing a rPrChange', () => {
        // rPr should be created
        const rChildren = childElements(r);
        const createdRPr = rChildren[0];
        assertDefined(createdRPr, 'r children[0]');
        expect(createdRPr.tagName).toBe('w:rPr');
        const createdRPrChildren = childElements(createdRPr);
        const rPrChange = createdRPrChildren.find(c => c.tagName === 'w:rPrChange');
        expect(rPrChange).toBeDefined();
      });
    });
  });

  describe('wrapParagraphAsInserted', () => {
    test('should add PPR-INS marker for empty paragraphs (no runs) so reject-all removes them', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('an empty paragraph with only a pPr element', () => {
        pPr = el('w:pPr');
        p = el('w:p', {}, [pPr]);
        el('w:body', {}, [p]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsInserted is called', () => {
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await then('a PPR-INS marker is added to pPr/rPr', () => {
        expect(result).toBe(true);

        // PPR-INS marker should be added for empty paragraphs
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        expect(rPr).toBeDefined();
        const insMarker = childElements(rPr!).find((c) => c.tagName === 'w:ins');
        expect(insMarker).toBeDefined();
      });
    });

    test('should add PPR-INS marker for paragraphs with only empty w:r shells (no visible content)', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a paragraph with a run that has only an rPr and no text', () => {
        pPr = el('w:pPr');
        const emptyRun = el('w:r', {}, [el('w:rPr')]); // run with only rPr, no text
        p = el('w:p', {}, [pPr, emptyRun]);
        el('w:body', {}, [p]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsInserted is called', () => {
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await then('a PPR-INS marker is added because the run has no visible content', () => {
        expect(result).toBe(true);

        // PPR-INS marker should be added because the run has no visible content
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        expect(rPr).toBeDefined();
        const insMarker = childElements(rPr!).find((c) => c.tagName === 'w:ins');
        expect(insMarker).toBeDefined();
      });
    });

    test('should be a no-op for paragraphs with substantive runs (Google Docs compat)', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a paragraph with a run containing a w:t element', () => {
        pPr = el('w:pPr');
        const run = el('w:r', {}, [el('w:t')]); // run with visible content
        p = el('w:p', {}, [pPr, run]);
        el('w:body', {}, [p]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsInserted is called', () => {
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await then('no PPR-INS marker is added — runs with visible content are wrapped by w:ins', () => {
        expect(result).toBe(true);

        // No PPR-INS marker — runs with visible content already wrapped by w:ins
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        expect(rPr).toBeUndefined();
      });
    });
  });

  describe('addParagraphPropertyChange', () => {
    test('should create pPrChange with correct attributes', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with spacing properties', () => {
        pPr = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('a pPrChange element with id, author and date attributes is added', () => {
        const pPrChildren = childElements(pPr);
        const pPrChange = pPrChildren.find((c) => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        expect(pPrChange.getAttribute('w:id')).toBe('1');
        expect(pPrChange.getAttribute('w:author')).toBe(author);
        expect(pPrChange.getAttribute('w:date')).toBe(dateStr);
      });
    });

    test('should clone pPr content as snapshot', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with spacing and indentation properties', () => {
        const spacing = el('w:spacing', { 'w:after': '200' });
        const ind = el('w:ind', { 'w:left': '720' });
        pPr = el('w:pPr', {}, [spacing, ind]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('the pPrChange inner pPr snapshot contains spacing and indentation', () => {
        const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr');
        assertDefined(innerPPr, 'inner pPr');
        const innerChildren = childElements(innerPPr);
        expect(innerChildren).toHaveLength(2);
        expect(innerChildren[0]!.tagName).toBe('w:spacing');
        expect(innerChildren[0]!.getAttribute('w:after')).toBe('200');
        expect(innerChildren[1]!.tagName).toBe('w:ind');
        expect(innerChildren[1]!.getAttribute('w:left')).toBe('720');
      });
    });

    test('should exclude rPr, sectPr, pPrChange from snapshot (CT_PPrBase)', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with spacing, rPr, and sectPr in pPr', () => {
        const spacing = el('w:spacing', { 'w:after': '200' });
        const rPr = el('w:rPr', {}, [el('w:b')]);
        const sectPr = el('w:sectPr');
        pPr = el('w:pPr', {}, [spacing, rPr, sectPr]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('the snapshot only contains spacing — rPr and sectPr are excluded', () => {
        const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr');
        assertDefined(innerPPr, 'inner pPr');
        const innerChildren = childElements(innerPPr);
        // Only spacing should be cloned; rPr and sectPr excluded
        expect(innerChildren).toHaveLength(1);
        expect(innerChildren[0]!.tagName).toBe('w:spacing');
      });
    });

    test('should be idempotent (second call is a no-op)', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with spacing properties', () => {
        pPr = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called twice', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('only one pPrChange is present and no extra revision ID was allocated', () => {
        const pPrChanges = childElements(pPr).filter((c) => c.tagName === 'w:pPrChange');
        expect(pPrChanges).toHaveLength(1);
        // Second call should not have allocated another ID
        expect(state.nextId).toBe(2);
      });
    });

    test('should create pPr if paragraph has none', async ({ given, when, then }: AllureBddContext) => {
      let p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with no pPr element', () => {
        p = el('w:p');
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('a pPr is created with an empty pPrChange snapshot', () => {
        const pChildren = childElements(p);
        const pPr = pChildren.find((c) => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        // Inner pPr should be empty since there were no original properties
        const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr');
        assertDefined(innerPPr, 'inner pPr');
        expect(childElements(innerPPr)).toHaveLength(0);
      });
    });
  });

  describe('wrapParagraphAsDeleted', () => {
    test('should add a paragraph-mark w:del marker in w:pPr/w:rPr (not wrap <w:p>)', async ({ given, when, then, and }: AllureBddContext) => {
      let p: Element, body: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('an empty paragraph in a body element', () => {
        p = el('w:p');
        body = el('w:body', {}, [p]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsDeleted is called', () => {
        result = wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await then('the result is true and the paragraph element is not replaced in the body', () => {
        expect(result).toBe(true);
        const bodyChildren = childElements(body);
        const bodyFirst = bodyChildren[0];
        assertDefined(bodyFirst, 'body children[0]');
        expect(bodyFirst.tagName).toBe('w:p');
      });

      await and('a w:del marker with author and date is added inside pPr/rPr', () => {
        const pChildren = childElements(p);
        const pPr = pChildren.find((c) => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        assertDefined(rPr, 'rPr');
        const rPrChildren = childElements(rPr);
        const marker = rPrChildren.find((c) => c.tagName === 'w:del');
        assertDefined(marker, 'marker');
        expect(marker.getAttribute('w:author')).toBe(author);
        expect(marker.getAttribute('w:date')).toBe(dateStr);
      });
    });

    test('should reuse existing pPr and rPr when present', async ({ given, when, then }: AllureBddContext) => {
      let existingRPr: Element, existingPPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph with an existing pPr containing an rPr with bold formatting', () => {
        existingRPr = el('w:rPr', {}, [el('w:b')]);
        existingPPr = el('w:pPr', {}, [existingRPr]);
        p = el('w:p', {}, [existingPPr]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsDeleted is called', () => {
        wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await then('the existing pPr and rPr are reused and the del marker is added alongside the existing bold', () => {
        // Should use the existing pPr
        const pPr = childElements(p).find((c) => c.tagName === 'w:pPr');
        expect(pPr).toBe(existingPPr);
        // rPr should still contain w:b plus the new w:del marker
        const rPr = childElements(pPr!).find((c) => c.tagName === 'w:rPr');
        expect(rPr).toBe(existingRPr);
        const rPrChildren = childElements(rPr!);
        expect(rPrChildren.some((c) => c.tagName === 'w:del')).toBe(true);
        expect(rPrChildren.some((c) => c.tagName === 'w:b')).toBe(true);
      });
    });

    test('should not add duplicate marker on second call', async ({ given, when, then }: AllureBddContext) => {
      let p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph wrapped as deleted once', () => {
        p = el('w:p');
        el('w:body', {}, [p]);
        state = createRevisionIdState();
        wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await when('wrapParagraphAsDeleted is called again', () => {
        wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await then('only one w:del marker exists in pPr/rPr', () => {
        const pPr = childElements(p).find((c) => c.tagName === 'w:pPr')!;
        const rPr = childElements(pPr).find((c) => c.tagName === 'w:rPr')!;
        const markers = childElements(rPr).filter((c) => c.tagName === 'w:del');
        expect(markers).toHaveLength(1);
      });
    });

    test('should insert rPr before sectPr in pPr', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph whose pPr contains spacing and a sectPr', () => {
        const sectPr = el('w:sectPr');
        pPr = el('w:pPr', {}, [el('w:spacing'), sectPr]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('wrapParagraphAsDeleted is called', () => {
        wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await then('the rPr is positioned before sectPr in pPr', () => {
        const pPrChildren = childElements(pPr);
        const rPrIdx = pPrChildren.findIndex((c) => c.tagName === 'w:rPr');
        const sectPrIdx = pPrChildren.findIndex((c) => c.tagName === 'w:sectPr');
        expect(rPrIdx).toBeLessThan(sectPrIdx);
      });
    });
  });

  // ── Branch coverage: wrap with no parent ──────────────────────────

  describe('wrapAsInserted — no parent', () => {
    test('returns false for detached run (no parentNode)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run with no parent element', () => {
        r = el('w:r'); // no parent
        state = createRevisionIdState();
      });

      await when('wrapAsInserted is called', () => {
        result = wrapAsInserted(r, author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });
  });

  describe('wrapAsDeleted — no parent', () => {
    test('returns false for detached run (no parentNode)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run with no parent element', () => {
        r = el('w:r'); // no parent
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        result = wrapAsDeleted(r, author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });
  });

  describe('wrapAsMoveFrom — no parent', () => {
    test('returns false for detached run', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run with no parent element', () => {
        r = el('w:r');
        state = createRevisionIdState();
      });

      await when('wrapAsMoveFrom is called', () => {
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });

    test('returns false for already wrapped run', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run already wrapped with moveFrom', () => {
        r = el('w:r');
        el('w:p', {}, [r]);
        state = createRevisionIdState();
        wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await when('wrapAsMoveFrom is called again on the same run', () => {
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });
  });

  describe('wrapAsMoveTo — no parent', () => {
    test('returns false for detached run', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: boolean;

      await given('a run with no parent element', () => {
        r = el('w:r');
        state = createRevisionIdState();
      });

      await when('wrapAsMoveTo is called', () => {
        result = wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });
  });

  // ── Branch coverage: convertToDelText with attributes ─────────────

  describe('wrapAsDeleted — convertToDelText edge cases', () => {
    test('preserves xml:space attribute on converted delText', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with a w:t element that has xml:space="preserve" and leading/trailing spaces', () => {
        const t = el('w:t', { 'xml:space': 'preserve' }, undefined, '  spaced  ');
        r = el('w:r', {}, [t]);
        el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        wrapAsDeleted(r, author, dateStr, state);
      });

      await then('the converted w:delText retains the xml:space attribute and original text', () => {
        const delText = childElements(r).find((c) => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.getAttribute('xml:space')).toBe('preserve');
        expect(delText.textContent).toBe('  spaced  ');
      });
    });

    test('handles run with multiple w:t elements', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with two w:t elements', () => {
        const t1 = el('w:t', {}, undefined, 'first');
        const t2 = el('w:t', {}, undefined, 'second');
        r = el('w:r', {}, [t1, t2]);
        el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        wrapAsDeleted(r, author, dateStr, state);
      });

      await then('both w:t elements are converted to w:delText', () => {
        const rChildren = childElements(r);
        const delTexts = rChildren.filter((c) => c.tagName === 'w:delText');
        expect(delTexts).toHaveLength(2);
        expect(delTexts[0]!.textContent).toBe('first');
        expect(delTexts[1]!.textContent).toBe('second');
      });
    });

    test('leaves non-w:t elements (tab, br) unchanged', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run containing a tab, a br, and a w:t element', () => {
        const tab = el('w:tab');
        const br = el('w:br');
        const t = el('w:t', {}, undefined, 'text');
        r = el('w:r', {}, [tab, br, t]);
        el('w:p', {}, [r]);
        state = createRevisionIdState();
      });

      await when('wrapAsDeleted is called', () => {
        wrapAsDeleted(r, author, dateStr, state);
      });

      await then('only w:t is converted to w:delText; w:tab and w:br are unchanged', () => {
        const rChildren = childElements(r);
        expect(rChildren[0]!.tagName).toBe('w:tab');
        expect(rChildren[1]!.tagName).toBe('w:br');
        expect(rChildren[2]!.tagName).toBe('w:delText');
      });
    });
  });

  // ── Branch coverage: insertDeletedRun — no sourceRunElement ───────

  describe('insertDeletedRun — edge cases', () => {
    test('returns null when atom has no sourceRunElement', async ({ given, when, then }: AllureBddContext) => {
      let targetP: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom with no sourceRunElement', () => {
        targetP = el('w:p', {}, [el('w:r')]);
        atom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: undefined,
        });
        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called', () => {
        result = insertDeletedRun(atom, null, targetP, author, dateStr, state);
      });

      await then('the result is null', () => {
        expect(result).toBeNull();
      });
    });

    test('handles collapsed field atoms by replaying field sequence', async ({ given, when, then, and }: AllureBddContext) => {
      let atom: ComparisonUnitAtom;
      let targetP: Element;
      let state: ReturnType<typeof createRevisionIdState>;
      let del: Element | null;

      await given('a deleted atom with a collapsed field sequence (HYPERLINK)', () => {
        const fldCharBegin = el('w:fldChar', { 'w:fldCharType': 'begin' });
        const instrText = el('w:instrText', {}, undefined, 'HYPERLINK');
        const fldCharSep = el('w:fldChar', { 'w:fldCharType': 'separate' });
        const result_t = el('w:t', {}, undefined, 'link text');
        const fldCharEnd = el('w:fldChar', { 'w:fldCharType': 'end' });

        const sourceRun = el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'original run text'),
        ]);
        el('w:p', {}, [sourceRun]);

        const fieldAtoms: ComparisonUnitAtom[] = [
          createMockAtom({ contentElement: fldCharBegin }),
          createMockAtom({ contentElement: instrText }),
          createMockAtom({ contentElement: fldCharSep }),
          createMockAtom({ contentElement: result_t }),
          createMockAtom({ contentElement: fldCharEnd }),
        ];

        atom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: sourceRun,
          contentElement: el('w:t', {}, undefined, 'link text'),
          collapsedFieldAtoms: fieldAtoms,
        });

        targetP = el('w:p', {}, [el('w:r')]);
        state = createRevisionIdState();
      });

      await when('insertDeletedRun is called', () => {
        del = insertDeletedRun(atom, null, targetP, author, dateStr, state);
      });

      await then('a w:del wrapper is returned', () => {
        assertDefined(del, 'del wrapper');
        expect(del.tagName).toBe('w:del');
      });

      await and('the cloned run contains the full field sequence rather than synthetic text', () => {
        assertDefined(del, 'del wrapper');
        // The cloned run should contain the field sequence, not the synthetic text
        const clonedRun = childElements(del)[0]!;
        const clonedRunChildren = childElements(clonedRun);
        // Should have rPr + 5 field elements (fldChar, instrText, etc.)
        expect(clonedRunChildren.length).toBeGreaterThanOrEqual(5);
      });
    });
  });

  // ── Branch coverage: insertMoveFromRun — edge cases ───────────────

  describe('insertMoveFromRun — edge cases', () => {
    test('returns null when atom has no sourceRunElement', async ({ given, when, then }: AllureBddContext) => {
      let targetP: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a moved-source atom with no sourceRunElement', () => {
        targetP = el('w:p', {}, [el('w:r')]);
        atom = createMockAtom({
          correlationStatus: CorrelationStatus.MovedSource,
          sourceRunElement: undefined,
        });
        state = createRevisionIdState();
      });

      await when('insertMoveFromRun is called', () => {
        result = insertMoveFromRun(atom, 'move1', null, targetP, author, dateStr, state);
      });

      await then('the result is null', () => {
        expect(result).toBeNull();
      });
    });

    test('inserts at beginning without pPr (reverse order)', async ({ given, when, then }: AllureBddContext) => {
      let existingR: Element, targetP: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a target paragraph with no pPr and a source run', () => {
        const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved')]);
        el('w:p', {}, [sourceRun]);

        existingR = el('w:r');
        targetP = el('w:p', {}, [existingR]);

        atom = createMockAtom({
          sourceRunElement: sourceRun,
          moveName: 'mv1',
        });

        state = createRevisionIdState();
      });

      await when('insertMoveFromRun is called with null insertAfterRun', () => {
        result = insertMoveFromRun(atom, 'mv1', null, targetP, author, dateStr, state);
      });

      await then('the move markers and content are inserted at the beginning before the existing run', () => {
        assertDefined(result, 'moveFrom element');
        // Order should be: rangeStart, moveFrom, rangeEnd, existingR
        const targetChildren = childElements(targetP);
        expect(targetChildren[0]!.tagName).toBe('w:moveFromRangeStart');
        expect(targetChildren[1]!.tagName).toBe('w:moveFrom');
        expect(targetChildren[2]!.tagName).toBe('w:moveFromRangeEnd');
        expect(targetChildren[3]).toBe(existingR);
      });
    });

    test('inserts after pPr if present and insertAfterRun is null', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, existingR: Element, targetP: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a target paragraph with a pPr element and a source run', () => {
        const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved')]);
        el('w:p', {}, [sourceRun]);

        pPr = el('w:pPr');
        existingR = el('w:r');
        targetP = el('w:p', {}, [pPr, existingR]);

        atom = createMockAtom({
          sourceRunElement: sourceRun,
        });

        state = createRevisionIdState();
      });

      await when('insertMoveFromRun is called with null insertAfterRun', () => {
        result = insertMoveFromRun(atom, 'mv1', null, targetP, author, dateStr, state);
      });

      await then('pPr is preserved first and move markers are inserted after it', () => {
        assertDefined(result, 'moveFrom element');
        const targetChildren = childElements(targetP);
        expect(targetChildren[0]).toBe(pPr);
        expect(targetChildren[1]!.tagName).toBe('w:moveFromRangeStart');
        expect(targetChildren[2]!.tagName).toBe('w:moveFrom');
        expect(targetChildren[3]!.tagName).toBe('w:moveFromRangeEnd');
        expect(targetChildren[4]).toBe(existingR);
      });
    });
  });

  // ── Branch coverage: insertDeletedParagraph ───────────────────────

  describe('insertDeletedParagraph', () => {
    test('returns null when atom has no sourceParagraphElement', async ({ given, when, then }: AllureBddContext) => {
      let body: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom with no sourceParagraphElement', () => {
        body = el('w:body', {}, [el('w:p')]);
        atom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceParagraphElement: undefined,
        });
        state = createRevisionIdState();
      });

      await when('insertDeletedParagraph is called', () => {
        result = insertDeletedParagraph(atom, null, body, author, dateStr, state);
      });

      await then('the result is null', () => {
        expect(result).toBeNull();
      });
    });

    test('clones and inserts deleted paragraph after reference paragraph', async ({ given, when, then, and }: AllureBddContext) => {
      let existingP: Element, body: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom with a source paragraph and a body with an existing paragraph', () => {
        const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted text')]);
        const sourceP = el('w:p', {}, [sourceR]);

        existingP = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'existing')])]);
        body = el('w:body', {}, [existingP]);

        atom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceParagraphElement: sourceP,
          sourceRunElement: sourceR,
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedParagraph is called after the existing paragraph', () => {
        result = insertDeletedParagraph(atom, existingP, body, author, dateStr, state);
      });

      await then('the cloned paragraph is inserted after the reference paragraph', () => {
        assertDefined(result, 'inserted paragraph');
        expect(result.tagName).toBe('w:p');
        const bodyChildren = childElements(body);
        expect(bodyChildren).toHaveLength(2);
        expect(bodyChildren[0]).toBe(existingP);
        expect(bodyChildren[1]).toBe(result);
      });

      await and('the cloned paragraph runs are wrapped with w:del', () => {
        assertDefined(result, 'inserted paragraph');
        // Runs should be wrapped with w:del
        const delWrappers = findAllByTagName(result, 'w:del');
        expect(delWrappers.length).toBeGreaterThan(0);
      });
    });

    test('inserts at body start when insertAfterParagraph is null', async ({ given, when, then }: AllureBddContext) => {
      let existingP: Element, body: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a deleted atom with a source paragraph and a body with one existing paragraph', () => {
        const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted')]);
        const sourceP = el('w:p', {}, [sourceR]);

        existingP = el('w:p');
        body = el('w:body', {}, [existingP]);

        atom = createMockAtom({
          sourceParagraphElement: sourceP,
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedParagraph is called with null insertAfterParagraph', () => {
        result = insertDeletedParagraph(atom, null, body, author, dateStr, state);
      });

      await then('the cloned paragraph is inserted at the start of the body', () => {
        assertDefined(result, 'inserted paragraph');
        const bodyChildren = childElements(body);
        expect(bodyChildren[0]).toBe(result);
        expect(bodyChildren[1]).toBe(existingP);
      });
    });

    test('wraps cloned runs with w:del and converts w:t to w:delText', async ({ given, when, then }: AllureBddContext) => {
      let body: Element;
      let atom: ComparisonUnitAtom;
      let state: ReturnType<typeof createRevisionIdState>;
      let result: Element | null;

      await given('a source paragraph with a run containing text', () => {
        const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
        const sourceP = el('w:p', {}, [el('w:pPr'), sourceR]);
        body = el('w:body');

        atom = createMockAtom({
          sourceParagraphElement: sourceP,
        });

        state = createRevisionIdState();
      });

      await when('insertDeletedParagraph is called', () => {
        result = insertDeletedParagraph(atom, null, body, author, dateStr, state);
      });

      await then('the cloned run text is converted to w:delText inside a w:del wrapper', () => {
        assertDefined(result, 'inserted paragraph');
        const delWrapper = findAllByTagName(result, 'w:del')[0];
        assertDefined(delWrapper, 'del wrapper');
        const clonedRun = childElements(delWrapper).find((c) => c.tagName === 'w:r');
        assertDefined(clonedRun, 'cloned run');
        const delText = childElements(clonedRun).find((c) => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('hello');
      });
    });
  });

  // ── Branch coverage: addFormatChange — null oldRunProperties ──────

  describe('addFormatChange — edge cases', () => {
    test('handles null oldRunProperties (no inner rPr in rPrChange)', async ({ given, when, then }: AllureBddContext) => {
      let rPr: Element, r: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with an rPr containing bold and a text element', () => {
        rPr = el('w:rPr', {}, [el('w:b')]);
        r = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'text')]);
        state = createRevisionIdState();
      });

      await when('addFormatChange is called with null oldRunProperties', () => {
        addFormatChange(r, null, author, dateStr, state);
      });

      await then('rPrChange is added with no inner rPr wrapper', () => {
        const rPrChange = childElements(rPr).find((c) => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        // No inner w:rPr wrapper when oldRunProperties is null
        const innerChildren = childElements(rPrChange);
        expect(innerChildren).toHaveLength(0);
      });
    });

    test('handles multiple properties in oldRunProperties', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let oldRPr: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a run with no rPr and an old rPr with bold, italic, and font size', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
        oldRPr = el('w:rPr', {}, [
          el('w:b'),
          el('w:i'),
          el('w:sz', { 'w:val': '24' }),
        ]);
        state = createRevisionIdState();
      });

      await when('addFormatChange is called with the old rPr', () => {
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await then('the inner rPr in rPrChange contains all three old properties', () => {
        const createdRPr = childElements(r).find((c) => c.tagName === 'w:rPr')!;
        const rPrChange = childElements(createdRPr).find((c) => c.tagName === 'w:rPrChange')!;
        const innerRPr = childElements(rPrChange).find((c) => c.tagName === 'w:rPr')!;
        expect(childElements(innerRPr)).toHaveLength(3);
      });
    });
  });

  // ── Branch coverage: preSplitMixedStatusRuns ──────────────────────

  describe('preSplitMixedStatusRuns', () => {
    test('is a no-op for empty atom list', async ({ given, when, then }: AllureBddContext) => {
      await given('an empty atom list', () => {});

      await when('preSplitMixedStatusRuns is called', () => {
        // Should not throw
        preSplitMixedStatusRuns([]);
      });

      await then('no error is thrown', () => {});
    });

    test('skips atoms with no sourceRunElement', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];

      await given('an inserted atom with no sourceRunElement', () => {
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: undefined,
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        // Should not throw or modify anything
        preSplitMixedStatusRuns(atoms);
      });

      await then('no error is thrown and atoms are unchanged', () => {});
    });

    test('skips Deleted atoms (original-tree, not revised)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('a deleted atom referencing a run in the original tree', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Deleted,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'text'),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('the run remains intact (not split)', () => {
        // Run should remain intact
        expect(childElements(r).some((c) => c.tagName === 'w:t')).toBe(true);
      });
    });

    test('skips MovedSource atoms', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('a moved-source atom referencing a run', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.MovedSource,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'text'),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('the run remains intact (not split)', () => {
        expect(childElements(r).some((c) => c.tagName === 'w:t')).toBe(true);
      });
    });

    test('skips atoms with collapsedFieldAtoms', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('an inserted atom with collapsed field atoms', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'field')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            collapsedFieldAtoms: [createMockAtom()],
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('no error is thrown', () => {});
    });

    test('skips atoms with field character content elements', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('an inserted atom whose content element is a fldChar', () => {
        r = el('w:r', {}, [el('w:fldChar')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            contentElement: el('w:fldChar', { 'w:fldCharType': 'begin' }),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('no error is thrown', () => {});
    });

    test('skips single-status run groups (no split needed)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('two inserted atoms referencing the same run', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'hello world')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'hello'),
          }),
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, ' world'),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('the run is not split since all atoms share the same status', () => {
        // Should not split — run has single status
        const p = r.parentNode as Element;
        expect(childElements(p).filter((c) => c.tagName === 'w:r')).toHaveLength(1);
      });
    });

    test('splits run with mixed statuses into fragments', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let equalAtom: ComparisonUnitAtom, insertedAtom: ComparisonUnitAtom;

      await given('an equal atom and an inserted atom both referencing the same run', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'helloworld')]);
        el('w:p', {}, [r]);

        equalAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: r,
          contentElement: el('w:t', {}, undefined, 'hello'),
        });
        insertedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Inserted,
          sourceRunElement: r,
          contentElement: el('w:t', {}, undefined, 'world'),
        });
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns([equalAtom, insertedAtom]);
      });

      await then('atoms now point to different run fragments', () => {
        // Atoms should now point to different run fragments
        expect(equalAtom.sourceRunElement).not.toBe(insertedAtom.sourceRunElement);
        // Both should still be w:r elements
        expect(equalAtom.sourceRunElement!.tagName).toBe('w:r');
        expect(insertedAtom.sourceRunElement!.tagName).toBe('w:r');
      });
    });

    test('skips detached runs (no parentNode)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('equal and inserted atoms referencing a detached run', () => {
        r = el('w:r', {}, [el('w:t', {}, undefined, 'ab')]);
        // r has no parent — detached
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'a'),
          }),
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'b'),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('no crash occurs and atoms remain unchanged', () => {
        // Should not crash, atoms stay unchanged
        expect(atoms[0]!.sourceRunElement).toBe(r);
      });
    });

    test('skips when sumAtomLengths exceeds run visible length (cross-run)', async ({ given, when, then }: AllureBddContext) => {
      let r: Element;
      let atoms: ComparisonUnitAtom[];

      await given('atoms whose combined length exceeds the run visible length', () => {
        // Run has 3 visible chars but atoms claim 5
        r = el('w:r', {}, [el('w:t', {}, undefined, 'abc')]);
        el('w:p', {}, [r]);
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'abc'),
          }),
          createMockAtom({
            correlationStatus: CorrelationStatus.Inserted,
            sourceRunElement: r,
            contentElement: el('w:t', {}, undefined, 'de'),
          }),
        ];
      });

      await when('preSplitMixedStatusRuns is called', () => {
        preSplitMixedStatusRuns(atoms);
      });

      await then('the run is not split due to cross-run safety check', () => {
        // Should not split — cross-run safety check
        expect(atoms[0]!.sourceRunElement).toBe(r);
        expect(atoms[1]!.sourceRunElement).toBe(r);
      });
    });
  });

  // ── Branch coverage: wrapAsMoveTo — linked range IDs ──────────────

  describe('wrapAsMoveTo — linked range IDs', () => {
    test('allocates separate sourceRangeId and destRangeId for same move name', async ({ given, when, then }: AllureBddContext) => {
      let r1: Element, r2: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('two runs in separate paragraphs sharing the same move name', () => {
        r1 = el('w:r', {}, [el('w:t', {}, undefined, 'from')]);
        r2 = el('w:r', {}, [el('w:t', {}, undefined, 'to')]);
        el('w:p', {}, [r1]);
        el('w:p', {}, [r2]);
        state = createRevisionIdState();
      });

      await when('wrapAsMoveFrom and wrapAsMoveTo are called with the same move name', () => {
        wrapAsMoveFrom(r1, 'linked', author, dateStr, state);
        wrapAsMoveTo(r2, 'linked', author, dateStr, state);
      });

      await then('source and destination use separate but linked range IDs', () => {
        // r1's parent should be moveFrom, grandparent is p
        const p1 = r1.parentNode!.parentNode as Element;
        const p2 = r2.parentNode!.parentNode as Element;
        const rangeStart1 = childElements(p1).find((c) => c.tagName === 'w:moveFromRangeStart')!;
        const rangeStart2 = childElements(p2).find((c) => c.tagName === 'w:moveToRangeStart')!;

        // Source and dest use the SAME linked IDs
        expect(rangeStart1.getAttribute('w:id')).toBe('1'); // sourceRangeId
        expect(rangeStart2.getAttribute('w:id')).toBe('2'); // destRangeId
      });
    });

    test('allocates different IDs for different move names', async ({ given, when, then }: AllureBddContext) => {
      let r1: Element, r2: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('two runs each with a different move name', () => {
        r1 = el('w:r');
        r2 = el('w:r');
        el('w:p', {}, [r1]);
        el('w:p', {}, [r2]);
        state = createRevisionIdState();
      });

      await when('wrapAsMoveFrom and wrapAsMoveTo are called with different move names', () => {
        wrapAsMoveFrom(r1, 'moveA', author, dateStr, state);
        wrapAsMoveTo(r2, 'moveB', author, dateStr, state);
      });

      await then('each move gets its own independent ID pair', () => {
        // Different move names → different range ID pairs
        const p1 = r1.parentNode!.parentNode as Element;
        const p2 = r2.parentNode!.parentNode as Element;
        const rangeStart1 = childElements(p1).find((c) => c.tagName === 'w:moveFromRangeStart')!;
        const rangeStart2 = childElements(p2).find((c) => c.tagName === 'w:moveToRangeStart')!;

        // moveA uses IDs 1(src),2(dest),3(moveId); moveB uses IDs 4(src),5(dest),6(moveId)
        // moveFromRangeStart uses sourceRangeId, moveToRangeStart uses destRangeId
        expect(rangeStart1.getAttribute('w:id')).toBe('1');
        expect(rangeStart2.getAttribute('w:id')).toBe('5');
      });
    });
  });

  // ── Branch coverage: addParagraphPropertyChange with rPrChange ────

  describe('addParagraphPropertyChange — rPrChange excluded from snapshot', () => {
    test('excludes w:rPrChange from the snapshot when present in pPr', async ({ given, when, then }: AllureBddContext) => {
      let pPr: Element, p: Element;
      let state: ReturnType<typeof createRevisionIdState>;

      await given('a paragraph whose pPr contains both spacing and an rPrChange', () => {
        const rPrChange = el('w:rPrChange');
        const spacing = el('w:spacing', { 'w:after': '100' });
        pPr = el('w:pPr', {}, [spacing, rPrChange]);
        p = el('w:p', {}, [pPr]);
        state = createRevisionIdState();
      });

      await when('addParagraphPropertyChange is called', () => {
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await then('the pPrChange snapshot contains only spacing (rPrChange is excluded)', () => {
        const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange')!;
        const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr')!;
        const innerChildren = childElements(innerPPr);
        // Only spacing should be in the snapshot; rPrChange is excluded
        expect(innerChildren).toHaveLength(1);
        expect(innerChildren[0]!.tagName).toBe('w:spacing');
      });
    });
  });

  describe('groupDeletionsBeforeInsertions', () => {
    test('passes through equal-only atoms unchanged', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('two equal atoms', () => {
        atoms = [
          createMockAtom({ correlationStatus: CorrelationStatus.Equal }),
          createMockAtom({ correlationStatus: CorrelationStatus.Equal }),
        ];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('the result is unchanged with both atoms still equal', () => {
        expect(result).toHaveLength(2);
        expect(result[0]!.correlationStatus).toBe(CorrelationStatus.Equal);
        expect(result[1]!.correlationStatus).toBe(CorrelationStatus.Equal);
      });
    });

    test('groups alternating Deleted/Inserted: deletions first, then insertions', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('alternating deleted and inserted atoms', () => {
        atoms = [
          createMockAtom({ correlationStatus: CorrelationStatus.Deleted }),
          createMockAtom({ correlationStatus: CorrelationStatus.Inserted }),
          createMockAtom({ correlationStatus: CorrelationStatus.Deleted }),
          createMockAtom({ correlationStatus: CorrelationStatus.Inserted }),
        ];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('deletions appear first followed by insertions', () => {
        expect(result.map((a) => a.correlationStatus)).toEqual([
          CorrelationStatus.Deleted,
          CorrelationStatus.Deleted,
          CorrelationStatus.Inserted,
          CorrelationStatus.Inserted,
        ]);
      });
    });

    test('preserves Equal atoms between change blocks', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('a deletion, an equal atom, and an insertion', () => {
        atoms = [
          createMockAtom({ correlationStatus: CorrelationStatus.Deleted }),
          createMockAtom({ correlationStatus: CorrelationStatus.Equal }),
          createMockAtom({ correlationStatus: CorrelationStatus.Inserted }),
        ];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('the equal atom acts as a block boundary and order is preserved', () => {
        expect(result.map((a) => a.correlationStatus)).toEqual([
          CorrelationStatus.Deleted,
          CorrelationStatus.Equal,
          CorrelationStatus.Inserted,
        ]);
      });
    });

    test('groups MovedSource before MovedDestination', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('a moved-destination atom followed by a moved-source atom', () => {
        atoms = [
          createMockAtom({ correlationStatus: CorrelationStatus.MovedDestination }),
          createMockAtom({ correlationStatus: CorrelationStatus.MovedSource }),
        ];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('moved source appears before moved destination', () => {
        expect(result.map((a) => a.correlationStatus)).toEqual([
          CorrelationStatus.MovedSource,
          CorrelationStatus.MovedDestination,
        ]);
      });
    });

    test('handles empty array', async ({ given, when, then }: AllureBddContext) => {
      let result: ComparisonUnitAtom[];

      await given('an empty atom list', () => {});

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions([]);
      });

      await then('the result is an empty array', () => {
        expect(result).toEqual([]);
      });
    });

    test('handles single deletion atom', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('a single deleted atom', () => {
        atoms = [createMockAtom({ correlationStatus: CorrelationStatus.Deleted })];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('the result contains the single deletion unchanged', () => {
        expect(result).toHaveLength(1);
        expect(result[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
      });
    });

    test('handles FormatChanged as a block boundary', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];
      let result: ComparisonUnitAtom[];

      await given('a deletion, a format-changed atom, and an insertion', () => {
        atoms = [
          createMockAtom({ correlationStatus: CorrelationStatus.Deleted }),
          createMockAtom({ correlationStatus: CorrelationStatus.FormatChanged }),
          createMockAtom({ correlationStatus: CorrelationStatus.Inserted }),
        ];
      });

      await when('groupDeletionsBeforeInsertions is called', () => {
        result = groupDeletionsBeforeInsertions(atoms);
      });

      await then('FormatChanged acts as a block boundary and order is preserved', () => {
        expect(result.map((a) => a.correlationStatus)).toEqual([
          CorrelationStatus.Deleted,
          CorrelationStatus.FormatChanged,
          CorrelationStatus.Inserted,
        ]);
      });
    });
  });

  describe('preSplitInterleavedWordRuns', () => {
    test('is a no-op for empty atom list', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];

      await given('an empty atom list', () => {
        atoms = [];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('the atom list remains empty', () => {
        expect(atoms).toEqual([]);
      });
    });

    test('is a no-op when no interleaving exists (all atoms from different runs)', async ({ given, when, then }: AllureBddContext) => {
      let run1: Element, run2: Element;
      let atoms: ComparisonUnitAtom[];

      await given('two equal atoms each from a different run', () => {
        run1 = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
        run2 = el('w:r', {}, [el('w:t', {}, undefined, 'world')]);
        el('w:p', {}, [run1, run2]);

        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: run1,
            contentElement: el('w:t', {}, undefined, 'hello'),
          }),
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: run2,
            contentElement: el('w:t', {}, undefined, 'world'),
          }),
        ];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('atoms still reference their original runs unchanged', () => {
        // No split needed — atoms already from different runs
        expect(atoms[0]!.sourceRunElement).toBe(run1);
        expect(atoms[1]!.sourceRunElement).toBe(run2);
      });
    });

    test('skips atoms with no sourceRunElement', async ({ given, when, then }: AllureBddContext) => {
      let atoms: ComparisonUnitAtom[];

      await given('an equal atom with no sourceRunElement', () => {
        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: undefined,
          }),
        ];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('the atom list is unchanged', () => {
        expect(atoms).toHaveLength(1);
      });
    });

    test('skips Deleted atoms (original-tree)', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let atoms: ComparisonUnitAtom[];

      await given('two deleted atoms sharing the same run from the original tree', () => {
        run = el('w:r', {}, [el('w:t', {}, undefined, 'hello world')]);
        el('w:p', {}, [run]);

        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Deleted,
            sourceRunElement: run,
            contentElement: el('w:t', {}, undefined, 'hello'),
          }),
          createMockAtom({
            correlationStatus: CorrelationStatus.Deleted,
            sourceRunElement: run,
            contentElement: el('w:t', {}, undefined, 'world'),
          }),
        ];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('deleted atoms are not split since they are from the original tree', () => {
        // Deleted atoms are from original tree, not revised — no split
        expect(atoms[0]!.sourceRunElement).toBe(run);
        expect(atoms[1]!.sourceRunElement).toBe(run);
      });
    });

    test('splits run when Deleted atom interleaves between Equal atoms from same run', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let equalAtom1: ComparisonUnitAtom, equalAtom2: ComparisonUnitAtom;
      let atoms: ComparisonUnitAtom[];

      await given('two equal atoms from the same run with a deleted atom interleaved between them', () => {
        run = el('w:r', {}, [el('w:t', {}, undefined, 'helloworld')]);
        el('w:p', {}, [run]);

        equalAtom1 = createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: run,
          contentElement: el('w:t', {}, undefined, 'hello'),
        });
        const deletedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: el('w:r'), // from original tree
          contentElement: el('w:t', {}, undefined, 'DELETED'),
        });
        equalAtom2 = createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: run,
          contentElement: el('w:t', {}, undefined, 'world'),
        });

        atoms = [equalAtom1, deletedAtom, equalAtom2];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('the run is split so the two equal atoms point to different elements', () => {
        // The run should have been split — equalAtom1 and equalAtom2 now point to different elements
        expect(equalAtom1.sourceRunElement).not.toBe(equalAtom2.sourceRunElement);
      });
    });

    test('skips atoms with collapsedFieldAtoms', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let atoms: ComparisonUnitAtom[];

      await given('an equal atom with collapsed field atoms', () => {
        run = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
        el('w:p', {}, [run]);

        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: run,
            contentElement: el('w:t', {}, undefined, 'hello'),
            collapsedFieldAtoms: [createMockAtom()],
          }),
        ];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('the atom still references its original run', () => {
        expect(atoms[0]!.sourceRunElement).toBe(run);
      });
    });

    test('skips field character content elements', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let atoms: ComparisonUnitAtom[];

      await given('an equal atom whose content element is a fldChar', () => {
        run = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
        el('w:p', {}, [run]);

        atoms = [
          createMockAtom({
            correlationStatus: CorrelationStatus.Equal,
            sourceRunElement: run,
            contentElement: el('w:fldChar', { 'w:fldCharType': 'begin' }),
          }),
        ];
      });

      await when('preSplitInterleavedWordRuns is called', () => {
        preSplitInterleavedWordRuns(atoms);
      });

      await then('the atom still references its original run', () => {
        expect(atoms[0]!.sourceRunElement).toBe(run);
      });
    });
  });

  describe('suppressNoOpChangePairs', () => {
    test('unwraps adjacent w:del + w:ins with identical text and no rPr', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a paragraph with adjacent del and ins wrappers containing identical text and no rPr', () => {
        const delRun = el('w:r', {}, [el('w:delText', {}, undefined, 'Section ')]);
        const wDel = el('w:del', { 'w:author': 'Author', 'w:date': '2025-01-01T00:00:00Z' }, [delRun]);

        const insRun = el('w:r', {}, [el('w:t', {}, undefined, 'Section ')]);
        const wIns = el('w:ins', { 'w:author': 'Author', 'w:date': '2025-01-01T00:00:00Z' }, [insRun]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('the del/ins wrappers are removed and only the plain run remains', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(1);
        expect(pChildren[0]!.tagName).toBe('w:r');
      });
    });

    test('unwraps w:del + w:ins with identical text and identical rPr', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del and ins pair with identical bold formatting and text', () => {
        const delRun = el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:delText', {}, undefined, 'bold text'),
        ]);
        const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [delRun]);

        const insRun = el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:t', {}, undefined, 'bold text'),
        ]);
        const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [insRun]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('the wrappers are removed and only the plain run remains', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(1);
        expect(pChildren[0]!.tagName).toBe('w:r');
      });
    });

    test('preserves w:del + w:ins when text differs', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del/ins pair where the deleted text differs from the inserted text', () => {
        const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'old')]),
        ]);
        const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'new')]),
        ]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('the del and ins wrappers are both preserved', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:del');
        expect(pChildren[1]!.tagName).toBe('w:ins');
      });
    });

    test('preserves w:del + w:ins when formatting differs', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del/ins pair with the same text but different formatting (bold vs italic)', () => {
        const delRun = el('w:r', {}, [
          el('w:rPr', {}, [el('w:b')]),
          el('w:delText', {}, undefined, 'text'),
        ]);
        const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [delRun]);

        const insRun = el('w:r', {}, [
          el('w:rPr', {}, [el('w:i')]),
          el('w:t', {}, undefined, 'text'),
        ]);
        const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [insRun]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('the del and ins wrappers are both preserved', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:del');
        expect(pChildren[1]!.tagName).toBe('w:ins');
      });
    });

    test('preserves w:del + w:ins when non-text structure differs', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del run with an extra w:tab and an ins run without it', () => {
        // del has w:tab, ins doesn't
        const delRun = el('w:r', {}, [
          el('w:delText', {}, undefined, 'text'),
          el('w:tab'),
        ]);
        const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [delRun]);

        const insRun = el('w:r', {}, [
          el('w:t', {}, undefined, 'text'),
        ]);
        const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [insRun]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('the del and ins wrappers are both preserved', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
      });
    });

    test('handles multi-run no-op pairs', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del and ins each containing two runs with identical text', () => {
        const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'first ')]),
          el('w:r', {}, [el('w:delText', {}, undefined, 'second')]),
        ]);
        const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'first ')]),
          el('w:r', {}, [el('w:t', {}, undefined, 'second')]),
        ]);

        p = el('w:p', {}, [wDel, wIns]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('both wrappers are removed and the two plain runs remain', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:r');
        expect(pChildren[1]!.tagName).toBe('w:r');
      });
    });

    test('does not skip subsequent pairs after mutation', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two consecutive no-op del/ins pairs in the same paragraph', () => {
        // Two consecutive no-op pairs
        const wDel1 = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'aaa')]),
        ]);
        const wIns1 = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'aaa')]),
        ]);
        const wDel2 = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'bbb')]),
        ]);
        const wIns2 = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'bbb')]),
        ]);

        p = el('w:p', {}, [wDel1, wIns1, wDel2, wIns2]);
        body = el('w:body', {}, [p]);
      });

      await when('suppressNoOpChangePairs is called', () => {
        suppressNoOpChangePairs(body);
      });

      await then('both pairs are unwrapped leaving two plain runs', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:r');
        expect(pChildren[1]!.tagName).toBe('w:r');
      });
    });
  });

  describe('mergeWhitespaceBridgedTrackChanges', () => {
    test('does not merge w:del siblings (del bridging is unsafe for accept projection)', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del wrappers bridged by a whitespace-only run', () => {
        const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
        ]);
        const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
        const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
        ]);

        p = el('w:p', {}, [delA, spaceRun, delB]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the two del wrappers are not merged', () => {
        // Dels should NOT be merged — the intervening whitespace is Equal content
        // needed by the accept projection
        const dels = childElements(p).filter(c => c.tagName === 'w:del');
        expect(dels.length).toBe(2);
      });
    });

    test('merges w:ins siblings bridged by whitespace-only run', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two ins wrappers bridged by a whitespace-only run', () => {
        const insA = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'X')]),
        ]);
        const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
        const insB = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'Y')]),
        ]);

        p = el('w:p', {}, [insA, spaceRun, insB]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the two ins wrappers are merged into one containing all three runs', () => {
        const pChildren = childElements(p);
        const inses = pChildren.filter(c => c.tagName === 'w:ins');
        expect(inses.length).toBe(1);
        // Should contain: original run + whitespace run (moved) + second run
        const insChildren = childElements(inses[0]!);
        expect(insChildren.length).toBe(3);
      });
    });

    test('does not merge when bridging run has non-whitespace text', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del wrappers bridged by a run with a real word', () => {
        const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
        ]);
        const wordRun = el('w:r', {}, [el('w:t', {}, undefined, 'word')]);
        const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
        ]);

        p = el('w:p', {}, [delA, wordRun, delB]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the two del wrappers are not merged', () => {
        const dels = childElements(p).filter(c => c.tagName === 'w:del');
        expect(dels.length).toBe(2);
      });
    });

    test('does not merge when bridging run has w:tab', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del wrappers bridged by a run containing a tab', () => {
        const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
        ]);
        const tabRun = el('w:r', {}, [el('w:tab')]);
        const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
        ]);

        p = el('w:p', {}, [delA, tabRun, delB]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the two del wrappers are not merged', () => {
        const dels = childElements(p).filter(c => c.tagName === 'w:del');
        expect(dels.length).toBe(2);
      });
    });

    test('does not merge across different authors', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del wrappers from different authors bridged by whitespace', () => {
        const delA = el('w:del', { 'w:author': 'Author1', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
        ]);
        const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
        const delB = el('w:del', { 'w:author': 'Author2', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
        ]);

        p = el('w:p', {}, [delA, spaceRun, delB]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the two del wrappers are not merged across author boundaries', () => {
        const dels = childElements(p).filter(c => c.tagName === 'w:del');
        expect(dels.length).toBe(2);
      });
    });

    test('accept/reject projection is correct after ins merge', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two ins wrappers (X and Y) bridged by a space run', () => {
        // Only ins siblings get bridged (del bridging is unsafe)
        const insX = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'X')]),
        ]);
        const space = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
        const insY = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'Y')]),
        ]);

        p = el('w:p', {}, [insX, space, insY]);
        body = el('w:body', {}, [p]);
      });

      await when('mergeWhitespaceBridgedTrackChanges is called', () => {
        mergeWhitespaceBridgedTrackChanges(body);
      });

      await then('the merged ins text reads "X Y" (whitespace moved inside)', () => {
        // Ins siblings should be merged with whitespace moved inside
        const inses = childElements(p).filter(c => c.tagName === 'w:ins');
        expect(inses.length).toBe(1);
        const insTextContent = findAllByTagName(inses[0]!, 'w:t').map(e => e.textContent).join('');
        expect(insTextContent).toBe('X Y');
      });
    });
  });

  describe('runHasVisibleContent', () => {
    test('returns true for run with w:t', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let result: boolean;

      await given('a run containing a w:t element', () => {
        run = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
      });

      await when('runHasVisibleContent is called', () => {
        result = runHasVisibleContent(run);
      });

      await then('the result is true', () => {
        expect(result).toBe(true);
      });
    });

    test('returns true for run with w:tab', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let result: boolean;

      await given('a run containing a w:tab element', () => {
        run = el('w:r', {}, [el('w:tab')]);
      });

      await when('runHasVisibleContent is called', () => {
        result = runHasVisibleContent(run);
      });

      await then('the result is true', () => {
        expect(result).toBe(true);
      });
    });

    test('returns false for run with only w:rPr', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let result: boolean;

      await given('a run containing only a w:rPr element', () => {
        run = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
      });

      await when('runHasVisibleContent is called', () => {
        result = runHasVisibleContent(run);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });

    test('returns false for empty run', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let result: boolean;

      await given('an empty run with no children', () => {
        run = el('w:r');
      });

      await when('runHasVisibleContent is called', () => {
        result = runHasVisibleContent(run);
      });

      await then('the result is false', () => {
        expect(result).toBe(false);
      });
    });

    test('returns true for run with w:fldChar', async ({ given, when, then }: AllureBddContext) => {
      let run: Element;
      let result: boolean;

      await given('a run containing a w:fldChar element', () => {
        run = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
      });

      await when('runHasVisibleContent is called', () => {
        result = runHasVisibleContent(run);
      });

      await then('the result is true', () => {
        expect(result).toBe(true);
      });
    });
  });

  describe('coalesceDelInsPairChains', () => {
    const a = 'Author';
    const d = '2025-01-01T00:00:00Z';

    function makeDel(text: string): Element {
      return el('w:del', { 'w:id': '1', 'w:author': a, 'w:date': d }, [
        el('w:r', {}, [el('w:delText', {}, undefined, text)]),
      ]);
    }

    function makeIns(text: string): Element {
      return el('w:ins', { 'w:id': '2', 'w:author': a, 'w:date': d }, [
        el('w:r', {}, [el('w:t', {}, undefined, text)]),
      ]);
    }

    function wsRun(text = ' '): Element {
      return el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, text)]);
    }

    test('coalesces basic del-ins pair chain', async ({ given, when, then, and }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs bridged by a whitespace run (A→X, space, B→Y)', () => {
        const del1 = makeDel('A');
        const ins1 = makeIns('X');
        const space = wsRun();
        const del2 = makeDel('B');
        const ins2 = makeIns('Y');

        p = el('w:p', {}, [del1, ins1, space, del2, ins2]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the two pairs are merged into a single del and a single ins', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:del');
        expect(pChildren[1]!.tagName).toBe('w:ins');
      });

      await and('the merged del contains 3 runs (A, space clone, B)', () => {
        const pChildren = childElements(p);
        // Del should contain: run(A), run(delText:" "), run(B)
        const delRuns = childElements(pChildren[0]!).filter(c => c.tagName === 'w:r');
        expect(delRuns.length).toBe(3);

        // Ins should contain: run(X), run(t:" "), run(Y)
        const insRuns = childElements(pChildren[1]!).filter(c => c.tagName === 'w:r');
        expect(insRuns.length).toBe(3);
      });
    });

    test('coalesces 3+ pair chain', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('three del-ins pairs bridged by whitespace runs', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('all three pairs are merged into a single del and a single ins', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        expect(pChildren[0]!.tagName).toBe('w:del');
        expect(pChildren[1]!.tagName).toBe('w:ins');
      });
    });

    test('handles multi-run whitespace segment', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs bridged by two consecutive whitespace runs', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), wsRun(' '), wsRun(' '), makeDel('B'), makeIns('Y'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the pairs are merged and the del contains 4 runs (A + 2 ws clones + B)', () => {
        const pChildren = childElements(p);
        expect(pChildren.length).toBe(2);
        // Del should have: run(A) + 2 ws clones + run(B) = 4 runs
        const delRuns = childElements(pChildren[0]!).filter(c => c.tagName === 'w:r');
        expect(delRuns.length).toBe(4);
      });
    });

    test('does not bridge non-whitespace', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs separated by a non-whitespace word run', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'),
          el('w:r', {}, [el('w:t', {}, undefined, 'word')]),
          makeDel('B'), makeIns('Y'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the paragraph children remain unchanged at 5 elements', () => {
        // Should remain unchanged — 5 children
        expect(childElements(p).length).toBe(5);
      });
    });

    test('does not bridge different authors', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs from different authors bridged by whitespace', () => {
        const del1 = el('w:del', { 'w:id': '1', 'w:author': 'Alice', 'w:date': d }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
        ]);
        const ins1 = el('w:ins', { 'w:id': '2', 'w:author': 'Alice', 'w:date': d }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'X')]),
        ]);
        const del2 = el('w:del', { 'w:id': '3', 'w:author': 'Bob', 'w:date': d }, [
          el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
        ]);
        const ins2 = el('w:ins', { 'w:id': '4', 'w:author': 'Bob', 'w:date': d }, [
          el('w:r', {}, [el('w:t', {}, undefined, 'Y')]),
        ]);

        p = el('w:p', {}, [del1, ins1, wsRun(), del2, ins2]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the paragraph children remain unchanged at 5 elements', () => {
        // Should remain unchanged — 5 children
        expect(childElements(p).length).toBe(5);
      });
    });

    test('does not coalesce single pair', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a single del-ins pair with no bridging whitespace', () => {
        p = el('w:p', {}, [makeDel('A'), makeIns('X')]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the paragraph still has 2 children unchanged', () => {
        expect(childElements(p).length).toBe(2);
      });
    });

    test('does not bridge incomplete tail (del without ins)', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('a del-ins pair followed by whitespace and then a lone del', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), wsRun(), makeDel('B'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the paragraph children remain unchanged at 4 elements', () => {
        // Should remain unchanged — 4 children
        expect(childElements(p).length).toBe(4);
      });
    });

    test('accept projection correct — ins text is "X Y Z"', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('three del-ins pairs (A→X, B→Y, C→Z) bridged by whitespace', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the merged ins text reads "X Y Z"', () => {
        const ins = childElements(p).find(c => c.tagName === 'w:ins')!;
        const insText = findAllByTagName(ins, 'w:t').map(e => e.textContent).join('');
        expect(insText).toBe('X Y Z');
      });
    });

    test('reject projection correct — del text is "A B C"', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('three del-ins pairs (A→X, B→Y, C→Z) bridged by whitespace', () => {
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the merged del text reads "A B C"', () => {
        const del = childElements(p).find(c => c.tagName === 'w:del')!;
        const delText = findAllByTagName(del, 'w:delText').map(e => e.textContent).join('');
        expect(delText).toBe('A B C');
      });
    });

    test('does not bridge across w:tab', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs bridged by a tab run', () => {
        const tabRun = el('w:r', {}, [el('w:tab')]);
        p = el('w:p', {}, [
          makeDel('A'), makeIns('X'), tabRun, makeDel('B'), makeIns('Y'),
        ]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the paragraph children remain unchanged at 5 elements', () => {
        // Should remain unchanged — 5 children
        expect(childElements(p).length).toBe(5);
      });
    });

    test('preserves xml:space on cloned delText', async ({ given, when, then }: AllureBddContext) => {
      let p: Element, body: Element;

      await given('two del-ins pairs bridged by a space run with xml:space="preserve"', () => {
        const spaceRun = el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, ' ')]);
        p = el('w:p', {}, [makeDel('A'), makeIns('X'), spaceRun, makeDel('B'), makeIns('Y')]);
        body = el('w:body', {}, [p]);
      });

      await when('coalesceDelInsPairChains is called', () => {
        coalesceDelInsPairChains(body);
      });

      await then('the cloned delText for the space retains xml:space="preserve"', () => {
        const del = childElements(p).find(c => c.tagName === 'w:del')!;
        const delTexts = findAllByTagName(del, 'w:delText');
        // The space clone should have xml:space="preserve"
        const spaceDelText = delTexts.find(e => e.textContent === ' ');
        expect(spaceDelText).toBeDefined();
        expect(spaceDelText!.getAttribute('xml:space')).toBe('preserve');
      });
    });
  });
});
