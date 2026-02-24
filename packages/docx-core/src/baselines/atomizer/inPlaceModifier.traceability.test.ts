/**
 * Allure-style Tests for In-Place AST Modifier
 *
 * Tests the in-place document modification operations using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import {
  wrapAsInserted,
  wrapAsDeleted,
  insertDeletedRun,
  wrapAsMoveFrom,
  wrapAsMoveTo,
  addFormatChange,
  wrapParagraphAsInserted,
  wrapParagraphAsDeleted,
  createRevisionIdState,
} from './inPlaceModifier.js';
import { childElements } from '../../primitives/index.js';
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

describe('In-Place AST Modifier', () => {
  const author = 'Test Author';
  const dateStr = '2025-01-01T00:00:00Z';

  describe('Insertion Wrapping', () => {
    it('should wrap a run element with w:ins to mark it as inserted', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Insertion Wrapping');
      await allure.severity('critical');
      await allure.description(`
        When content is inserted into the revised document, the run element
        should be wrapped with <w:ins> to mark it as inserted track change.
      `);

      let p: Element;
      let r: Element;
      let result: boolean;

      await allure.step('Given a paragraph with a run containing "inserted text"', async () => {
        const t = el('w:t', {}, undefined, 'inserted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
        await allure.attachment('Initial structure', JSON.stringify({
          paragraph: { children: ['w:r'] },
          run: { children: ['w:t'], text: 'inserted text' },
        }, null, 2), 'application/json');
      });

      await allure.step('When wrapAsInserted is called on the run', async () => {
        const state = createRevisionIdState();
        result = wrapAsInserted(r, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the paragraph now has w:ins as its child', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.tagName).toBe('w:ins');
      });

      await allure.step('And w:ins has the correct author attribute', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:author')).toBe(author);
      });

      await allure.step('And w:ins has the correct date attribute', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:date')).toBe(dateStr);
      });

      await allure.step('And w:ins has a unique revision ID', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        expect(ins.getAttribute('w:id')).toBe('1');
      });

      await allure.step('And w:ins contains the original run', async () => {
        const pChildren = childElements(p);
        const ins = pChildren[0];
        assertDefined(ins, 'p children[0]');
        const insChildren = childElements(ins);
        expect(insChildren[0]).toBe(r);
      });
    });

    it('should not wrap the same run twice', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Insertion Wrapping');
      await allure.severity('normal');
      await allure.description(`
        The modifier should track which runs have been wrapped and skip
        wrapping the same run twice to prevent nested track changes.
      `);

      let r: Element;
      let firstResult: boolean;
      let secondResult: boolean;

      await allure.step('Given a run element that has already been wrapped', async () => {
        r = el('w:r');
        el('w:p', {}, [r]); // parent needed for DOM tree structure

        const state = createRevisionIdState();
        firstResult = wrapAsInserted(r, author, dateStr, state);
        secondResult = wrapAsInserted(r, author, dateStr, state);
      });

      await allure.step('Then the first wrap succeeds', async () => {
        expect(firstResult).toBe(true);
      });

      await allure.step('And the second wrap is skipped', async () => {
        expect(secondResult).toBe(false);
      });
    });

    it('should increment revision IDs for each wrapped run', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Insertion Wrapping');
      await allure.severity('normal');
      await allure.description(`
        Each wrapped run should get a unique revision ID, incrementing
        from 1 for each new track change element.
      `);

      let p: Element;

      await allure.step('Given a paragraph with two runs', async () => {
        const r1 = el('w:r');
        const r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);

        const state = createRevisionIdState();
        wrapAsInserted(r1, author, dateStr, state);
        wrapAsInserted(r2, author, dateStr, state);
      });

      await allure.step('Then first wrap has ID 1', async () => {
        const pChildren = childElements(p);
        const first = pChildren[0];
        assertDefined(first, 'p children[0]');
        expect(first.getAttribute('w:id')).toBe('1');
      });

      await allure.step('And second wrap has ID 2', async () => {
        const pChildren = childElements(p);
        const second = pChildren[1];
        assertDefined(second, 'p children[1]');
        expect(second.getAttribute('w:id')).toBe('2');
      });
    });
  });

  describe('Deletion Wrapping', () => {
    it('should wrap a run element with w:del and convert w:t to w:delText', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Deletion Wrapping');
      await allure.severity('critical');
      await allure.description(`
        When content is deleted, the run should be wrapped with <w:del>
        and all w:t elements should be converted to w:delText.
      `);

      let p: Element;
      let r: Element;
      let t: Element;
      let result: boolean;

      await allure.step('Given a paragraph with a run containing "deleted text"', async () => {
        t = el('w:t', {}, undefined, 'deleted text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);
      });

      await allure.step('When wrapAsDeleted is called on the run', async () => {
        const state = createRevisionIdState();
        result = wrapAsDeleted(r, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the paragraph now has w:del as its child', async () => {
        const pChildren = childElements(p);
        const del = pChildren[0];
        assertDefined(del, 'p children[0]');
        expect(del.tagName).toBe('w:del');
      });

      await allure.step('And w:del contains the original run', async () => {
        const pChildren = childElements(p);
        const del = pChildren[0];
        assertDefined(del, 'p children[0]');
        const delChildren = childElements(del);
        expect(delChildren[0]).toBe(r);
      });

      await allure.step('And w:t has been converted to w:delText', async () => {
        // After conversion, the original t element is replaced in the DOM.
        // Find the delText within the run.
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.tagName).toBe('w:delText');
      });

      await allure.step('And the text content is preserved', async () => {
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.textContent).toBe('deleted text');
      });
    });
  });

  describe('Deleted Run Insertion', () => {
    it('should clone and insert a deleted run after an existing run', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Deleted Content Insertion');
      await allure.severity('critical');
      await allure.description(`
        When handling deleted content, we clone the run from the original
        document and insert it at the correct position in the revised document.
      `);

      let targetP: Element;
      let existingR: Element;
      let result: Element | null;

      await allure.step('Given a deleted run "deleted" in the original document', async () => {
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

      await allure.step('Then a w:del element is created', async () => {
        expect(result).not.toBeNull();
        expect(result!.tagName).toBe('w:del');
      });

      await allure.step('And it is inserted after the existing run', async () => {
        const targetChildren = childElements(targetP);
        expect(targetChildren).toHaveLength(2);
        expect(targetChildren[1]).toBe(result);
      });

      await allure.step('And it contains a cloned run with w:delText', async () => {
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

    it('should insert after pPr when insertAfterRun is null', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Deleted Content Insertion');
      await allure.severity('normal');
      await allure.description(`
        When there is no reference run but a pPr exists, deleted content
        should be inserted after the pPr to maintain document structure.
      `);

      let targetP: Element;
      let pPr: Element;
      let result: Element | null;

      await allure.step('Given a target paragraph with pPr and a run', async () => {
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

      await allure.step('Then the order is: pPr, del, existingR', async () => {
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
    it('should wrap moveFrom with range markers and convert to delText', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Move Tracking');
      await allure.severity('critical');
      await allure.description(`
        Moved-from content (the original location) should be wrapped with
        w:moveFrom and range markers, and w:t converted to w:delText since
        the content appears as "deleted" from its original position.
      `);

      let p: Element;
      let r: Element;
      let result: boolean;

      await allure.step('Given a paragraph with a run to be marked as move source', async () => {
        const t = el('w:t', {}, undefined, 'moved text');
        r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);

        const state = createRevisionIdState();
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the structure is: rangeStart, moveFrom, rangeEnd', async () => {
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

      await allure.step('And the move name is set correctly', async () => {
        const pChildren = childElements(p);
        const rangeStart = pChildren[0];
        assertDefined(rangeStart, 'p children[0]');
        expect(rangeStart.getAttribute('w:name')).toBe('move1');
      });

      await allure.step('And w:t is converted to w:delText', async () => {
        // After conversion, find the delText within the run
        const rChildren = childElements(r);
        const delText = rChildren.find(c => c.tagName === 'w:delText');
        assertDefined(delText, 'delText');
        expect(delText.tagName).toBe('w:delText');
      });
    });

    it('should wrap moveTo with range markers and keep w:t', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Move Tracking');
      await allure.severity('critical');
      await allure.description(`
        Moved-to content (the destination) should be wrapped with w:moveTo
        and range markers, but w:t should NOT be converted since the content
        is "inserted" at the new position.
      `);

      let p: Element;
      let t: Element;

      await allure.step('Given a paragraph with a run to be marked as move destination', async () => {
        t = el('w:t', {}, undefined, 'moved');
        const r = el('w:r', {}, [t]);
        p = el('w:p', {}, [r]);

        const state = createRevisionIdState();
        wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await allure.step('Then the structure is: rangeStart, moveTo, rangeEnd', async () => {
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

      await allure.step('And w:t is NOT converted (remains w:t)', async () => {
        expect(t.tagName).toBe('w:t');
      });
    });

    it('should use linked range IDs for moveFrom and moveTo with same name', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Move Tracking');
      await allure.severity('critical');
      await allure.description(`
        When moveFrom and moveTo share the same move name, their range markers
        should use linked IDs so Word can connect the source and destination.
      `);

      let p: Element;

      await allure.step('Given two runs wrapped as moveFrom and moveTo with same name', async () => {
        const r1 = el('w:r');
        const r2 = el('w:r');
        p = el('w:p', {}, [r1, r2]);

        const state = createRevisionIdState();
        wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
        wrapAsMoveTo(r2, 'move1', author, dateStr, state);
      });

      await allure.step('Then moveFromRangeStart has sourceRangeId', async () => {
        const pChildren = childElements(p);
        const moveFromStart = pChildren[0];
        assertDefined(moveFromStart, 'p children[0]');
        expect(moveFromStart.getAttribute('w:id')).toBe('1');
      });

      await allure.step('And moveToRangeStart has destRangeId', async () => {
        const pChildren = childElements(p);
        const moveToStart = pChildren[3];
        assertDefined(moveToStart, 'p children[3]');
        expect(moveToStart.getAttribute('w:id')).toBe('2');
      });
    });
  });

  describe('Format Change Tracking', () => {
    it('should add rPrChange to existing rPr with old properties', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Format Change Tracking');
      await allure.severity('normal');
      await allure.description(`
        When formatting changes, rPrChange should be added to the run properties
        containing the old (original) formatting values.
      `);

      let rPr: Element;

      await allure.step('Given a run with bold and italic formatting', async () => {
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

      await allure.step('Then rPr contains rPrChange', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        expect(rPrChange).toBeDefined();
      });

      await allure.step('And rPrChange has the correct author', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        expect(rPrChange.getAttribute('w:author')).toBe(author);
      });

      await allure.step('And rPrChange contains the old properties', async () => {
        const rPrChildren = childElements(rPr);
        const rPrChange = rPrChildren.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        const rPrChangeChildren = childElements(rPrChange);
        expect(rPrChangeChildren).toHaveLength(1);
        const oldProp = rPrChangeChildren[0];
        assertDefined(oldProp, 'rPrChange children[0]');
        expect(oldProp.tagName).toBe('w:b');
      });
    });

    it('should create rPr if it does not exist', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Format Change Tracking');
      await allure.severity('normal');
      await allure.description(`
        If a run has no rPr, one should be created to hold the rPrChange.
      `);

      let r: Element;

      await allure.step('Given a run with no rPr', async () => {
        const t = el('w:t', {}, undefined, 'text');
        r = el('w:r', {}, [t]);

        const oldRPr = el('w:rPr', {}, [el('w:sz', { 'w:val': '24' })]);

        const state = createRevisionIdState();
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await allure.step('Then rPr is created', async () => {
        const rChildren = childElements(r);
        const rPr = rChildren[0];
        assertDefined(rPr, 'r children[0]');
        expect(rPr.tagName).toBe('w:rPr');
      });

      await allure.step('And it contains rPrChange', async () => {
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
    it('should add a paragraph-mark w:ins marker in w:pPr/w:rPr for inserted empty paragraph', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Empty Paragraph Handling');
      await allure.severity('normal');
      await allure.description(`
        Empty paragraphs (no runs, only pPr) should be wrapped at the
        paragraph level rather than the run level.
      `);

      let body: Element;
      let p: Element;
      let result: boolean;

      await allure.step('Given an empty paragraph in a body', async () => {
        const pPr = el('w:pPr');
        p = el('w:p', {}, [pPr]);
        body = el('w:body', {}, [p]);

        const state = createRevisionIdState();
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the body still contains the paragraph (no illegal <w:ins><w:p> nesting)', async () => {
        const bodyChildren = childElements(body);
        const first = bodyChildren[0];
        assertDefined(first, 'body children[0]');
        expect(first.tagName).toBe('w:p');
      });

      await allure.step('And w:pPr/w:rPr contains a w:ins paragraph-mark marker', async () => {
        const pChildren = childElements(p);
        const pPr = pChildren.find((c) => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const pPrChildren = childElements(pPr);
        const rPr = pPrChildren.find((c) => c.tagName === 'w:rPr');
        assertDefined(rPr, 'rPr');
        const rPrChildren = childElements(rPr);
        const marker = rPrChildren.find((c) => c.tagName === 'w:ins');
        assertDefined(marker, 'marker');
        expect(marker.getAttribute('w:author')).toBe(author);
        expect(marker.getAttribute('w:date')).toBe(dateStr);
      });
    });

    it('should add a paragraph-mark w:del marker in w:pPr/w:rPr for deleted empty paragraph', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Empty Paragraph Handling');
      await allure.severity('normal');

      let body: Element;
      let p: Element;
      let result: boolean;

      await allure.step('Given an empty paragraph in a body', async () => {
        p = el('w:p');
        body = el('w:body', {}, [p]);

        const state = createRevisionIdState();
        result = wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the body still contains the paragraph (no illegal <w:del><w:p> nesting)', async () => {
        const bodyChildren = childElements(body);
        const first = bodyChildren[0];
        assertDefined(first, 'body children[0]');
        expect(first.tagName).toBe('w:p');
      });

      await allure.step('And w:pPr/w:rPr contains a w:del paragraph-mark marker', async () => {
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
});
