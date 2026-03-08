import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
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
    it('should wrap a run element with w:ins', () => {
      const t = el('w:t', {}, undefined, 'inserted text');
      const r = el('w:r', {}, [t]);
      const p = el('w:p', {}, [r]);

      const state = createRevisionIdState();
      const result = wrapAsInserted(r, author, dateStr, state);

      expect(result).toBe(true);
      // p should now have ins as child
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

    it('should not wrap the same run twice', () => {
      const r = el('w:r');
      el('w:p', {}, [r]); // parent needed for DOM tree structure

      const state = createRevisionIdState();
      wrapAsInserted(r, author, dateStr, state);
      const result = wrapAsInserted(r, author, dateStr, state);

      expect(result).toBe(false);
    });

    it('should increment revision IDs', () => {
      const r1 = el('w:r');
      const r2 = el('w:r');
      const p = el('w:p', {}, [r1, r2]);

      const state = createRevisionIdState();
      wrapAsInserted(r1, author, dateStr, state);
      wrapAsInserted(r2, author, dateStr, state);

      const pChildren = childElements(p);
      const first = pChildren[0];
      assertDefined(first, 'p children[0]');
      expect(first.getAttribute('w:id')).toBe('1');
      const second = pChildren[1];
      assertDefined(second, 'p children[1]');
      expect(second.getAttribute('w:id')).toBe('2');
    });
  });

  describe('wrapAsDeleted', () => {
    it('should wrap a run element with w:del', () => {
      const t = el('w:t', {}, undefined, 'deleted text');
      const r = el('w:r', {}, [t]);
      const p = el('w:p', {}, [r]);

      const state = createRevisionIdState();
      const result = wrapAsDeleted(r, author, dateStr, state);

      expect(result).toBe(true);
      const pChildren = childElements(p);
      const del = pChildren[0];
      assertDefined(del, 'p children[0]');
      expect(del.tagName).toBe('w:del');
      const delChildren = childElements(del);
      expect(delChildren[0]).toBe(r);
    });

    it('should convert w:t to w:delText', () => {
      const t = el('w:t', {}, undefined, 'deleted text');
      const r = el('w:r', {}, [t]);
      el('w:p', {}, [r]); // parent needed for DOM tree structure

      const state = createRevisionIdState();
      wrapAsDeleted(r, author, dateStr, state);

      // After conversion, the original t element is replaced in the DOM.
      // Find the delText within the run.
      const rChildren = childElements(r);
      const delText = rChildren.find(c => c.tagName === 'w:delText');
      assertDefined(delText, 'delText');
      expect(delText.textContent).toBe('deleted text');
    });
  });

  describe('insertDeletedRun', () => {
    it('should clone and insert a deleted run', () => {
      // Create the original (deleted) run
      const originalT = el('w:t', {}, undefined, 'deleted');
      const originalR = el('w:r', { id: 'original' }, [originalT]);
      const originalP = el('w:p', {}, [originalR]);

      // Create the target paragraph
      const existingT = el('w:t', {}, undefined, 'existing');
      const existingR = el('w:r', {}, [existingT]);
      const targetP = el('w:p', {}, [existingR]);

      // Create a mock deleted atom
      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
        sourceParagraphElement: originalP,
        contentElement: el('w:t', {}, undefined, 'deleted'),
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);

      assertDefined(result, 'result');
      expect(result.tagName).toBe('w:del');
      // Should be inserted after existingR
      const targetChildren = childElements(targetP);
      expect(targetChildren).toHaveLength(2);
      expect(targetChildren[1]).toBe(result);
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

    it('should insert only the deleted atom fragment, not the full source run text', () => {
      const originalRPr = el('w:rPr', {}, [el('w:b')]);
      const originalT = el('w:t', {}, undefined, 'prefix and deleted token');
      const originalR = el('w:r', { id: 'original' }, [originalRPr, originalT]);
      const originalP = el('w:p', {}, [originalR]);

      const existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
      const targetP = el('w:p', {}, [existingR]);

      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
        sourceParagraphElement: originalP,
        contentElement: el('w:t', {}, undefined, 'deleted token'),
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);

      assertDefined(result, 'result');
      const resultChildren = childElements(result);
      const insertedRun = resultChildren[0];
      assertDefined(insertedRun, 'result children[0]');
      expect(insertedRun.tagName).toBe('w:r');
      const insertedRunChildren = childElements(insertedRun);
      expect(insertedRunChildren.some((c) => c.tagName === 'w:rPr')).toBe(true);
      const delText = insertedRunChildren.find((c) => c.tagName === 'w:delText');
      assertDefined(delText, 'delText');
      expect(delText.textContent).toBe('deleted token');
      expect(delText.textContent).not.toContain('prefix and');
    });

    it('should insert at beginning if insertAfterRun is null', () => {
      const originalR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted')]);
      el('w:p', {}, [originalR]); // parent needed for DOM tree structure

      const existingR = el('w:r');
      const targetP = el('w:p', {}, [existingR]);

      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);

      expect(result).not.toBeNull();
      // Should be at the beginning
      const targetChildren = childElements(targetP);
      expect(targetChildren[0]).toBe(result);
    });

    it('should insert after pPr if present and insertAfterRun is null', () => {
      const originalR = el('w:r');
      el('w:p', {}, [originalR]); // parent needed for DOM tree structure

      const pPr = el('w:pPr');
      const existingR = el('w:r');
      const targetP = el('w:p', {}, [pPr, existingR]);

      const deletedAtom = createMockAtom({
        sourceRunElement: originalR,
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);

      expect(result).not.toBeNull();
      // Order should be: pPr, del, existingR
      const targetChildren = childElements(targetP);
      expect(targetChildren[0]).toBe(pPr);
      expect(targetChildren[1]).toBe(result);
      expect(targetChildren[2]).toBe(existingR);
    });

    it('clones adjacent source bookmark markers once when the source run is split into multiple atoms', () => {
      const sourceStart = el('w:bookmarkStart', {
        'w:id': '10',
        'w:name': '_RefSplitDeleted',
      });
      const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'deleted text')]);
      const sourceEnd = el('w:bookmarkEnd', { 'w:id': '10' });
      const sourceP = el('w:p', {}, [sourceStart, sourceRun, sourceEnd]);

      const existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
      const targetP = el('w:p', {}, [existingR]);

      const firstAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: el('w:t', {}, undefined, 'deleted'),
      });
      const secondAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: el('w:t', {}, undefined, ' text'),
      });

      const state = createRevisionIdState();
      const firstInsert = insertDeletedRun(firstAtom, existingR, targetP, author, dateStr, state);
      const secondInsert = insertDeletedRun(secondAtom, firstInsert, targetP, author, dateStr, state);

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

  describe('insertMoveFromRun', () => {
    it('clones adjacent source bookmark markers once when source run is split', () => {
      const sourceStart = el('w:bookmarkStart', {
        'w:id': '11',
        'w:name': '_RefSplitMove',
      });
      const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved text')]);
      const sourceEnd = el('w:bookmarkEnd', { 'w:id': '11' });
      const sourceP = el('w:p', {}, [sourceStart, sourceRun, sourceEnd]);

      const existingR = el('w:r', {}, [el('w:t', {}, undefined, 'existing')]);
      const targetP = el('w:p', {}, [existingR]);

      const firstAtom = createMockAtom({
        correlationStatus: CorrelationStatus.MovedSource,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: el('w:t', {}, undefined, 'moved'),
        moveName: 'move-split',
      });
      const secondAtom = createMockAtom({
        correlationStatus: CorrelationStatus.MovedSource,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: el('w:t', {}, undefined, ' text'),
        moveName: 'move-split',
      });

      const state = createRevisionIdState();
      const firstInsert = insertMoveFromRun(
        firstAtom,
        'move-split',
        existingR,
        targetP,
        author,
        dateStr,
        state
      );
      const secondInsert = insertMoveFromRun(
        secondAtom,
        'move-split',
        firstInsert,
        targetP,
        author,
        dateStr,
        state
      );

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

  describe('wrapAsMoveFrom', () => {
    it('should wrap with moveFrom and add range markers', () => {
      const t = el('w:t', {}, undefined, 'moved text');
      const r = el('w:r', {}, [t]);
      const p = el('w:p', {}, [r]);

      const state = createRevisionIdState();
      const result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);

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

    it('should convert w:t to w:delText for moved-from content', () => {
      const t = el('w:t', {}, undefined, 'moved');
      const r = el('w:r', {}, [t]);
      el('w:p', {}, [r]); // parent needed for DOM tree structure

      const state = createRevisionIdState();
      wrapAsMoveFrom(r, 'move1', author, dateStr, state);

      // After conversion, the original w:t is replaced. Find delText in the run.
      const rChildren = childElements(r);
      const delText = rChildren.find(c => c.tagName === 'w:delText');
      assertDefined(delText, 'delText');
      expect(delText.textContent).toBe('moved');
    });

    it('should use same range ID for same move name', () => {
      const r1 = el('w:r');
      const r2 = el('w:r');
      const p = el('w:p', {}, [r1, r2]);

      const state = createRevisionIdState();
      wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
      wrapAsMoveTo(r2, 'move1', author, dateStr, state);

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

  describe('wrapAsMoveTo', () => {
    it('should wrap with moveTo and add range markers', () => {
      const t = el('w:t', {}, undefined, 'moved text');
      const r = el('w:r', {}, [t]);
      const p = el('w:p', {}, [r]);

      const state = createRevisionIdState();
      const result = wrapAsMoveTo(r, 'move1', author, dateStr, state);

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

    it('should not convert w:t to w:delText for moved-to content', () => {
      const t = el('w:t', {}, undefined, 'moved');
      const r = el('w:r', {}, [t]);
      el('w:p', {}, [r]); // parent needed for DOM tree structure

      const state = createRevisionIdState();
      wrapAsMoveTo(r, 'move1', author, dateStr, state);

      // moveTo content keeps w:t
      expect(t.tagName).toBe('w:t');
    });
  });

  describe('addFormatChange', () => {
    it('should add rPrChange to existing rPr', () => {
      const rPr = el('w:rPr', {}, [
        el('w:b'),
        el('w:i'),
      ]);
      const t = el('w:t', {}, undefined, 'formatted');
      const r = el('w:r', {}, [rPr, t]);

      const oldRPr = el('w:rPr', {}, [
        el('w:b'),
      ]);

      const state = createRevisionIdState();
      addFormatChange(r, oldRPr, author, dateStr, state);

      // rPr should now contain rPrChange
      const rPrChildren = childElements(rPr);
      const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
      assertDefined(rPrChange, 'rPrChange');
      expect(rPrChange.getAttribute('w:author')).toBe(author);
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

    it('should create rPr if it does not exist', () => {
      const t = el('w:t', {}, undefined, 'text');
      const r = el('w:r', {}, [t]);

      const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);

      const state = createRevisionIdState();
      addFormatChange(r, oldRPr, author, dateStr, state);

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

  describe('wrapParagraphAsInserted', () => {
    it('should add PPR-INS marker for empty paragraphs (no runs) so reject-all removes them', () => {
      const pPr = el('w:pPr');
      const p = el('w:p', {}, [pPr]);
      el('w:body', {}, [p]);

      const state = createRevisionIdState();
      const result = wrapParagraphAsInserted(p, author, dateStr, state);

      expect(result).toBe(true);

      // PPR-INS marker should be added for empty paragraphs
      const pPrChildren = childElements(pPr);
      const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
      expect(rPr).toBeDefined();
      const insMarker = childElements(rPr!).find((c) => c.tagName === 'w:ins');
      expect(insMarker).toBeDefined();
    });

    it('should add PPR-INS marker for paragraphs with only empty w:r shells (no visible content)', () => {
      const pPr = el('w:pPr');
      const emptyRun = el('w:r', {}, [el('w:rPr')]); // run with only rPr, no text
      const p = el('w:p', {}, [pPr, emptyRun]);
      el('w:body', {}, [p]);

      const state = createRevisionIdState();
      const result = wrapParagraphAsInserted(p, author, dateStr, state);

      expect(result).toBe(true);

      // PPR-INS marker should be added because the run has no visible content
      const pPrChildren = childElements(pPr);
      const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
      expect(rPr).toBeDefined();
      const insMarker = childElements(rPr!).find((c) => c.tagName === 'w:ins');
      expect(insMarker).toBeDefined();
    });

    it('should be a no-op for paragraphs with substantive runs (Google Docs compat)', () => {
      const pPr = el('w:pPr');
      const run = el('w:r', {}, [el('w:t')]); // run with visible content
      const p = el('w:p', {}, [pPr, run]);
      el('w:body', {}, [p]);

      const state = createRevisionIdState();
      const result = wrapParagraphAsInserted(p, author, dateStr, state);

      expect(result).toBe(true);

      // No PPR-INS marker — runs with visible content already wrapped by w:ins
      const pPrChildren = childElements(pPr);
      const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
      expect(rPr).toBeUndefined();
    });
  });

  describe('addParagraphPropertyChange', () => {
    it('should create pPrChange with correct attributes', () => {
      const pPr = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);

      const pPrChildren = childElements(pPr);
      const pPrChange = pPrChildren.find((c) => c.tagName === 'w:pPrChange');
      assertDefined(pPrChange, 'pPrChange');
      expect(pPrChange.getAttribute('w:id')).toBe('1');
      expect(pPrChange.getAttribute('w:author')).toBe(author);
      expect(pPrChange.getAttribute('w:date')).toBe(dateStr);
    });

    it('should clone pPr content as snapshot', () => {
      const spacing = el('w:spacing', { 'w:after': '200' });
      const ind = el('w:ind', { 'w:left': '720' });
      const pPr = el('w:pPr', {}, [spacing, ind]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);

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

    it('should exclude rPr, sectPr, pPrChange from snapshot (CT_PPrBase)', () => {
      const spacing = el('w:spacing', { 'w:after': '200' });
      const rPr = el('w:rPr', {}, [el('w:b')]);
      const sectPr = el('w:sectPr');
      const pPr = el('w:pPr', {}, [spacing, rPr, sectPr]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);

      const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange');
      assertDefined(pPrChange, 'pPrChange');
      const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr');
      assertDefined(innerPPr, 'inner pPr');
      const innerChildren = childElements(innerPPr);
      // Only spacing should be cloned; rPr and sectPr excluded
      expect(innerChildren).toHaveLength(1);
      expect(innerChildren[0]!.tagName).toBe('w:spacing');
    });

    it('should be idempotent (second call is a no-op)', () => {
      const pPr = el('w:pPr', {}, [el('w:spacing', { 'w:after': '200' })]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);
      addParagraphPropertyChange(p, author, dateStr, state);

      const pPrChanges = childElements(pPr).filter((c) => c.tagName === 'w:pPrChange');
      expect(pPrChanges).toHaveLength(1);
      // Second call should not have allocated another ID
      expect(state.nextId).toBe(2);
    });

    it('should create pPr if paragraph has none', () => {
      const p = el('w:p');

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);

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

  describe('wrapParagraphAsDeleted', () => {
    it('should add a paragraph-mark w:del marker in w:pPr/w:rPr (not wrap <w:p>)', () => {
      const p = el('w:p');
      const body = el('w:body', {}, [p]);

      const state = createRevisionIdState();
      const result = wrapParagraphAsDeleted(p, author, dateStr, state);

      expect(result).toBe(true);
      const bodyChildren = childElements(body);
      const bodyFirst = bodyChildren[0];
      assertDefined(bodyFirst, 'body children[0]');
      expect(bodyFirst.tagName).toBe('w:p');

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

    it('should reuse existing pPr and rPr when present', () => {
      const existingRPr = el('w:rPr', {}, [el('w:b')]);
      const existingPPr = el('w:pPr', {}, [existingRPr]);
      const p = el('w:p', {}, [existingPPr]);

      const state = createRevisionIdState();
      wrapParagraphAsDeleted(p, author, dateStr, state);

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

    it('should not add duplicate marker on second call', () => {
      const p = el('w:p');
      el('w:body', {}, [p]);

      const state = createRevisionIdState();
      wrapParagraphAsDeleted(p, author, dateStr, state);
      wrapParagraphAsDeleted(p, author, dateStr, state);

      const pPr = childElements(p).find((c) => c.tagName === 'w:pPr')!;
      const rPr = childElements(pPr).find((c) => c.tagName === 'w:rPr')!;
      const markers = childElements(rPr).filter((c) => c.tagName === 'w:del');
      expect(markers).toHaveLength(1);
    });

    it('should insert rPr before sectPr in pPr', () => {
      const sectPr = el('w:sectPr');
      const pPr = el('w:pPr', {}, [el('w:spacing'), sectPr]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      wrapParagraphAsDeleted(p, author, dateStr, state);

      const pPrChildren = childElements(pPr);
      const rPrIdx = pPrChildren.findIndex((c) => c.tagName === 'w:rPr');
      const sectPrIdx = pPrChildren.findIndex((c) => c.tagName === 'w:sectPr');
      expect(rPrIdx).toBeLessThan(sectPrIdx);
    });
  });

  // ── Branch coverage: wrap with no parent ──────────────────────────

  describe('wrapAsInserted — no parent', () => {
    it('returns false for detached run (no parentNode)', () => {
      const r = el('w:r'); // no parent
      const state = createRevisionIdState();
      const result = wrapAsInserted(r, author, dateStr, state);
      expect(result).toBe(false);
    });
  });

  describe('wrapAsDeleted — no parent', () => {
    it('returns false for detached run (no parentNode)', () => {
      const r = el('w:r'); // no parent
      const state = createRevisionIdState();
      const result = wrapAsDeleted(r, author, dateStr, state);
      expect(result).toBe(false);
    });
  });

  describe('wrapAsMoveFrom — no parent', () => {
    it('returns false for detached run', () => {
      const r = el('w:r');
      const state = createRevisionIdState();
      const result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      expect(result).toBe(false);
    });

    it('returns false for already wrapped run', () => {
      const r = el('w:r');
      el('w:p', {}, [r]);
      const state = createRevisionIdState();
      wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      const result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      expect(result).toBe(false);
    });
  });

  describe('wrapAsMoveTo — no parent', () => {
    it('returns false for detached run', () => {
      const r = el('w:r');
      const state = createRevisionIdState();
      const result = wrapAsMoveTo(r, 'move1', author, dateStr, state);
      expect(result).toBe(false);
    });
  });

  // ── Branch coverage: convertToDelText with attributes ─────────────

  describe('wrapAsDeleted — convertToDelText edge cases', () => {
    it('preserves xml:space attribute on converted delText', () => {
      const t = el('w:t', { 'xml:space': 'preserve' }, undefined, '  spaced  ');
      const r = el('w:r', {}, [t]);
      el('w:p', {}, [r]);

      const state = createRevisionIdState();
      wrapAsDeleted(r, author, dateStr, state);

      const delText = childElements(r).find((c) => c.tagName === 'w:delText');
      assertDefined(delText, 'delText');
      expect(delText.getAttribute('xml:space')).toBe('preserve');
      expect(delText.textContent).toBe('  spaced  ');
    });

    it('handles run with multiple w:t elements', () => {
      const t1 = el('w:t', {}, undefined, 'first');
      const t2 = el('w:t', {}, undefined, 'second');
      const r = el('w:r', {}, [t1, t2]);
      el('w:p', {}, [r]);

      const state = createRevisionIdState();
      wrapAsDeleted(r, author, dateStr, state);

      const rChildren = childElements(r);
      const delTexts = rChildren.filter((c) => c.tagName === 'w:delText');
      expect(delTexts).toHaveLength(2);
      expect(delTexts[0]!.textContent).toBe('first');
      expect(delTexts[1]!.textContent).toBe('second');
    });

    it('leaves non-w:t elements (tab, br) unchanged', () => {
      const tab = el('w:tab');
      const br = el('w:br');
      const t = el('w:t', {}, undefined, 'text');
      const r = el('w:r', {}, [tab, br, t]);
      el('w:p', {}, [r]);

      const state = createRevisionIdState();
      wrapAsDeleted(r, author, dateStr, state);

      const rChildren = childElements(r);
      expect(rChildren[0]!.tagName).toBe('w:tab');
      expect(rChildren[1]!.tagName).toBe('w:br');
      expect(rChildren[2]!.tagName).toBe('w:delText');
    });
  });

  // ── Branch coverage: insertDeletedRun — no sourceRunElement ───────

  describe('insertDeletedRun — edge cases', () => {
    it('returns null when atom has no sourceRunElement', () => {
      const targetP = el('w:p', {}, [el('w:r')]);
      const atom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: undefined,
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(atom, null, targetP, author, dateStr, state);
      expect(result).toBeNull();
    });

    it('handles collapsed field atoms by replaying field sequence', () => {
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

      const atom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: sourceRun,
        contentElement: el('w:t', {}, undefined, 'link text'),
        collapsedFieldAtoms: fieldAtoms,
      });

      const targetP = el('w:p', {}, [el('w:r')]);
      const state = createRevisionIdState();
      const del = insertDeletedRun(atom, null, targetP, author, dateStr, state);

      assertDefined(del, 'del wrapper');
      expect(del.tagName).toBe('w:del');
      // The cloned run should contain the field sequence, not the synthetic text
      const clonedRun = childElements(del)[0]!;
      const clonedRunChildren = childElements(clonedRun);
      // Should have rPr + 5 field elements (fldChar, instrText, etc.)
      expect(clonedRunChildren.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ── Branch coverage: insertMoveFromRun — edge cases ───────────────

  describe('insertMoveFromRun — edge cases', () => {
    it('returns null when atom has no sourceRunElement', () => {
      const targetP = el('w:p', {}, [el('w:r')]);
      const atom = createMockAtom({
        correlationStatus: CorrelationStatus.MovedSource,
        sourceRunElement: undefined,
      });

      const state = createRevisionIdState();
      const result = insertMoveFromRun(atom, 'move1', null, targetP, author, dateStr, state);
      expect(result).toBeNull();
    });

    it('inserts at beginning without pPr (reverse order)', () => {
      const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved')]);
      el('w:p', {}, [sourceRun]);

      const existingR = el('w:r');
      const targetP = el('w:p', {}, [existingR]);

      const atom = createMockAtom({
        sourceRunElement: sourceRun,
        moveName: 'mv1',
      });

      const state = createRevisionIdState();
      const result = insertMoveFromRun(atom, 'mv1', null, targetP, author, dateStr, state);

      assertDefined(result, 'moveFrom element');
      // Order should be: rangeStart, moveFrom, rangeEnd, existingR
      const targetChildren = childElements(targetP);
      expect(targetChildren[0]!.tagName).toBe('w:moveFromRangeStart');
      expect(targetChildren[1]!.tagName).toBe('w:moveFrom');
      expect(targetChildren[2]!.tagName).toBe('w:moveFromRangeEnd');
      expect(targetChildren[3]).toBe(existingR);
    });

    it('inserts after pPr if present and insertAfterRun is null', () => {
      const sourceRun = el('w:r', {}, [el('w:t', {}, undefined, 'moved')]);
      el('w:p', {}, [sourceRun]);

      const pPr = el('w:pPr');
      const existingR = el('w:r');
      const targetP = el('w:p', {}, [pPr, existingR]);

      const atom = createMockAtom({
        sourceRunElement: sourceRun,
      });

      const state = createRevisionIdState();
      const result = insertMoveFromRun(atom, 'mv1', null, targetP, author, dateStr, state);

      assertDefined(result, 'moveFrom element');
      const targetChildren = childElements(targetP);
      expect(targetChildren[0]).toBe(pPr);
      expect(targetChildren[1]!.tagName).toBe('w:moveFromRangeStart');
      expect(targetChildren[2]!.tagName).toBe('w:moveFrom');
      expect(targetChildren[3]!.tagName).toBe('w:moveFromRangeEnd');
      expect(targetChildren[4]).toBe(existingR);
    });
  });

  // ── Branch coverage: insertDeletedParagraph ───────────────────────

  describe('insertDeletedParagraph', () => {
    it('returns null when atom has no sourceParagraphElement', () => {
      const body = el('w:body', {}, [el('w:p')]);
      const atom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceParagraphElement: undefined,
      });

      const state = createRevisionIdState();
      const result = insertDeletedParagraph(atom, null, body, author, dateStr, state);
      expect(result).toBeNull();
    });

    it('clones and inserts deleted paragraph after reference paragraph', () => {
      const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted text')]);
      const sourceP = el('w:p', {}, [sourceR]);

      const existingP = el('w:p', {}, [el('w:r', {}, [el('w:t', {}, undefined, 'existing')])]);
      const body = el('w:body', {}, [existingP]);

      const atom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceParagraphElement: sourceP,
        sourceRunElement: sourceR,
      });

      const state = createRevisionIdState();
      const result = insertDeletedParagraph(atom, existingP, body, author, dateStr, state);

      assertDefined(result, 'inserted paragraph');
      expect(result.tagName).toBe('w:p');
      const bodyChildren = childElements(body);
      expect(bodyChildren).toHaveLength(2);
      expect(bodyChildren[0]).toBe(existingP);
      expect(bodyChildren[1]).toBe(result);
      // Runs should be wrapped with w:del
      const delWrappers = findAllByTagName(result, 'w:del');
      expect(delWrappers.length).toBeGreaterThan(0);
    });

    it('inserts at body start when insertAfterParagraph is null', () => {
      const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'deleted')]);
      const sourceP = el('w:p', {}, [sourceR]);

      const existingP = el('w:p');
      const body = el('w:body', {}, [existingP]);

      const atom = createMockAtom({
        sourceParagraphElement: sourceP,
      });

      const state = createRevisionIdState();
      const result = insertDeletedParagraph(atom, null, body, author, dateStr, state);

      assertDefined(result, 'inserted paragraph');
      const bodyChildren = childElements(body);
      expect(bodyChildren[0]).toBe(result);
      expect(bodyChildren[1]).toBe(existingP);
    });

    it('wraps cloned runs with w:del and converts w:t to w:delText', () => {
      const sourceR = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
      const sourceP = el('w:p', {}, [el('w:pPr'), sourceR]);
      const body = el('w:body');

      const atom = createMockAtom({
        sourceParagraphElement: sourceP,
      });

      const state = createRevisionIdState();
      const result = insertDeletedParagraph(atom, null, body, author, dateStr, state);

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

  // ── Branch coverage: addFormatChange — null oldRunProperties ──────

  describe('addFormatChange — edge cases', () => {
    it('handles null oldRunProperties (no inner rPr in rPrChange)', () => {
      const rPr = el('w:rPr', {}, [el('w:b')]);
      const r = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'text')]);

      const state = createRevisionIdState();
      addFormatChange(r, null, author, dateStr, state);

      const rPrChange = childElements(rPr).find((c) => c.tagName === 'w:rPrChange');
      assertDefined(rPrChange, 'rPrChange');
      // No inner w:rPr wrapper when oldRunProperties is null
      const innerChildren = childElements(rPrChange);
      expect(innerChildren).toHaveLength(0);
    });

    it('handles multiple properties in oldRunProperties', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
      const oldRPr = el('w:rPr', {}, [
        el('w:b'),
        el('w:i'),
        el('w:sz', { 'w:val': '24' }),
      ]);

      const state = createRevisionIdState();
      addFormatChange(r, oldRPr, author, dateStr, state);

      const createdRPr = childElements(r).find((c) => c.tagName === 'w:rPr')!;
      const rPrChange = childElements(createdRPr).find((c) => c.tagName === 'w:rPrChange')!;
      const innerRPr = childElements(rPrChange).find((c) => c.tagName === 'w:rPr')!;
      expect(childElements(innerRPr)).toHaveLength(3);
    });
  });

  // ── Branch coverage: preSplitMixedStatusRuns ──────────────────────

  describe('preSplitMixedStatusRuns', () => {
    it('is a no-op for empty atom list', () => {
      // Should not throw
      preSplitMixedStatusRuns([]);
    });

    it('skips atoms with no sourceRunElement', () => {
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Inserted,
          sourceRunElement: undefined,
        }),
      ];
      // Should not throw or modify anything
      preSplitMixedStatusRuns(atoms);
    });

    it('skips Deleted atoms (original-tree, not revised)', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
      el('w:p', {}, [r]);
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: r,
          contentElement: el('w:t', {}, undefined, 'text'),
        }),
      ];
      preSplitMixedStatusRuns(atoms);
      // Run should remain intact
      expect(childElements(r).some((c) => c.tagName === 'w:t')).toBe(true);
    });

    it('skips MovedSource atoms', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
      el('w:p', {}, [r]);
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.MovedSource,
          sourceRunElement: r,
          contentElement: el('w:t', {}, undefined, 'text'),
        }),
      ];
      preSplitMixedStatusRuns(atoms);
      expect(childElements(r).some((c) => c.tagName === 'w:t')).toBe(true);
    });

    it('skips atoms with collapsedFieldAtoms', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'field')]);
      el('w:p', {}, [r]);
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Inserted,
          sourceRunElement: r,
          collapsedFieldAtoms: [createMockAtom()],
        }),
      ];
      preSplitMixedStatusRuns(atoms);
    });

    it('skips atoms with field character content elements', () => {
      const r = el('w:r', {}, [el('w:fldChar')]);
      el('w:p', {}, [r]);
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Inserted,
          sourceRunElement: r,
          contentElement: el('w:fldChar', { 'w:fldCharType': 'begin' }),
        }),
      ];
      preSplitMixedStatusRuns(atoms);
    });

    it('skips single-status run groups (no split needed)', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'hello world')]);
      el('w:p', {}, [r]);
      const atoms = [
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
      preSplitMixedStatusRuns(atoms);
      // Should not split — run has single status
      const p = r.parentNode as Element;
      expect(childElements(p).filter((c) => c.tagName === 'w:r')).toHaveLength(1);
    });

    it('splits run with mixed statuses into fragments', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'helloworld')]);
      el('w:p', {}, [r]);

      const equalAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Equal,
        sourceRunElement: r,
        contentElement: el('w:t', {}, undefined, 'hello'),
      });
      const insertedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Inserted,
        sourceRunElement: r,
        contentElement: el('w:t', {}, undefined, 'world'),
      });

      preSplitMixedStatusRuns([equalAtom, insertedAtom]);

      // Atoms should now point to different run fragments
      expect(equalAtom.sourceRunElement).not.toBe(insertedAtom.sourceRunElement);
      // Both should still be w:r elements
      expect(equalAtom.sourceRunElement!.tagName).toBe('w:r');
      expect(insertedAtom.sourceRunElement!.tagName).toBe('w:r');
    });

    it('skips detached runs (no parentNode)', () => {
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'ab')]);
      // r has no parent — detached
      const atoms = [
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
      preSplitMixedStatusRuns(atoms);
      // Should not crash, atoms stay unchanged
      expect(atoms[0]!.sourceRunElement).toBe(r);
    });

    it('skips when sumAtomLengths exceeds run visible length (cross-run)', () => {
      // Run has 3 visible chars but atoms claim 5
      const r = el('w:r', {}, [el('w:t', {}, undefined, 'abc')]);
      el('w:p', {}, [r]);
      const atoms = [
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
      preSplitMixedStatusRuns(atoms);
      // Should not split — cross-run safety check
      expect(atoms[0]!.sourceRunElement).toBe(r);
      expect(atoms[1]!.sourceRunElement).toBe(r);
    });
  });

  // ── Branch coverage: wrapAsMoveTo — linked range IDs ──────────────

  describe('wrapAsMoveTo — linked range IDs', () => {
    it('allocates separate sourceRangeId and destRangeId for same move name', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'from')]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'to')]);
      el('w:p', {}, [r1]);
      el('w:p', {}, [r2]);

      const state = createRevisionIdState();
      wrapAsMoveFrom(r1, 'linked', author, dateStr, state);
      wrapAsMoveTo(r2, 'linked', author, dateStr, state);

      // r1's parent should be moveFrom, grandparent is p
      const p1 = r1.parentNode!.parentNode as Element;
      const p2 = r2.parentNode!.parentNode as Element;
      const rangeStart1 = childElements(p1).find((c) => c.tagName === 'w:moveFromRangeStart')!;
      const rangeStart2 = childElements(p2).find((c) => c.tagName === 'w:moveToRangeStart')!;

      // Source and dest use the SAME linked IDs
      expect(rangeStart1.getAttribute('w:id')).toBe('1'); // sourceRangeId
      expect(rangeStart2.getAttribute('w:id')).toBe('2'); // destRangeId
    });

    it('allocates different IDs for different move names', () => {
      const r1 = el('w:r');
      const r2 = el('w:r');
      el('w:p', {}, [r1]);
      el('w:p', {}, [r2]);

      const state = createRevisionIdState();
      wrapAsMoveFrom(r1, 'moveA', author, dateStr, state);
      wrapAsMoveTo(r2, 'moveB', author, dateStr, state);

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

  // ── Branch coverage: addParagraphPropertyChange with rPrChange ────

  describe('addParagraphPropertyChange — rPrChange excluded from snapshot', () => {
    it('excludes w:rPrChange from the snapshot when present in pPr', () => {
      const rPrChange = el('w:rPrChange');
      const spacing = el('w:spacing', { 'w:after': '100' });
      const pPr = el('w:pPr', {}, [spacing, rPrChange]);
      const p = el('w:p', {}, [pPr]);

      const state = createRevisionIdState();
      addParagraphPropertyChange(p, author, dateStr, state);

      const pPrChange = childElements(pPr).find((c) => c.tagName === 'w:pPrChange')!;
      const innerPPr = childElements(pPrChange).find((c) => c.tagName === 'w:pPr')!;
      const innerChildren = childElements(innerPPr);
      // Only spacing should be in the snapshot; rPrChange is excluded
      expect(innerChildren).toHaveLength(1);
      expect(innerChildren[0]!.tagName).toBe('w:spacing');
    });
  });

  describe('groupDeletionsBeforeInsertions', () => {
    it('passes through equal-only atoms unchanged', () => {
      const atoms = [
        createMockAtom({ correlationStatus: CorrelationStatus.Equal }),
        createMockAtom({ correlationStatus: CorrelationStatus.Equal }),
      ];
      const result = groupDeletionsBeforeInsertions(atoms);
      expect(result).toHaveLength(2);
      expect(result[0]!.correlationStatus).toBe(CorrelationStatus.Equal);
      expect(result[1]!.correlationStatus).toBe(CorrelationStatus.Equal);
    });

    it('groups alternating Deleted/Inserted: deletions first, then insertions', () => {
      const d1 = createMockAtom({ correlationStatus: CorrelationStatus.Deleted });
      const i1 = createMockAtom({ correlationStatus: CorrelationStatus.Inserted });
      const d2 = createMockAtom({ correlationStatus: CorrelationStatus.Deleted });
      const i2 = createMockAtom({ correlationStatus: CorrelationStatus.Inserted });
      const result = groupDeletionsBeforeInsertions([d1, i1, d2, i2]);
      expect(result.map((a) => a.correlationStatus)).toEqual([
        CorrelationStatus.Deleted,
        CorrelationStatus.Deleted,
        CorrelationStatus.Inserted,
        CorrelationStatus.Inserted,
      ]);
    });

    it('preserves Equal atoms between change blocks', () => {
      const d = createMockAtom({ correlationStatus: CorrelationStatus.Deleted });
      const eq = createMockAtom({ correlationStatus: CorrelationStatus.Equal });
      const i = createMockAtom({ correlationStatus: CorrelationStatus.Inserted });
      const result = groupDeletionsBeforeInsertions([d, eq, i]);
      expect(result.map((a) => a.correlationStatus)).toEqual([
        CorrelationStatus.Deleted,
        CorrelationStatus.Equal,
        CorrelationStatus.Inserted,
      ]);
    });

    it('groups MovedSource before MovedDestination', () => {
      const ms = createMockAtom({ correlationStatus: CorrelationStatus.MovedSource });
      const md = createMockAtom({ correlationStatus: CorrelationStatus.MovedDestination });
      const result = groupDeletionsBeforeInsertions([md, ms]);
      expect(result.map((a) => a.correlationStatus)).toEqual([
        CorrelationStatus.MovedSource,
        CorrelationStatus.MovedDestination,
      ]);
    });

    it('handles empty array', () => {
      expect(groupDeletionsBeforeInsertions([])).toEqual([]);
    });

    it('handles single deletion atom', () => {
      const d = createMockAtom({ correlationStatus: CorrelationStatus.Deleted });
      const result = groupDeletionsBeforeInsertions([d]);
      expect(result).toHaveLength(1);
      expect(result[0]!.correlationStatus).toBe(CorrelationStatus.Deleted);
    });

    it('handles FormatChanged as a block boundary', () => {
      const d = createMockAtom({ correlationStatus: CorrelationStatus.Deleted });
      const fc = createMockAtom({ correlationStatus: CorrelationStatus.FormatChanged });
      const i = createMockAtom({ correlationStatus: CorrelationStatus.Inserted });
      const result = groupDeletionsBeforeInsertions([d, fc, i]);
      expect(result.map((a) => a.correlationStatus)).toEqual([
        CorrelationStatus.Deleted,
        CorrelationStatus.FormatChanged,
        CorrelationStatus.Inserted,
      ]);
    });
  });

  describe('preSplitInterleavedWordRuns', () => {
    it('is a no-op for empty atom list', () => {
      const atoms: ComparisonUnitAtom[] = [];
      preSplitInterleavedWordRuns(atoms);
      expect(atoms).toEqual([]);
    });

    it('is a no-op when no interleaving exists (all atoms from different runs)', () => {
      const run1 = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
      const run2 = el('w:r', {}, [el('w:t', {}, undefined, 'world')]);
      el('w:p', {}, [run1, run2]);

      const atoms = [
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

      preSplitInterleavedWordRuns(atoms);
      // No split needed — atoms already from different runs
      expect(atoms[0]!.sourceRunElement).toBe(run1);
      expect(atoms[1]!.sourceRunElement).toBe(run2);
    });

    it('skips atoms with no sourceRunElement', () => {
      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: undefined,
        }),
      ];
      preSplitInterleavedWordRuns(atoms);
      expect(atoms).toHaveLength(1);
    });

    it('skips Deleted atoms (original-tree)', () => {
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'hello world')]);
      el('w:p', {}, [run]);

      const atoms = [
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

      preSplitInterleavedWordRuns(atoms);
      // Deleted atoms are from original tree, not revised — no split
      expect(atoms[0]!.sourceRunElement).toBe(run);
      expect(atoms[1]!.sourceRunElement).toBe(run);
    });

    it('splits run when Deleted atom interleaves between Equal atoms from same run', () => {
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'helloworld')]);
      el('w:p', {}, [run]);

      const equalAtom1 = createMockAtom({
        correlationStatus: CorrelationStatus.Equal,
        sourceRunElement: run,
        contentElement: el('w:t', {}, undefined, 'hello'),
      });
      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: el('w:r'), // from original tree
        contentElement: el('w:t', {}, undefined, 'DELETED'),
      });
      const equalAtom2 = createMockAtom({
        correlationStatus: CorrelationStatus.Equal,
        sourceRunElement: run,
        contentElement: el('w:t', {}, undefined, 'world'),
      });

      const atoms = [equalAtom1, deletedAtom, equalAtom2];
      preSplitInterleavedWordRuns(atoms);

      // The run should have been split — equalAtom1 and equalAtom2 now point to different elements
      expect(equalAtom1.sourceRunElement).not.toBe(equalAtom2.sourceRunElement);
    });

    it('skips atoms with collapsedFieldAtoms', () => {
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'hello')]);
      el('w:p', {}, [run]);

      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: run,
          contentElement: el('w:t', {}, undefined, 'hello'),
          collapsedFieldAtoms: [createMockAtom()],
        }),
      ];

      preSplitInterleavedWordRuns(atoms);
      expect(atoms[0]!.sourceRunElement).toBe(run);
    });

    it('skips field character content elements', () => {
      const run = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
      el('w:p', {}, [run]);

      const atoms = [
        createMockAtom({
          correlationStatus: CorrelationStatus.Equal,
          sourceRunElement: run,
          contentElement: el('w:fldChar', { 'w:fldCharType': 'begin' }),
        }),
      ];

      preSplitInterleavedWordRuns(atoms);
      expect(atoms[0]!.sourceRunElement).toBe(run);
    });
  });

  describe('suppressNoOpChangePairs', () => {
    it('unwraps adjacent w:del + w:ins with identical text and no rPr', () => {
      const delText = el('w:delText', {}, undefined, 'Section ');
      const delRun = el('w:r', {}, [delText]);
      const wDel = el('w:del', { 'w:author': 'Author', 'w:date': '2025-01-01T00:00:00Z' }, [delRun]);

      const insText = el('w:t', {}, undefined, 'Section ');
      const insRun = el('w:r', {}, [insText]);
      const wIns = el('w:ins', { 'w:author': 'Author', 'w:date': '2025-01-01T00:00:00Z' }, [insRun]);

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(1);
      expect(pChildren[0]!.tagName).toBe('w:r');
    });

    it('unwraps w:del + w:ins with identical text and identical rPr', () => {
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

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(1);
      expect(pChildren[0]!.tagName).toBe('w:r');
    });

    it('preserves w:del + w:ins when text differs', () => {
      const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'old')]),
      ]);
      const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'new')]),
      ]);

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:del');
      expect(pChildren[1]!.tagName).toBe('w:ins');
    });

    it('preserves w:del + w:ins when formatting differs', () => {
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

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:del');
      expect(pChildren[1]!.tagName).toBe('w:ins');
    });

    it('preserves w:del + w:ins when non-text structure differs', () => {
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

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
    });

    it('handles multi-run no-op pairs', () => {
      const wDel = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'first ')]),
        el('w:r', {}, [el('w:delText', {}, undefined, 'second')]),
      ]);
      const wIns = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'first ')]),
        el('w:r', {}, [el('w:t', {}, undefined, 'second')]),
      ]);

      const p = el('w:p', {}, [wDel, wIns]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:r');
      expect(pChildren[1]!.tagName).toBe('w:r');
    });

    it('does not skip subsequent pairs after mutation', () => {
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

      const p = el('w:p', {}, [wDel1, wIns1, wDel2, wIns2]);
      const body = el('w:body', {}, [p]);

      suppressNoOpChangePairs(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:r');
      expect(pChildren[1]!.tagName).toBe('w:r');
    });
  });

  describe('mergeWhitespaceBridgedTrackChanges', () => {
    it('does not merge w:del siblings (del bridging is unsafe for accept projection)', () => {
      const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
      ]);
      const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
      const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
      ]);

      const p = el('w:p', {}, [delA, spaceRun, delB]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      // Dels should NOT be merged — the intervening whitespace is Equal content
      // needed by the accept projection
      const dels = childElements(p).filter(c => c.tagName === 'w:del');
      expect(dels.length).toBe(2);
    });

    it('merges w:ins siblings bridged by whitespace-only run', () => {
      const insA = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'X')]),
      ]);
      const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
      const insB = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'Y')]),
      ]);

      const p = el('w:p', {}, [insA, spaceRun, insB]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      const pChildren = childElements(p);
      const inses = pChildren.filter(c => c.tagName === 'w:ins');
      expect(inses.length).toBe(1);
      // Should contain: original run + whitespace run (moved) + second run
      const insChildren = childElements(inses[0]!);
      expect(insChildren.length).toBe(3);
    });

    it('does not merge when bridging run has non-whitespace text', () => {
      const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
      ]);
      const wordRun = el('w:r', {}, [el('w:t', {}, undefined, 'word')]);
      const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
      ]);

      const p = el('w:p', {}, [delA, wordRun, delB]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      const dels = childElements(p).filter(c => c.tagName === 'w:del');
      expect(dels.length).toBe(2);
    });

    it('does not merge when bridging run has w:tab', () => {
      const delA = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
      ]);
      const tabRun = el('w:r', {}, [el('w:tab')]);
      const delB = el('w:del', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
      ]);

      const p = el('w:p', {}, [delA, tabRun, delB]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      const dels = childElements(p).filter(c => c.tagName === 'w:del');
      expect(dels.length).toBe(2);
    });

    it('does not merge across different authors', () => {
      const delA = el('w:del', { 'w:author': 'Author1', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'A')]),
      ]);
      const spaceRun = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
      const delB = el('w:del', { 'w:author': 'Author2', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:delText', {}, undefined, 'B')]),
      ]);

      const p = el('w:p', {}, [delA, spaceRun, delB]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      const dels = childElements(p).filter(c => c.tagName === 'w:del');
      expect(dels.length).toBe(2);
    });

    it('accept/reject projection is correct after ins merge', () => {
      // Only ins siblings get bridged (del bridging is unsafe)
      const insX = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'X')]),
      ]);
      const space = el('w:r', {}, [el('w:t', {}, undefined, ' ')]);
      const insY = el('w:ins', { 'w:author': 'A', 'w:date': '2025-01-01T00:00:00Z' }, [
        el('w:r', {}, [el('w:t', {}, undefined, 'Y')]),
      ]);

      const p = el('w:p', {}, [insX, space, insY]);
      const body = el('w:body', {}, [p]);

      mergeWhitespaceBridgedTrackChanges(body);

      // Ins siblings should be merged with whitespace moved inside
      const inses = childElements(p).filter(c => c.tagName === 'w:ins');
      expect(inses.length).toBe(1);
      const insTextContent = findAllByTagName(inses[0]!, 'w:t').map(e => e.textContent).join('');
      expect(insTextContent).toBe('X Y');
    });
  });

  describe('runHasVisibleContent', () => {
    it('returns true for run with w:t', () => {
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'text')]);
      expect(runHasVisibleContent(run)).toBe(true);
    });

    it('returns true for run with w:tab', () => {
      const run = el('w:r', {}, [el('w:tab')]);
      expect(runHasVisibleContent(run)).toBe(true);
    });

    it('returns false for run with only w:rPr', () => {
      const run = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
      expect(runHasVisibleContent(run)).toBe(false);
    });

    it('returns false for empty run', () => {
      const run = el('w:r');
      expect(runHasVisibleContent(run)).toBe(false);
    });

    it('returns true for run with w:fldChar', () => {
      const run = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
      expect(runHasVisibleContent(run)).toBe(true);
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

    it('coalesces basic del-ins pair chain', () => {
      const del1 = makeDel('A');
      const ins1 = makeIns('X');
      const space = wsRun();
      const del2 = makeDel('B');
      const ins2 = makeIns('Y');

      const p = el('w:p', {}, [del1, ins1, space, del2, ins2]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:del');
      expect(pChildren[1]!.tagName).toBe('w:ins');

      // Del should contain: run(A), run(delText:" "), run(B)
      const delRuns = childElements(pChildren[0]!).filter(c => c.tagName === 'w:r');
      expect(delRuns.length).toBe(3);

      // Ins should contain: run(X), run(t:" "), run(Y)
      const insRuns = childElements(pChildren[1]!).filter(c => c.tagName === 'w:r');
      expect(insRuns.length).toBe(3);
    });

    it('coalesces 3+ pair chain', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      expect(pChildren[0]!.tagName).toBe('w:del');
      expect(pChildren[1]!.tagName).toBe('w:ins');
    });

    it('handles multi-run whitespace segment', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), wsRun(' '), wsRun(' '), makeDel('B'), makeIns('Y'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const pChildren = childElements(p);
      expect(pChildren.length).toBe(2);
      // Del should have: run(A) + 2 ws clones + run(B) = 4 runs
      const delRuns = childElements(pChildren[0]!).filter(c => c.tagName === 'w:r');
      expect(delRuns.length).toBe(4);
    });

    it('does not bridge non-whitespace', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'),
        el('w:r', {}, [el('w:t', {}, undefined, 'word')]),
        makeDel('B'), makeIns('Y'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      // Should remain unchanged — 5 children
      expect(childElements(p).length).toBe(5);
    });

    it('does not bridge different authors', () => {
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

      const p = el('w:p', {}, [del1, ins1, wsRun(), del2, ins2]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      // Should remain unchanged — 5 children
      expect(childElements(p).length).toBe(5);
    });

    it('does not coalesce single pair', () => {
      const p = el('w:p', {}, [makeDel('A'), makeIns('X')]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      expect(childElements(p).length).toBe(2);
    });

    it('does not bridge incomplete tail (del without ins)', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), wsRun(), makeDel('B'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      // Should remain unchanged — 4 children
      expect(childElements(p).length).toBe(4);
    });

    it('accept projection correct — ins text is "X Y Z"', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const ins = childElements(p).find(c => c.tagName === 'w:ins')!;
      const insText = findAllByTagName(ins, 'w:t').map(e => e.textContent).join('');
      expect(insText).toBe('X Y Z');
    });

    it('reject projection correct — del text is "A B C"', () => {
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), wsRun(), makeDel('B'), makeIns('Y'), wsRun(), makeDel('C'), makeIns('Z'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const del = childElements(p).find(c => c.tagName === 'w:del')!;
      const delText = findAllByTagName(del, 'w:delText').map(e => e.textContent).join('');
      expect(delText).toBe('A B C');
    });

    it('does not bridge across w:tab', () => {
      const tabRun = el('w:r', {}, [el('w:tab')]);
      const p = el('w:p', {}, [
        makeDel('A'), makeIns('X'), tabRun, makeDel('B'), makeIns('Y'),
      ]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      // Should remain unchanged — 5 children
      expect(childElements(p).length).toBe(5);
    });

    it('preserves xml:space on cloned delText', () => {
      const spaceRun = el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, ' ')]);
      const p = el('w:p', {}, [makeDel('A'), makeIns('X'), spaceRun, makeDel('B'), makeIns('Y')]);
      const body = el('w:body', {}, [p]);

      coalesceDelInsPairChains(body);

      const del = childElements(p).find(c => c.tagName === 'w:del')!;
      const delTexts = findAllByTagName(del, 'w:delText');
      // The space clone should have xml:space="preserve"
      const spaceDelText = delTexts.find(e => e.textContent === ' ');
      expect(spaceDelText).toBeDefined();
      expect(spaceDelText!.getAttribute('xml:space')).toBe('preserve');
    });
  });
});
