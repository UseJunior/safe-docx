/**
 * Allure-style Tests for In-Place AST Modifier
 *
 * Tests the in-place document modification operations using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { itAllure, allureStep, allureJsonAttachment } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  wrapAsInserted,
  wrapAsDeleted,
  insertDeletedRun,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  addFormatChange,
  addParagraphPropertyChange,
  wrapParagraphAsInserted,
  wrapParagraphAsDeleted,
  createRevisionIdState,
} from './inPlaceModifier.js';
import { childElements } from '../../primitives/index.js';
import { el } from '../../testing/dom-test-helpers.js';
import { assertDefined } from '../../testing/test-utils.js';

const it = itAllure.epic('Document Comparison').withLabels({
  feature: 'In-Place AST Modification',
});

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

describe('In-Place AST Modifier', () => {
  const author = 'Test Author';
  const dateStr = '2025-01-01T00:00:00Z';

  describe('Insertion Wrapping', () => {
    const insertionIt = it.allure({ story: 'Insertion Wrapping', severity: 'critical' });

    insertionIt('should wrap a run element with w:ins to mark it as inserted', async () => {
      let p: Element;
      let r: Element;
      let result: boolean;

      await allureStep('Given a paragraph with a run containing "inserted text"', async () => {
        const t = el('w:t', {}, undefined, 'inserted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        await allureJsonAttachment('Initial structure', {
          paragraph: { children: ['w:r'] },
          run: { children: ['w:t'], text: 'inserted text' },
        });
      });

      await allureStep('When wrapAsInserted is called on the run', async () => {
        const state = createRevisionIdState();
        result = wrapAsInserted(r, author, dateStr, state);
      });

      await allureStep('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allureStep('And the paragraph now has w:ins as its child', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.tagName).toBe('w:ins');
      });

      await allureStep('And w:ins has the correct author attribute', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:author')).toBe(author);
      });

      await allureStep('And w:ins has the correct date attribute', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:date')).toBe(dateStr);
      });

      await allureStep('And w:ins has a unique revision ID', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:id')).toBe('1');
      });

      await allureStep('And w:ins contains the original run', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        const insChildren = childElements(ins);
        expect(insChildren[0]).toBe(r);
      });
    });

    const insertionNormalIt = it.allure({ story: 'Insertion Wrapping', severity: 'normal' });

    insertionNormalIt('should not wrap the same run twice', async () => {
      let r: Element;
      let firstResult: boolean;
      let secondResult: boolean;

      await allureStep('Given a run element that has already been wrapped', async () => {
        r = el('w:r');
        el('w:p', {}, [r]); // parent needed for DOM tree structure

        const state = createRevisionIdState();
        firstResult = wrapAsInserted(r, author, dateStr, state);
        secondResult = wrapAsInserted(r, author, dateStr, state);
      });

      await allureStep('Then the first wrap succeeds', async () => {
        expect(firstResult).toBe(true);
      });

      await allureStep('And the second wrap is skipped', async () => {
        expect(secondResult).toBe(false);
      });
    });

    insertionNormalIt('should increment revision IDs for each wrapped run', async () => {
      let p: Element;

      await allureStep('Given a paragraph with two runs', async () => {
        const r1 = el('w:r');
        const r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);

        const state = createRevisionIdState();
        wrapAsInserted(r1, author, dateStr, state);
        wrapAsInserted(r2, author, dateStr, state);
      });

      await allureStep('Then first wrap has ID 1', async () => {
        const pChildren = childElements(p);
        const first = pChildren[0];
        assertDefined(first, 'p children[0]');
        expect(first.getAttribute('w:id')).toBe('1');
      });

      await allureStep('And second wrap has ID 2', async () => {
        const pChildren = childElements(p);
        const second = pChildren[1];
        assertDefined(second, 'p children[1]');
        expect(second.getAttribute('w:id')).toBe('2');
      });
    });
  });

  describe('Deletion Wrapping', () => {
    const deletionIt = it.allure({ story: 'Deletion Wrapping', severity: 'critical' });

    deletionIt('should wrap a run element with w:del and convert w:t to w:delText', async () => {
      let p: Element;
      let r: Element;
      let t: Element;
      let result: boolean;

      await allureStep('Given a paragraph with a run containing "deleted text"', async () => {
        t = el('w:t', {}, undefined, 'deleted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
      });

      await allureStep('When wrapAsDeleted is called on the run', async () => {
        const state = createRevisionIdState();
        result = wrapAsDeleted(r, author, dateStr, state);
      });

      await allureStep('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allureStep('And the paragraph now has w:del as its child', async () => {
        const pChildren = childElements(p);
        const del = pChildren[0];
        assertDefined(del, 'p children[0]');
        expect(del.tagName).toBe('w:del');
      });

      await allureStep('And w:del contains the original run', async () => {
        const pChildren = childElements(p);
        const del = pChildren[0];
        assertDefined(del, 'p children[0]');
        const delChildren = childElements(del);
        expect(delChildren[0]).toBe(r);
      });

      await allureStep('And w:t has been converted to w:delText', async () => {
        // After conversion, the original t element is replaced in the DOM.
        // Find the delText within the run.
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.tagName).toBe('w:delText');
      });

      await allureStep('And the text content is preserved', async () => {
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('deleted text');
      });
    });
  });

  describe('Deleted Run Insertion', () => {
    const deletedInsertionIt = it.allure({ story: 'Deleted Content Insertion', severity: 'critical' });

    deletedInsertionIt('should clone and insert a deleted run after an existing run', async () => {
      let targetP: Element;
      let existingR: Element;
      let result: Element | null;

      await allureStep('Given a deleted run "deleted" in the original document', async () => {
        const originalT = el('w:t', {}, undefined, 'deleted');
        const originalR = el('w:r', { id: 'original' }, [originalT]);
        const originalP = el('w:p', {}, [originalR]);

        // Create target paragraph
        const existingT = el('w:t', {}, undefined, 'existing');
        existingR = el('w:r', {}, [existingT]);
        targetP = el('w:p', {}, [existingR]);

        const deletedAtom = createMockAtom({
          correlationStatus: CorrelationStatus.Deleted,
          sourceRunElement: originalR,
          sourceParagraphElement: originalP,
        });

        const state = createRevisionIdState();
        result = insertDeletedRun(deletedAtom, existingR, targetP, author, dateStr, state);
      });

      await allureStep('Then a w:del element is created', async () => {
        expect(result).not.toBeNull();
        expect(result!.tagName).toBe('w:del');
      });

      await allureStep('And it is inserted after the existing run', async () => {
        const targetChildren = childElements(targetP);
        expect(targetChildren).toHaveLength(2);
        expect(targetChildren[1]).toBe(result);
      });

      await allureStep('And it contains a cloned run with w:delText', async () => {
        assertDefined(result, 'result');
        const resultChildren = childElements(result);
        const clonedRun = resultChildren[0];
        assertDefined(clonedRun, 'result children[0]');
        expect(clonedRun.tagName).toBe('w:r');
        const clonedRunChildren = childElements(clonedRun);
        const delText = clonedRunChildren[0];
        assertDefined(delText, 'clonedRun children[0]');
        expect(delText.tagName).toBe('w:delText');
      });
    });

    const deletedInsertionNormalIt = it.allure({ story: 'Deleted Content Insertion', severity: 'normal' });

    deletedInsertionNormalIt('should insert after pPr when insertAfterRun is null', async () => {
      let targetP: Element;
      let pPr: Element;
      let result: Element | null;

      await allureStep('Given a target paragraph with pPr and a run', async () => {
        const originalR = el('w:r');
        el('w:p', {}, [originalR]); // parent needed for DOM tree structure

        pPr = el('w:pPr');
        const existingR = el('w:r');
        targetP = el('w:p', {}, [pPr, existingR]);

        const deletedAtom = createMockAtom({
          sourceRunElement: originalR,
        });

        const state = createRevisionIdState();
        result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);
      });

      await allureStep('Then the order is: pPr, del, existingR', async () => {
        const targetChildren = childElements(targetP);
        expect(targetChildren[0]).toBe(pPr);
        expect(targetChildren[1]).toBe(result);
        const third = targetChildren[2];
        assertDefined(third, 'targetP children[2]');
        expect(third.tagName).toBe('w:r');
      });
    });
  });

  describe('Move Tracking', () => {
    const moveIt = it.allure({ story: 'Move Tracking', severity: 'critical' });

    moveIt('should wrap moveFrom with range markers and convert to delText', async () => {
      let p: Element;
      let r: Element;
      let result: boolean;

      await allureStep('Given a paragraph with a run to be marked as move source', async () => {
        const t = el('w:t', {}, undefined, 'moved text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);

        const state = createRevisionIdState();
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await allureStep('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allureStep('And the structure is: rangeStart, moveFrom, rangeEnd', async () => {
        const pChildren = childElements(p);
        expect(pChildren).toHaveLength(3);
        const rangeStart = pChildren[0];
        assertDefined(rangeStart, 'p children[0]');
        expect(rangeStart.tagName).toBe('w:moveFromRangeStart');
        const moveFrom = pChildren[1];
        assertDefined(moveFrom, 'p children[1]');
        expect(moveFrom.tagName).toBe('w:moveFrom');
        const rangeEnd = pChildren[2];
        assertDefined(rangeEnd, 'p children[2]');
        expect(rangeEnd.tagName).toBe('w:moveFromRangeEnd');
      });

      await allureStep('And the move name is set correctly', async () => {
        const pChildren = childElements(p);
        const rangeStart = pChildren[0];
        assertDefined(rangeStart, 'p children[0]');
        expect(rangeStart.getAttribute('w:name')).toBe('move1');
      });

      await allureStep('And w:t is converted to w:delText', async () => {
        // After conversion, find the delText within the run
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.tagName).toBe('w:delText');
      });
    });

    moveIt('should wrap moveTo with range markers and keep w:t', async () => {
      let p: Element;
      let t: Element;

      await allureStep('Given a paragraph with a run to be marked as move destination', async () => {
        t = el('w:t', {}, undefined, 'moved');
        const r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);

        const state = createRevisionIdState();
        wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await allureStep('Then the structure is: rangeStart, moveTo, rangeEnd', async () => {
        const pChildren = childElements(p);
        expect(pChildren).toHaveLength(3);
        const rangeStart = pChildren[0];
        assertDefined(rangeStart, 'p children[0]');
        expect(rangeStart.tagName).toBe('w:moveToRangeStart');
        const moveTo = pChildren[1];
        assertDefined(moveTo, 'p children[1]');
        expect(moveTo.tagName).toBe('w:moveTo');
        const rangeEnd = pChildren[2];
        assertDefined(rangeEnd, 'p children[2]');
        expect(rangeEnd.tagName).toBe('w:moveToRangeEnd');
      });

      await allureStep('And w:t is NOT converted (remains w:t)', async () => {
        expect(t.tagName).toBe('w:t');
      });
    });

    moveIt('should use linked range IDs for moveFrom and moveTo with same name', async () => {
      let p: Element;

      await allureStep('Given two runs wrapped as moveFrom and moveTo with same name', async () => {
        const r1 = el('w:r');
        const r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);

        const state = createRevisionIdState();
        wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
        wrapAsMoveTo(r2, 'move1', author, dateStr, state);
      });

      await allureStep('Then moveFromRangeStart has sourceRangeId', async () => {
        const pChildren = childElements(p);
        const moveFromStart = pChildren[0];
        assertDefined(moveFromStart, 'p children[0]');
        expect(moveFromStart.getAttribute('w:id')).toBe('1');
      });

      await allureStep('And moveToRangeStart has destRangeId', async () => {
        const pChildren = childElements(p);
        const moveToStart = pChildren[3];
        assertDefined(moveToStart, 'p children[3]');
        expect(moveToStart.getAttribute('w:id')).toBe('2');
      });
    });
  });

  describe('Format Change Tracking', () => {
    const formatIt = it.allure({ story: 'Format Change Tracking', severity: 'normal' });

    formatIt('should add rPrChange to existing rPr with old properties', async () => {
      let rPr: Element;

      await allureStep('Given a run with bold and italic formatting', async () => {
        rPr = el('w:rPr', {}, [
          el('w:b'),
          el('w:i'),
        ]);
        const t = el('w:t', {}, undefined, 'formatted');
        const r = el('w:r', {}, [rPr, t]);

        const oldRPr = el('w:rPr', {}, [el('w:b')]);

        const state = createRevisionIdState();
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await allureStep('Then rPr contains rPrChange', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        expect(rPrChange).toBeDefined();
      });

      await allureStep('And rPrChange has the correct author', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        expect(rPrChange.getAttribute('w:author')).toBe(author);
      });

      await allureStep('And rPrChange contains the old properties inside a w:rPr wrapper', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        const rPrChangeChildren = childElements(rPrChange);
        expect(rPrChangeChildren).toHaveLength(1);
        const oldRPr = rPrChangeChildren[0];
        assertDefined(oldRPr, 'rPrChange children[0]');
        expect(oldRPr.tagName).toBe('w:rPr');
        const oldProps = childElements(oldRPr);
        expect(oldProps).toHaveLength(1);
        expect(oldProps[0].tagName).toBe('w:b');
      });
    });

    formatIt('should create rPr if it does not exist', async () => {
      let r: Element;

      await allureStep('Given a run with no rPr', async () => {
        const t = el('w:t', {}, undefined, 'text');
        r = el('w:r', {}, [t]);

        const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);

        const state = createRevisionIdState();
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await allureStep('Then rPr is created', async () => {
        const rChildren = childElements(r);
        const rPr = rChildren[0];
        assertDefined(rPr, 'r children[0]');
        expect(rPr.tagName).toBe('w:rPr');
      });

      await allureStep('And it contains rPrChange', async () => {
        const rChildren = childElements(r);
        const rPr = rChildren[0];
        assertDefined(rPr, 'r children[0]');
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        expect(rPrChange).toBeDefined();
      });
    });
  });

  describe('Empty Paragraph Wrapping', () => {
    const paragraphIt = it.allure({ story: 'Empty Paragraph Handling', severity: 'normal' });

    paragraphIt('should be a no-op for inserted paragraphs (Google Docs compat — runs already wrapped)', async () => {
      let p: Element;
      let result: boolean;

      await allureStep('Given an empty paragraph in a body', async () => {
        const pPr = el('w:pPr');
        p = el('w:p', {}, [pPr]);
        el('w:body', {}, [p]);

        const state = createRevisionIdState();
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await allureStep('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allureStep('And pPr is unchanged (no paragraph-mark marker or pPrChange added)', async () => {
        const pChildren = childElements(p);
        const pPr = pChildren.find((c) => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        expect(rPr).toBeUndefined();
        const pPrChange = pPrChildren.find((c) => c.tagName === 'w:pPrChange');
        expect(pPrChange).toBeUndefined();
      });
    });

    paragraphIt('should add a paragraph-mark w:del marker in w:pPr/w:rPr for deleted empty paragraph', async () => {
      let body: Element;
      let p: Element;
      let result: boolean;

      await allureStep('Given an empty paragraph in a body', async () => {
        p = el('w:p');
        body = el('w:body', {}, [p]);

        const state = createRevisionIdState();
        result = wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await allureStep('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allureStep('And the body still contains the paragraph (no illegal <w:del><w:p> nesting)', async () => {
        const bodyChildren = childElements(body);
        const first = bodyChildren[0];
        assertDefined(first, 'body children[0]');
        expect(first.tagName).toBe('w:p');
      });

      await allureStep('And w:pPr/w:rPr contains a w:del paragraph-mark marker', async () => {
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

  describe('Paragraph Property Change', () => {
    const pPrChangeIt = it.allure({ story: 'Paragraph Property Change', severity: 'critical' });

    pPrChangeIt('should emit pPrChange with correct author and date', async () => {
      let p: Element;

      await allureStep('Given a paragraph with pPr containing jc alignment', async () => {
        const jc = el('w:jc', { 'w:val': 'center' });
        const pPr = el('w:pPr', {}, [jc]);
        p = el('w:p', {}, [pPr]);
      });

      await allureStep('When addParagraphPropertyChange is called', async () => {
        const state = createRevisionIdState();
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await allureStep('Then pPr contains w:pPrChange with correct attributes', async () => {
        const pPr = childElements(p).find(c => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChange = childElements(pPr).find(c => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        expect(pPrChange.getAttribute('w:author')).toBe(author);
        expect(pPrChange.getAttribute('w:date')).toBe(dateStr);
      });
    });

    pPrChangeIt('should exclude rPr, sectPr, and pPrChange from the pPrChange snapshot', async () => {
      let p: Element;

      await allureStep('Given a paragraph with pPr containing jc, rPr, and sectPr', async () => {
        const jc = el('w:jc', { 'w:val': 'center' });
        const rPr = el('w:rPr', {}, [el('w:b')]);
        const sectPr = el('w:sectPr');
        const pPr = el('w:pPr', {}, [jc, rPr, sectPr]);
        p = el('w:p', {}, [pPr]);
      });

      await allureStep('When addParagraphPropertyChange is called', async () => {
        const state = createRevisionIdState();
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await allureStep('Then the pPrChange inner pPr contains only jc (excludes rPr, sectPr)', async () => {
        const pPr = childElements(p).find(c => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChange = childElements(pPr).find(c => c.tagName === 'w:pPrChange');
        assertDefined(pPrChange, 'pPrChange');
        const innerPPr = childElements(pPrChange).find(c => c.tagName === 'w:pPr');
        assertDefined(innerPPr, 'inner pPr');
        const innerChildren = childElements(innerPPr);
        expect(innerChildren).toHaveLength(1);
        expect(innerChildren[0].tagName).toBe('w:jc');
      });
    });

    const pPrChangeNormalIt = it.allure({ story: 'Paragraph Property Change', severity: 'normal' });

    pPrChangeNormalIt('should be idempotent — calling twice does not duplicate pPrChange', async () => {
      let p: Element;

      await allureStep('Given a paragraph with pPr', async () => {
        const pPr = el('w:pPr', {}, [el('w:jc', { 'w:val': 'left' })]);
        p = el('w:p', {}, [pPr]);
      });

      await allureStep('When addParagraphPropertyChange is called twice', async () => {
        const state = createRevisionIdState();
        addParagraphPropertyChange(p, author, dateStr, state);
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await allureStep('Then pPr contains exactly one pPrChange', async () => {
        const pPr = childElements(p).find(c => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChanges = childElements(pPr).filter(c => c.tagName === 'w:pPrChange');
        expect(pPrChanges).toHaveLength(1);
      });
    });

    pPrChangeNormalIt('should place pPrChange after other pPr children (schema ordering)', async () => {
      let p: Element;

      await allureStep('Given a paragraph with pPr containing jc and rPr', async () => {
        const jc = el('w:jc', { 'w:val': 'right' });
        const rPr = el('w:rPr', {}, [el('w:i')]);
        const pPr = el('w:pPr', {}, [jc, rPr]);
        p = el('w:p', {}, [pPr]);
      });

      await allureStep('When addParagraphPropertyChange is called', async () => {
        const state = createRevisionIdState();
        addParagraphPropertyChange(p, author, dateStr, state);
      });

      await allureStep('Then pPrChange is the last child of pPr', async () => {
        const pPr = childElements(p).find(c => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChildren = childElements(pPr);
        const last = pPrChildren[pPrChildren.length - 1];
        assertDefined(last, 'last pPr child');
        expect(last.tagName).toBe('w:pPrChange');
      });
    });
  });
});
