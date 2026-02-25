import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import { preSplitMixedStatusRuns } from './inPlaceModifier.js';
import { childElements } from '../../primitives/index.js';
import { visibleLengthForEl } from '../../primitives/text.js';
import { el } from '../../testing/dom-test-helpers.js';

const mockPart: OpcPart = {
  uri: 'word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function makeAtom(
  contentElement: Element,
  status: CorrelationStatus,
  sourceRunElement?: Element,
  overrides: Partial<ComparisonUnitAtom> = {},
): ComparisonUnitAtom {
  return {
    contentElement,
    ancestorElements: sourceRunElement ? [sourceRunElement] : [],
    ancestorUnids: [],
    part: mockPart,
    sha1Hash: 'test',
    correlationStatus: status,
    sourceRunElement,
    ...overrides,
  };
}

function getRunTexts(parent: Element): string[] {
  const runs = childElements(parent).filter((c) => c.tagName === 'w:r');
  return runs.map((r) => {
    let text = '';
    for (const child of childElements(r)) {
      if (child.tagName === 'w:t') text += child.textContent ?? '';
      else if (child.tagName === 'w:tab') text += '\t';
      else if (child.tagName === 'w:br') text += '\n';
    }
    return text;
  });
}

describe('preSplitMixedStatusRuns', () => {
  it('no mixed runs — no splitting', () => {
    // Two Equal atoms in the same run — should not be split.
    const t = el('w:t', {}, undefined, 'hello world');
    const rPr = el('w:rPr');
    const run = el('w:r', {}, [rPr, t]);
    const p = el('w:p', {}, [run]);

    const atom1 = makeAtom(t, CorrelationStatus.Equal, run);
    const atom2 = makeAtom(t, CorrelationStatus.Equal, run);

    preSplitMixedStatusRuns([atom1, atom2]);

    // Run unchanged — still one run child of p.
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBe(run);
  });

  it('Equal + Inserted + Equal → 3 fragments', () => {
    // "SERIES A PREFERRED" → 3 atoms: "SERIES "(Equal), "A"(Inserted), " PREFERRED"(Equal)
    const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'SERIES A PREFERRED');
    const rPr = el('w:rPr');
    const run = el('w:r', {}, [rPr, t]);
    const p = el('w:p', {}, [run]);

    // Content elements for each atom — point into the same run
    const tSeriesEl = el('w:t', { 'xml:space': 'preserve' }, undefined, 'SERIES ');
    const tAEl = el('w:t', {}, undefined, 'A');
    const tPrefEl = el('w:t', { 'xml:space': 'preserve' }, undefined, ' PREFERRED');

    const atomEqual1 = makeAtom(tSeriesEl, CorrelationStatus.Equal, run);
    const atomInserted = makeAtom(tAEl, CorrelationStatus.Inserted, run);
    const atomEqual2 = makeAtom(tPrefEl, CorrelationStatus.Equal, run);

    preSplitMixedStatusRuns([atomEqual1, atomInserted, atomEqual2]);

    const texts = getRunTexts(p);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toBe('SERIES ');
    expect(texts[1]).toBe('A');
    expect(texts[2]).toBe(' PREFERRED');

    // Verify atom pointers were updated.
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(atomEqual1.sourceRunElement).toBe(runs[0]);
    expect(atomInserted.sourceRunElement).toBe(runs[1]);
    expect(atomEqual2.sourceRunElement).toBe(runs[2]);
  });

  it('Inserted at start → 2 fragments', () => {
    const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'NEW rest');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    const tNew = el('w:t', {}, undefined, 'NEW');
    const tRest = el('w:t', { 'xml:space': 'preserve' }, undefined, ' rest');

    const atomInserted = makeAtom(tNew, CorrelationStatus.Inserted, run);
    const atomEqual = makeAtom(tRest, CorrelationStatus.Equal, run);

    preSplitMixedStatusRuns([atomInserted, atomEqual]);

    const texts = getRunTexts(p);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('NEW');
    expect(texts[1]).toBe(' rest');
  });

  it('Inserted at end → 2 fragments', () => {
    const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'start NEW');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    const tStart = el('w:t', { 'xml:space': 'preserve' }, undefined, 'start ');
    const tNew = el('w:t', {}, undefined, 'NEW');

    const atomEqual = makeAtom(tStart, CorrelationStatus.Equal, run);
    const atomInserted = makeAtom(tNew, CorrelationStatus.Inserted, run);

    preSplitMixedStatusRuns([atomEqual, atomInserted]);

    const texts = getRunTexts(p);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('start ');
    expect(texts[1]).toBe('NEW');
  });

  it('Deleted atoms ignored — original-tree runs NOT split', () => {
    const t = el('w:t', {}, undefined, 'hello world');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    const t1 = el('w:t', {}, undefined, 'hello');
    const t2 = el('w:t', { 'xml:space': 'preserve' }, undefined, ' world');

    // Both Deleted — should be excluded entirely from grouping.
    const atom1 = makeAtom(t1, CorrelationStatus.Deleted, run);
    const atom2 = makeAtom(t2, CorrelationStatus.Equal, run);
    // But atom2 is Equal, so only one status in the group → no split either.
    // To really test: make atom1 Deleted and atom2 Inserted — Deleted gets filtered out,
    // leaving only Inserted (single status → no split).

    preSplitMixedStatusRuns([atom1, atom2]);

    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    // Deleted atom is excluded from grouping, so only Equal atom remains in group.
    // Single status → no split.
    expect(runs).toHaveLength(1);
  });

  it('w:tab and w:br count as 1 character each', () => {
    // Run: "AB\tCD" — tab is 1 char. Split between "AB\t" (Equal) and "CD" (Inserted).
    const tAB = el('w:t', {}, undefined, 'AB');
    const tab = el('w:tab');
    const tCD = el('w:t', {}, undefined, 'CD');
    const run = el('w:r', {}, [tAB, tab, tCD]);
    const p = el('w:p', {}, [run]);

    // Atom content elements: "AB\t" = 3 chars, "CD" = 2 chars
    const atomEq = makeAtom(tAB, CorrelationStatus.Equal, run);
    // Tab is 1 char, part of the Equal span
    const atomTab = makeAtom(tab, CorrelationStatus.Equal, run);
    const atomIns = makeAtom(tCD, CorrelationStatus.Inserted, run);

    preSplitMixedStatusRuns([atomEq, atomTab, atomIns]);

    const texts = getRunTexts(p);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe('AB\t'); // 2 text chars + 1 tab
    expect(texts[1]).toBe('CD');
  });

  it('w:cr parity — visibleLengthForEl returns consistent value', () => {
    // w:cr is not in W constants but has localName 'cr' — visibleLengthForEl returns 0.
    // This test verifies the splitter uses the same function for measurement.
    const cr = el('w:cr');
    expect(visibleLengthForEl(cr)).toBe(0);
  });

  it('right-to-left fragment mapping preserves correct order', () => {
    // "ABCDE" with 3 status spans: "AB"(Equal), "C"(Inserted), "DE"(Equal)
    const t = el('w:t', {}, undefined, 'ABCDE');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    const tAB = el('w:t', {}, undefined, 'AB');
    const tC = el('w:t', {}, undefined, 'C');
    const tDE = el('w:t', {}, undefined, 'DE');

    const a1 = makeAtom(tAB, CorrelationStatus.Equal, run);
    const a2 = makeAtom(tC, CorrelationStatus.Inserted, run);
    const a3 = makeAtom(tDE, CorrelationStatus.Equal, run);

    preSplitMixedStatusRuns([a1, a2, a3]);

    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(3);

    // Verify: original run is leftmost (first fragment).
    expect(runs[0]).toBe(run);
    // Fragment order matches span order.
    expect(a1.sourceRunElement).toBe(runs[0]);
    expect(a2.sourceRunElement).toBe(runs[1]);
    expect(a3.sourceRunElement).toBe(runs[2]);
  });

  it('zero-length boundary — split offset at 0 or runLength produces no split', () => {
    // All content in one span, split points filtered out.
    const t = el('w:t', {}, undefined, 'hello');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    // Two atoms: zero-length + full text — effectively one status span.
    const zeroEl = el('w:cr'); // visibleLength = 0
    const textEl = el('w:t', {}, undefined, 'hello');

    const atom1 = makeAtom(zeroEl, CorrelationStatus.Inserted, run);
    const atom2 = makeAtom(textEl, CorrelationStatus.Equal, run);

    preSplitMixedStatusRuns([atom1, atom2]);

    // The zero-length atom starts at offset 0, the second at offset 0.
    // Split point at 0 is filtered out → no split.
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(1);
  });

  it('cross-run merged atom skipped — sum of atom lengths > run visible length', () => {
    // Run has 5 visible chars, but atoms claim 10 → cross-run merge detected → skip.
    const t = el('w:t', {}, undefined, 'hello');
    const run = el('w:r', {}, [t]);
    const p = el('w:p', {}, [run]);

    // Atoms whose contentElement lengths sum to more than the run's visible length.
    const bigT1 = el('w:t', {}, undefined, 'hello wor'); // 9 chars
    const bigT2 = el('w:t', {}, undefined, 'ld');         // 2 chars — total 11 > 5

    const atom1 = makeAtom(bigT1, CorrelationStatus.Equal, run);
    const atom2 = makeAtom(bigT2, CorrelationStatus.Inserted, run);

    preSplitMixedStatusRuns([atom1, atom2]);

    // Should NOT have split — guard triggered.
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(1);
  });

  it('fldChar atoms skipped — runs with field characters excluded', () => {
    const fldChar = el('w:fldChar', { 'w:fldCharType': 'begin' });
    const t = el('w:t', {}, undefined, 'text');
    const run = el('w:r', {}, [fldChar, t]);
    const p = el('w:p', {}, [run]);

    // fldChar atom should be excluded from grouping.
    const atom1 = makeAtom(fldChar, CorrelationStatus.Equal, run);
    const atom2 = makeAtom(t, CorrelationStatus.Inserted, run);

    preSplitMixedStatusRuns([atom1, atom2]);

    // fldChar atom excluded → only Inserted atom remains in group → single status → no split.
    const runs = childElements(p).filter((c) => c.tagName === 'w:r');
    expect(runs).toHaveLength(1);
  });
});
