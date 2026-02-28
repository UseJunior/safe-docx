import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  wrapAsInserted,
  wrapAsDeleted,
  insertDeletedRun,
  insertMoveFromRun,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  addFormatChange,
  addParagraphPropertyChange,
  wrapParagraphAsInserted,
  wrapParagraphAsDeleted,
  createRevisionIdState,
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
    it('should be a no-op that returns true (paragraph-mark markers omitted for Google Docs compat)', () => {
      const pPr = el('w:pPr');
      const p = el('w:p', {}, [pPr]);
      el('w:body', {}, [p]);

      const state = createRevisionIdState();
      const result = wrapParagraphAsInserted(p, author, dateStr, state);

      expect(result).toBe(true);

      // No paragraph-mark w:ins marker should be added
      const pPrChildren = childElements(pPr);
      const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
      expect(rPr).toBeUndefined();

      // No pPrChange should be added
      const pPrChange = pPrChildren.find((c) => c.tagName === 'w:pPrChange');
      expect(pPrChange).toBeUndefined();
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
  });
});
