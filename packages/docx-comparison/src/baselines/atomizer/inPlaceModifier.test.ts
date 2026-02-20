import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { WmlElement, ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  wrapAsInserted,
  wrapAsDeleted,
  insertDeletedRun,
  insertMoveFromRun,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  addFormatChange,
  wrapParagraphAsInserted,
  wrapParagraphAsDeleted,
  createRevisionIdState,
} from './inPlaceModifier.js';
import { backfillParentReferences, findAllByTagName } from './wmlElementUtils.js';
import { assertDefined } from '../../testing/test-utils.js';

/**
 * Helper to create a WmlElement.
 */
function createElement(
  tagName: string,
  attrs: Record<string, string> = {},
  children?: WmlElement[],
  textContent?: string
): WmlElement {
  const el: WmlElement = { tagName, attributes: attrs };
  if (children) el.children = children;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

/**
 * Create a mock atom for testing.
 */
function createMockAtom(overrides: Partial<ComparisonUnitAtom> = {}): ComparisonUnitAtom {
  const mockPart: OpcPart = {
    uri: 'word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  };

  return {
    contentElement: createElement('w:t', {}, undefined, 'text'),
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
      const t = createElement('w:t', {}, undefined, 'inserted text');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      const result = wrapAsInserted(r, author, dateStr, state);

      expect(result).toBe(true);
      // p should now have ins as child
      assertDefined(p.children, 'p.children');
      const ins = p.children[0];
      assertDefined(ins, 'p.children[0]');
      expect(ins.tagName).toBe('w:ins');
      expect(ins.attributes['w:author']).toBe(author);
      expect(ins.attributes['w:date']).toBe(dateStr);
      expect(ins.attributes['w:id']).toBe('1');
      // ins should have r as child
      assertDefined(ins.children, 'ins.children');
      expect(ins.children[0]).toBe(r);
    });

    it('should not wrap the same run twice', () => {
      const r = createElement('w:r');
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsInserted(r, author, dateStr, state);
      const result = wrapAsInserted(r, author, dateStr, state);

      expect(result).toBe(false);
    });

    it('should increment revision IDs', () => {
      const r1 = createElement('w:r');
      const r2 = createElement('w:r');
      const p = createElement('w:p', {}, [r1, r2]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsInserted(r1, author, dateStr, state);
      wrapAsInserted(r2, author, dateStr, state);

      assertDefined(p.children, 'p.children');
      const first = p.children[0];
      assertDefined(first, 'p.children[0]');
      expect(first.attributes['w:id']).toBe('1');
      const second = p.children[1];
      assertDefined(second, 'p.children[1]');
      expect(second.attributes['w:id']).toBe('2');
    });
  });

  describe('wrapAsDeleted', () => {
    it('should wrap a run element with w:del', () => {
      const t = createElement('w:t', {}, undefined, 'deleted text');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      const result = wrapAsDeleted(r, author, dateStr, state);

      expect(result).toBe(true);
      assertDefined(p.children, 'p.children');
      const del = p.children[0];
      assertDefined(del, 'p.children[0]');
      expect(del.tagName).toBe('w:del');
      assertDefined(del.children, 'del.children');
      expect(del.children[0]).toBe(r);
    });

    it('should convert w:t to w:delText', () => {
      const t = createElement('w:t', {}, undefined, 'deleted text');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsDeleted(r, author, dateStr, state);

      expect(t.tagName).toBe('w:delText');
      expect(t.textContent).toBe('deleted text');
    });
  });

  describe('insertDeletedRun', () => {
    it('should clone and insert a deleted run', () => {
      // Create the original (deleted) run
      const originalT = createElement('w:t', {}, undefined, 'deleted');
      const originalR = createElement('w:r', { id: 'original' }, [originalT]);
      const originalP = createElement('w:p', {}, [originalR]);
      backfillParentReferences(originalP);

      // Create the target paragraph
      const existingT = createElement('w:t', {}, undefined, 'existing');
      const existingR = createElement('w:r', {}, [existingT]);
      const targetP = createElement('w:p', {}, [existingR]);
      backfillParentReferences(targetP);

      // Create a mock deleted atom
      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
        sourceParagraphElement: originalP,
        contentElement: createElement('w:t', {}, undefined, 'deleted'),
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);

      assertDefined(result, 'result');
      expect(result.tagName).toBe('w:del');
      // Should be inserted after existingR
      expect(targetP.children).toHaveLength(2);
      assertDefined(targetP.children, 'targetP.children');
      expect(targetP.children[1]).toBe(result);
      // The cloned run should be inside the del
      assertDefined(result.children, 'result.children');
      const clonedRun = result.children[0];
      assertDefined(clonedRun, 'result.children[0]');
      expect(clonedRun.tagName).toBe('w:r');
      // The text should be converted to delText
      assertDefined(clonedRun.children, 'clonedRun.children');
      const delText = clonedRun.children[0];
      assertDefined(delText, 'clonedRun.children[0]');
      expect(delText.tagName).toBe('w:delText');
    });

    it('should insert only the deleted atom fragment, not the full source run text', () => {
      const originalRPr = createElement('w:rPr', {}, [createElement('w:b')]);
      const originalT = createElement('w:t', {}, undefined, 'prefix and deleted token');
      const originalR = createElement('w:r', { id: 'original' }, [originalRPr, originalT]);
      const originalP = createElement('w:p', {}, [originalR]);
      backfillParentReferences(originalP);

      const existingR = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'existing')]);
      const targetP = createElement('w:p', {}, [existingR]);
      backfillParentReferences(targetP);

      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
        sourceParagraphElement: originalP,
        contentElement: createElement('w:t', {}, undefined, 'deleted token'),
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);

      assertDefined(result, 'result');
      assertDefined(result.children, 'result.children');
      const insertedRun = result.children[0];
      assertDefined(insertedRun, 'result.children[0]');
      expect(insertedRun.tagName).toBe('w:r');
      expect(insertedRun.children?.some((c) => c.tagName === 'w:rPr')).toBe(true);
      const delText = insertedRun.children?.find((c) => c.tagName === 'w:delText');
      assertDefined(delText, 'delText');
      expect(delText.textContent).toBe('deleted token');
      expect(delText.textContent).not.toContain('prefix and');
    });

    it('should insert at beginning if insertAfterRun is null', () => {
      const originalR = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'deleted')]);
      const originalP = createElement('w:p', {}, [originalR]);
      backfillParentReferences(originalP);

      const existingR = createElement('w:r');
      const targetP = createElement('w:p', {}, [existingR]);
      backfillParentReferences(targetP);

      const deletedAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: originalR,
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);

      expect(result).not.toBeNull();
      // Should be at the beginning
      assertDefined(targetP.children, 'targetP.children');
      expect(targetP.children[0]).toBe(result);
    });

    it('should insert after pPr if present and insertAfterRun is null', () => {
      const originalR = createElement('w:r');
      const originalP = createElement('w:p', {}, [originalR]);
      backfillParentReferences(originalP);

      const pPr = createElement('w:pPr');
      const existingR = createElement('w:r');
      const targetP = createElement('w:p', {}, [pPr, existingR]);
      backfillParentReferences(targetP);

      const deletedAtom = createMockAtom({
        sourceRunElement: originalR,
      });

      const state = createRevisionIdState();
      const result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);

      expect(result).not.toBeNull();
      // Order should be: pPr, del, existingR
      assertDefined(targetP.children, 'targetP.children');
      expect(targetP.children[0]).toBe(pPr);
      expect(targetP.children[1]).toBe(result);
      expect(targetP.children[2]).toBe(existingR);
    });

    it('clones adjacent source bookmark markers once when the source run is split into multiple atoms', () => {
      const sourceStart = createElement('w:bookmarkStart', {
        'w:id': '10',
        'w:name': '_RefSplitDeleted',
      });
      const sourceRun = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'deleted text')]);
      const sourceEnd = createElement('w:bookmarkEnd', { 'w:id': '10' });
      const sourceP = createElement('w:p', {}, [sourceStart, sourceRun, sourceEnd]);
      backfillParentReferences(sourceP);

      const existingR = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'existing')]);
      const targetP = createElement('w:p', {}, [existingR]);
      backfillParentReferences(targetP);

      const firstAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: createElement('w:t', {}, undefined, 'deleted'),
      });
      const secondAtom = createMockAtom({
        correlationStatus: CorrelationStatus.Deleted,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: createElement('w:t', {}, undefined, ' text'),
      });

      const state = createRevisionIdState();
      const firstInsert = insertDeletedRun(firstAtom, existingR, targetP, author, dateStr, state);
      const secondInsert = insertDeletedRun(secondAtom, firstInsert, targetP, author, dateStr, state);

      expect(firstInsert).not.toBeNull();
      expect(secondInsert).not.toBeNull();

      const bookmarkStarts = findAllByTagName(targetP, 'w:bookmarkStart');
      const bookmarkEnds = findAllByTagName(targetP, 'w:bookmarkEnd');
      const startNames = bookmarkStarts.map((c) => c.attributes['w:name']);

      expect(bookmarkStarts).toHaveLength(1);
      expect(bookmarkEnds).toHaveLength(1);
      expect(startNames).toContain('_RefSplitDeleted');
    });
  });

  describe('insertMoveFromRun', () => {
    it('clones adjacent source bookmark markers once when source run is split', () => {
      const sourceStart = createElement('w:bookmarkStart', {
        'w:id': '11',
        'w:name': '_RefSplitMove',
      });
      const sourceRun = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'moved text')]);
      const sourceEnd = createElement('w:bookmarkEnd', { 'w:id': '11' });
      const sourceP = createElement('w:p', {}, [sourceStart, sourceRun, sourceEnd]);
      backfillParentReferences(sourceP);

      const existingR = createElement('w:r', {}, [createElement('w:t', {}, undefined, 'existing')]);
      const targetP = createElement('w:p', {}, [existingR]);
      backfillParentReferences(targetP);

      const firstAtom = createMockAtom({
        correlationStatus: CorrelationStatus.MovedSource,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: createElement('w:t', {}, undefined, 'moved'),
        moveName: 'move-split',
      });
      const secondAtom = createMockAtom({
        correlationStatus: CorrelationStatus.MovedSource,
        sourceRunElement: sourceRun,
        sourceParagraphElement: sourceP,
        contentElement: createElement('w:t', {}, undefined, ' text'),
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
      const startNames = bookmarkStarts.map((c) => c.attributes['w:name']);

      expect(bookmarkStarts).toHaveLength(1);
      expect(bookmarkEnds).toHaveLength(1);
      expect(startNames).toContain('_RefSplitMove');
    });
  });

  describe('wrapAsMoveFrom', () => {
    it('should wrap with moveFrom and add range markers', () => {
      const t = createElement('w:t', {}, undefined, 'moved text');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      const result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);

      expect(result).toBe(true);
      // Order: moveFromRangeStart, moveFrom (with r), moveFromRangeEnd
      assertDefined(p.children, 'p.children');
      expect(p.children).toHaveLength(3);
      const rangeStart = p.children[0];
      assertDefined(rangeStart, 'p.children[0]');
      expect(rangeStart.tagName).toBe('w:moveFromRangeStart');
      expect(rangeStart.attributes['w:name']).toBe('move1');
      const moveFrom = p.children[1];
      assertDefined(moveFrom, 'p.children[1]');
      expect(moveFrom.tagName).toBe('w:moveFrom');
      assertDefined(moveFrom.children, 'moveFrom.children');
      expect(moveFrom.children[0]).toBe(r);
      const rangeEnd = p.children[2];
      assertDefined(rangeEnd, 'p.children[2]');
      expect(rangeEnd.tagName).toBe('w:moveFromRangeEnd');
    });

    it('should convert w:t to w:delText for moved-from content', () => {
      const t = createElement('w:t', {}, undefined, 'moved');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsMoveFrom(r, 'move1', author, dateStr, state);

      expect(t.tagName).toBe('w:delText');
    });

    it('should use same range ID for same move name', () => {
      const r1 = createElement('w:r');
      const r2 = createElement('w:r');
      const p = createElement('w:p', {}, [r1, r2]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
      wrapAsMoveTo(r2, 'move1', author, dateStr, state);

      // Both should reference the same move range
      assertDefined(p.children, 'p.children');
      const rangeStart1 = p.children[0];
      assertDefined(rangeStart1, 'p.children[0]');
      const rangeStart2 = p.children[3]; // After moveFromRangeEnd
      assertDefined(rangeStart2, 'p.children[3]');
      expect(rangeStart1.attributes['w:id']).toBe('1'); // sourceRangeId
      expect(rangeStart2.attributes['w:id']).toBe('2'); // destRangeId
    });
  });

  describe('wrapAsMoveTo', () => {
    it('should wrap with moveTo and add range markers', () => {
      const t = createElement('w:t', {}, undefined, 'moved text');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      const result = wrapAsMoveTo(r, 'move1', author, dateStr, state);

      expect(result).toBe(true);
      assertDefined(p.children, 'p.children');
      expect(p.children).toHaveLength(3);
      const moveToStart = p.children[0];
      assertDefined(moveToStart, 'p.children[0]');
      expect(moveToStart.tagName).toBe('w:moveToRangeStart');
      const moveTo = p.children[1];
      assertDefined(moveTo, 'p.children[1]');
      expect(moveTo.tagName).toBe('w:moveTo');
      const moveToEnd = p.children[2];
      assertDefined(moveToEnd, 'p.children[2]');
      expect(moveToEnd.tagName).toBe('w:moveToRangeEnd');
    });

    it('should not convert w:t to w:delText for moved-to content', () => {
      const t = createElement('w:t', {}, undefined, 'moved');
      const r = createElement('w:r', {}, [t]);
      const p = createElement('w:p', {}, [r]);
      backfillParentReferences(p);

      const state = createRevisionIdState();
      wrapAsMoveTo(r, 'move1', author, dateStr, state);

      // moveTo content keeps w:t
      expect(t.tagName).toBe('w:t');
    });
  });

  describe('addFormatChange', () => {
    it('should add rPrChange to existing rPr', () => {
      const rPr = createElement('w:rPr', {}, [
        createElement('w:b'),
        createElement('w:i'),
      ]);
      const t = createElement('w:t', {}, undefined, 'formatted');
      const r = createElement('w:r', {}, [rPr, t]);
      backfillParentReferences(r);

      const oldRPr = createElement('w:rPr', {}, [
        createElement('w:b'),
      ]);

      const state = createRevisionIdState();
      addFormatChange(r, oldRPr, author, dateStr, state);

      // rPr should now contain rPrChange
      const rPrChange = rPr.children?.find(c => c.tagName === 'w:rPrChange');
      assertDefined(rPrChange, 'rPrChange');
      expect(rPrChange.attributes['w:author']).toBe(author);
      // Old properties should be cloned into rPrChange
      assertDefined(rPrChange.children, 'rPrChange.children');
      expect(rPrChange.children).toHaveLength(1);
      const oldProp = rPrChange.children[0];
      assertDefined(oldProp, 'rPrChange.children[0]');
      expect(oldProp.tagName).toBe('w:b');
    });

    it('should create rPr if it does not exist', () => {
      const t = createElement('w:t', {}, undefined, 'text');
      const r = createElement('w:r', {}, [t]);
      backfillParentReferences(r);

      const oldRPr = createElement('w:rPr', {}, [createElement('w:sz', { 'w:val': '24' })]);

      const state = createRevisionIdState();
      addFormatChange(r, oldRPr, author, dateStr, state);

      // rPr should be created
      assertDefined(r.children, 'r.children');
      const createdRPr = r.children[0];
      assertDefined(createdRPr, 'r.children[0]');
      expect(createdRPr.tagName).toBe('w:rPr');
      const rPrChange = createdRPr.children?.find(c => c.tagName === 'w:rPrChange');
      expect(rPrChange).toBeDefined();
    });
  });

  describe('wrapParagraphAsInserted', () => {
    it('should add a paragraph-mark w:ins marker in w:pPr/w:rPr (not wrap <w:p>)', () => {
      const pPr = createElement('w:pPr');
      const p = createElement('w:p', {}, [pPr]);
      const body = createElement('w:body', {}, [p]);
      backfillParentReferences(body);

      const state = createRevisionIdState();
      const result = wrapParagraphAsInserted(p, author, dateStr, state);

      expect(result).toBe(true);
      assertDefined(body.children, 'body.children');
      const bodyFirst = body.children[0];
      assertDefined(bodyFirst, 'body.children[0]');
      expect(bodyFirst.tagName).toBe('w:p');

      const rPr = pPr.children?.find((c) => c.tagName === 'w:rPr');
      assertDefined(rPr, 'rPr');
      const marker = rPr.children?.find((c) => c.tagName === 'w:ins');
      assertDefined(marker, 'marker');
      expect(marker.attributes['w:author']).toBe(author);
      expect(marker.attributes['w:date']).toBe(dateStr);
    });
  });

  describe('wrapParagraphAsDeleted', () => {
    it('should add a paragraph-mark w:del marker in w:pPr/w:rPr (not wrap <w:p>)', () => {
      const p = createElement('w:p');
      const body = createElement('w:body', {}, [p]);
      backfillParentReferences(body);

      const state = createRevisionIdState();
      const result = wrapParagraphAsDeleted(p, author, dateStr, state);

      expect(result).toBe(true);
      assertDefined(body.children, 'body.children');
      const bodyFirst = body.children[0];
      assertDefined(bodyFirst, 'body.children[0]');
      expect(bodyFirst.tagName).toBe('w:p');

      const pPr = p.children?.find((c) => c.tagName === 'w:pPr');
      assertDefined(pPr, 'pPr');
      const rPr = pPr.children?.find((c) => c.tagName === 'w:rPr');
      assertDefined(rPr, 'rPr');
      const marker = rPr.children?.find((c) => c.tagName === 'w:del');
      assertDefined(marker, 'marker');
      expect(marker.attributes['w:author']).toBe(author);
      expect(marker.attributes['w:date']).toBe(dateStr);
    });
  });
});
