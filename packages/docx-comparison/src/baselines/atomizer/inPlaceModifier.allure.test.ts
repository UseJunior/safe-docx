/**
 * Allure-style Tests for In-Place AST Modifier
 *
 * Tests the in-place document modification operations using Allure decorators
 * for enhanced reporting with Given/When/Then steps.
 */

import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { WmlElement, ComparisonUnitAtom, OpcPart } from '../../core-types.js';
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
import { backfillParentReferences } from './wmlElementUtils.js';
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

      let p: WmlElement;
      let r: WmlElement;
      let result: boolean;

      await allure.step('Given a paragraph with a run containing "inserted text"', async () => {
        const t = createElement('w:t', {}, undefined, 'inserted text');
        r = createElement('w:r', {}, [t]);
        p = createElement('w:p', {}, [r]);
        backfillParentReferences(p);
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
        assertDefined(p.children, 'p.children');
        const ins = p.children[0];
        assertDefined(ins, 'p.children[0]');
        expect(ins.tagName).toBe('w:ins');
      });

      await allure.step('And w:ins has the correct author attribute', async () => {
        assertDefined(p.children, 'p.children');
        const ins = p.children[0];
        assertDefined(ins, 'p.children[0]');
        expect(ins.attributes['w:author']).toBe(author);
      });

      await allure.step('And w:ins has the correct date attribute', async () => {
        assertDefined(p.children, 'p.children');
        const ins = p.children[0];
        assertDefined(ins, 'p.children[0]');
        expect(ins.attributes['w:date']).toBe(dateStr);
      });

      await allure.step('And w:ins has a unique revision ID', async () => {
        assertDefined(p.children, 'p.children');
        const ins = p.children[0];
        assertDefined(ins, 'p.children[0]');
        expect(ins.attributes['w:id']).toBe('1');
      });

      await allure.step('And w:ins contains the original run', async () => {
        assertDefined(p.children, 'p.children');
        const ins = p.children[0];
        assertDefined(ins, 'p.children[0]');
        assertDefined(ins.children, 'ins.children');
        expect(ins.children[0]).toBe(r);
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

      let r: WmlElement;
      let firstResult: boolean;
      let secondResult: boolean;

      await allure.step('Given a run element that has already been wrapped', async () => {
        r = createElement('w:r');
        const p = createElement('w:p', {}, [r]);
        backfillParentReferences(p);

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

      let p: WmlElement;

      await allure.step('Given a paragraph with two runs', async () => {
        const r1 = createElement('w:r');
        const r2 = createElement('w:r');
        p = createElement('w:p', {}, [r1, r2]);
        backfillParentReferences(p);

        const state = createRevisionIdState();
        wrapAsInserted(r1, author, dateStr, state);
        wrapAsInserted(r2, author, dateStr, state);
      });

      await allure.step('Then first wrap has ID 1', async () => {
        assertDefined(p.children, 'p.children');
        const first = p.children[0];
        assertDefined(first, 'p.children[0]');
        expect(first.attributes['w:id']).toBe('1');
      });

      await allure.step('And second wrap has ID 2', async () => {
        assertDefined(p.children, 'p.children');
        const second = p.children[1];
        assertDefined(second, 'p.children[1]');
        expect(second.attributes['w:id']).toBe('2');
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

      let p: WmlElement;
      let r: WmlElement;
      let t: WmlElement;
      let result: boolean;

      await allure.step('Given a paragraph with a run containing "deleted text"', async () => {
        t = createElement('w:t', {}, undefined, 'deleted text');
        r = createElement('w:r', {}, [t]);
        p = createElement('w:p', {}, [r]);
        backfillParentReferences(p);
      });

      await allure.step('When wrapAsDeleted is called on the run', async () => {
        const state = createRevisionIdState();
        result = wrapAsDeleted(r, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the paragraph now has w:del as its child', async () => {
        assertDefined(p.children, 'p.children');
        const del = p.children[0];
        assertDefined(del, 'p.children[0]');
        expect(del.tagName).toBe('w:del');
      });

      await allure.step('And w:del contains the original run', async () => {
        assertDefined(p.children, 'p.children');
        const del = p.children[0];
        assertDefined(del, 'p.children[0]');
        assertDefined(del.children, 'del.children');
        expect(del.children[0]).toBe(r);
      });

      await allure.step('And w:t has been converted to w:delText', async () => {
        expect(t.tagName).toBe('w:delText');
      });

      await allure.step('And the text content is preserved', async () => {
        expect(t.textContent).toBe('deleted text');
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

      let targetP: WmlElement;
      let existingR: WmlElement;
      let result: WmlElement | null;

      await allure.step('Given a deleted run "deleted" in the original document', async () => {
        const originalT = createElement('w:t', {}, undefined, 'deleted');
        const originalR = createElement('w:r', { id: 'original' }, [originalT]);
        const originalP = createElement('w:p', {}, [originalR]);
        backfillParentReferences(originalP);

        // Create target paragraph
        const existingT = createElement('w:t', {}, undefined, 'existing');
        existingR = createElement('w:r', {}, [existingT]);
        targetP = createElement('w:p', {}, [existingR]);
        backfillParentReferences(targetP);

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
        expect(targetP.children).toHaveLength(2);
        expect(targetP.children![1]).toBe(result);
      });

      await allure.step('And it contains a cloned run with w:delText', async () => {
        assertDefined(result, 'result');
        assertDefined(result.children, 'result.children');
        const clonedRun = result.children[0];
        assertDefined(clonedRun, 'result.children[0]');
        expect(clonedRun.tagName).toBe('w:r');
        assertDefined(clonedRun.children, 'clonedRun.children');
        const delText = clonedRun.children[0];
        assertDefined(delText, 'clonedRun.children[0]');
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

      let targetP: WmlElement;
      let pPr: WmlElement;
      let result: WmlElement | null;

      await allure.step('Given a target paragraph with pPr and a run', async () => {
        const originalR = createElement('w:r');
        const originalP = createElement('w:p', {}, [originalR]);
        backfillParentReferences(originalP);

        pPr = createElement('w:pPr');
        const existingR = createElement('w:r');
        targetP = createElement('w:p', {}, [pPr, existingR]);
        backfillParentReferences(targetP);

        const deletedAtom = createMockAtom({
          sourceRunElement: originalR,
        });

        const state = createRevisionIdState();
        result = insertDeletedRun(deletedAtom, null, targetP, author, dateStr, state);
      });

      await allure.step('Then the order is: pPr, del, existingR', async () => {
        assertDefined(targetP.children, 'targetP.children');
        expect(targetP.children[0]).toBe(pPr);
        expect(targetP.children[1]).toBe(result);
        const third = targetP.children[2];
        assertDefined(third, 'targetP.children[2]');
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

      let p: WmlElement;
      let t: WmlElement;
      let result: boolean;

      await allure.step('Given a paragraph with a run to be marked as move source', async () => {
        t = createElement('w:t', {}, undefined, 'moved text');
        const r = createElement('w:r', {}, [t]);
        p = createElement('w:p', {}, [r]);
        backfillParentReferences(p);

        const state = createRevisionIdState();
        result = wrapAsMoveFrom(r, 'move1', author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the structure is: rangeStart, moveFrom, rangeEnd', async () => {
        assertDefined(p.children, 'p.children');
        expect(p.children).toHaveLength(3);
        const rangeStart = p.children[0];
        assertDefined(rangeStart, 'p.children[0]');
        expect(rangeStart.tagName).toBe('w:moveFromRangeStart');
        const moveFrom = p.children[1];
        assertDefined(moveFrom, 'p.children[1]');
        expect(moveFrom.tagName).toBe('w:moveFrom');
        const rangeEnd = p.children[2];
        assertDefined(rangeEnd, 'p.children[2]');
        expect(rangeEnd.tagName).toBe('w:moveFromRangeEnd');
      });

      await allure.step('And the move name is set correctly', async () => {
        assertDefined(p.children, 'p.children');
        const rangeStart = p.children[0];
        assertDefined(rangeStart, 'p.children[0]');
        expect(rangeStart.attributes['w:name']).toBe('move1');
      });

      await allure.step('And w:t is converted to w:delText', async () => {
        expect(t.tagName).toBe('w:delText');
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

      let p: WmlElement;
      let t: WmlElement;

      await allure.step('Given a paragraph with a run to be marked as move destination', async () => {
        t = createElement('w:t', {}, undefined, 'moved');
        const r = createElement('w:r', {}, [t]);
        p = createElement('w:p', {}, [r]);
        backfillParentReferences(p);

        const state = createRevisionIdState();
        wrapAsMoveTo(r, 'move1', author, dateStr, state);
      });

      await allure.step('Then the structure is: rangeStart, moveTo, rangeEnd', async () => {
        assertDefined(p.children, 'p.children');
        expect(p.children).toHaveLength(3);
        const rangeStart = p.children[0];
        assertDefined(rangeStart, 'p.children[0]');
        expect(rangeStart.tagName).toBe('w:moveToRangeStart');
        const moveTo = p.children[1];
        assertDefined(moveTo, 'p.children[1]');
        expect(moveTo.tagName).toBe('w:moveTo');
        const rangeEnd = p.children[2];
        assertDefined(rangeEnd, 'p.children[2]');
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

      let p: WmlElement;

      await allure.step('Given two runs wrapped as moveFrom and moveTo with same name', async () => {
        const r1 = createElement('w:r');
        const r2 = createElement('w:r');
        p = createElement('w:p', {}, [r1, r2]);
        backfillParentReferences(p);

        const state = createRevisionIdState();
        wrapAsMoveFrom(r1, 'move1', author, dateStr, state);
        wrapAsMoveTo(r2, 'move1', author, dateStr, state);
      });

      await allure.step('Then moveFromRangeStart has sourceRangeId', async () => {
        assertDefined(p.children, 'p.children');
        const moveFromStart = p.children[0];
        assertDefined(moveFromStart, 'p.children[0]');
        expect(moveFromStart.attributes['w:id']).toBe('1');
      });

      await allure.step('And moveToRangeStart has destRangeId', async () => {
        assertDefined(p.children, 'p.children');
        const moveToStart = p.children[3];
        assertDefined(moveToStart, 'p.children[3]');
        expect(moveToStart.attributes['w:id']).toBe('2');
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

      let rPr: WmlElement;

      await allure.step('Given a run with bold and italic formatting', async () => {
        rPr = createElement('w:rPr', {}, [
          createElement('w:b'),
          createElement('w:i'),
        ]);
        const t = createElement('w:t', {}, undefined, 'formatted');
        const r = createElement('w:r', {}, [rPr, t]);
        backfillParentReferences(r);

        const oldRPr = createElement('w:rPr', {}, [createElement('w:b')]);

        const state = createRevisionIdState();
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await allure.step('Then rPr contains rPrChange', async () => {
        const rPrChange = rPr.children?.find(c => c.tagName === 'w:rPrChange');
        expect(rPrChange).toBeDefined();
      });

      await allure.step('And rPrChange has the correct author', async () => {
        const rPrChange = rPr.children?.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        expect(rPrChange.attributes['w:author']).toBe(author);
      });

      await allure.step('And rPrChange contains the old properties', async () => {
        const rPrChange = rPr.children?.find(c => c.tagName === 'w:rPrChange');
        assertDefined(rPrChange, 'rPrChange');
        assertDefined(rPrChange.children, 'rPrChange.children');
        expect(rPrChange.children).toHaveLength(1);
        const oldProp = rPrChange.children[0];
        assertDefined(oldProp, 'rPrChange.children[0]');
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

      let r: WmlElement;

      await allure.step('Given a run with no rPr', async () => {
        const t = createElement('w:t', {}, undefined, 'text');
        r = createElement('w:r', {}, [t]);
        backfillParentReferences(r);

        const oldRPr = createElement('w:rPr', {}, [createElement('w:sz', { 'w:val': '24' })]);

        const state = createRevisionIdState();
        addFormatChange(r, oldRPr, author, dateStr, state);
      });

      await allure.step('Then rPr is created', async () => {
        assertDefined(r.children, 'r.children');
        const rPr = r.children[0];
        assertDefined(rPr, 'r.children[0]');
        expect(rPr.tagName).toBe('w:rPr');
      });

      await allure.step('And it contains rPrChange', async () => {
        assertDefined(r.children, 'r.children');
        const rPr = r.children[0];
        assertDefined(rPr, 'r.children[0]');
        const rPrChange = rPr.children?.find(c => c.tagName === 'w:rPrChange');
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

      let body: WmlElement;
      let p: WmlElement;
      let result: boolean;

      await allure.step('Given an empty paragraph in a body', async () => {
        const pPr = createElement('w:pPr');
        p = createElement('w:p', {}, [pPr]);
        body = createElement('w:body', {}, [p]);
        backfillParentReferences(body);

        const state = createRevisionIdState();
        result = wrapParagraphAsInserted(p, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the body still contains the paragraph (no illegal <w:ins><w:p> nesting)', async () => {
        assertDefined(body.children, 'body.children');
        const first = body.children[0];
        assertDefined(first, 'body.children[0]');
        expect(first.tagName).toBe('w:p');
      });

      await allure.step('And w:pPr/w:rPr contains a w:ins paragraph-mark marker', async () => {
        const pPr = p.children?.find((c) => c.tagName === 'w:pPr');
        assertDefined(pPr, 'pPr');
        const rPr = pPr.children?.find((c) => c.tagName === 'w:rPr');
        assertDefined(rPr, 'rPr');
        const marker = rPr.children?.find((c) => c.tagName === 'w:ins');
        assertDefined(marker, 'marker');
        expect(marker.attributes['w:author']).toBe(author);
        expect(marker.attributes['w:date']).toBe(dateStr);
      });
    });

    it('should add a paragraph-mark w:del marker in w:pPr/w:rPr for deleted empty paragraph', async () => {
      await allure.epic('Document Comparison');
      await allure.feature('In-Place AST Modification');
      await allure.story('Empty Paragraph Handling');
      await allure.severity('normal');

      let body: WmlElement;
      let p: WmlElement;
      let result: boolean;

      await allure.step('Given an empty paragraph in a body', async () => {
        p = createElement('w:p');
        body = createElement('w:body', {}, [p]);
        backfillParentReferences(body);

        const state = createRevisionIdState();
        result = wrapParagraphAsDeleted(p, author, dateStr, state);
      });

      await allure.step('Then the operation succeeds', async () => {
        expect(result).toBe(true);
      });

      await allure.step('And the body still contains the paragraph (no illegal <w:del><w:p> nesting)', async () => {
        assertDefined(body.children, 'body.children');
        const first = body.children[0];
        assertDefined(first, 'body.children[0]');
        expect(first.tagName).toBe('w:p');
      });

      await allure.step('And w:pPr/w:rPr contains a w:del paragraph-mark marker', async () => {
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
});
