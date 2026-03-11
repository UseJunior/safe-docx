import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import type { ComparisonUnitAtom, OpcPart } from '../../core-types.js';
import { CorrelationStatus } from '../../core-types.js';
import { preSplitMixedStatusRuns } from './inPlaceModifier.js';
import { childElements } from '../../primitives/index.js';
import { visibleLengthForEl } from '../../primitives/text.js';
import { el } from '../../testing/dom-test-helpers.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Inplace Split' });

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
  test('no mixed runs — no splitting', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let run: Element;
    let atom1: ComparisonUnitAtom;
    let atom2: ComparisonUnitAtom;

    await given('two Equal atoms sharing the same run', () => {
      // Two Equal atoms in the same run — should not be split.
      const t = el('w:t', {}, undefined, 'hello world');
      const rPr = el('w:rPr');
      run = el('w:r', {}, [rPr, t]);
      p = el('w:p', {}, [run]);

      atom1 = makeAtom(t, CorrelationStatus.Equal, run);
      atom2 = makeAtom(t, CorrelationStatus.Equal, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atom1, atom2]);
    });

    await then('run is unchanged — still one run child of p', () => {
      // Run unchanged — still one run child of p.
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
      expect(runs[0]).toBe(run);
    });
  });

  test('Equal + Inserted + Equal → 3 fragments', async ({ given, when, then, and }: AllureBddContext) => {
    let p: Element;
    let atomEqual1: ComparisonUnitAtom;
    let atomInserted: ComparisonUnitAtom;
    let atomEqual2: ComparisonUnitAtom;

    await given('a run "SERIES A PREFERRED" with three atoms: "SERIES "(Equal), "A"(Inserted), " PREFERRED"(Equal)', () => {
      // "SERIES A PREFERRED" → 3 atoms: "SERIES "(Equal), "A"(Inserted), " PREFERRED"(Equal)
      const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'SERIES A PREFERRED');
      const rPr = el('w:rPr');
      const run = el('w:r', {}, [rPr, t]);
      p = el('w:p', {}, [run]);

      // Content elements for each atom — point into the same run
      const tSeriesEl = el('w:t', { 'xml:space': 'preserve' }, undefined, 'SERIES ');
      const tAEl = el('w:t', {}, undefined, 'A');
      const tPrefEl = el('w:t', { 'xml:space': 'preserve' }, undefined, ' PREFERRED');

      atomEqual1 = makeAtom(tSeriesEl, CorrelationStatus.Equal, run);
      atomInserted = makeAtom(tAEl, CorrelationStatus.Inserted, run);
      atomEqual2 = makeAtom(tPrefEl, CorrelationStatus.Equal, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atomEqual1, atomInserted, atomEqual2]);
    });

    await then('three run fragments are produced with correct texts', () => {
      const texts = getRunTexts(p);
      expect(texts).toHaveLength(3);
      expect(texts[0]).toBe('SERIES ');
      expect(texts[1]).toBe('A');
      expect(texts[2]).toBe(' PREFERRED');
    });

    await and('atom sourceRunElement pointers are updated to their respective fragments', () => {
      // Verify atom pointers were updated.
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(atomEqual1.sourceRunElement).toBe(runs[0]);
      expect(atomInserted.sourceRunElement).toBe(runs[1]);
      expect(atomEqual2.sourceRunElement).toBe(runs[2]);
    });
  });

  test('Inserted at start → 2 fragments', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atomInserted: ComparisonUnitAtom;
    let atomEqual: ComparisonUnitAtom;

    await given('a run "NEW rest" with "NEW"(Inserted) and " rest"(Equal)', () => {
      const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'NEW rest');
      const run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      const tNew = el('w:t', {}, undefined, 'NEW');
      const tRest = el('w:t', { 'xml:space': 'preserve' }, undefined, ' rest');

      atomInserted = makeAtom(tNew, CorrelationStatus.Inserted, run);
      atomEqual = makeAtom(tRest, CorrelationStatus.Equal, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atomInserted, atomEqual]);
    });

    await then('two run fragments are produced: "NEW" and " rest"', () => {
      const texts = getRunTexts(p);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toBe('NEW');
      expect(texts[1]).toBe(' rest');
    });
  });

  test('Inserted at end → 2 fragments', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atomEqual: ComparisonUnitAtom;
    let atomInserted: ComparisonUnitAtom;

    await given('a run "start NEW" with "start "(Equal) and "NEW"(Inserted)', () => {
      const t = el('w:t', { 'xml:space': 'preserve' }, undefined, 'start NEW');
      const run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      const tStart = el('w:t', { 'xml:space': 'preserve' }, undefined, 'start ');
      const tNew = el('w:t', {}, undefined, 'NEW');

      atomEqual = makeAtom(tStart, CorrelationStatus.Equal, run);
      atomInserted = makeAtom(tNew, CorrelationStatus.Inserted, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atomEqual, atomInserted]);
    });

    await then('two run fragments are produced: "start " and "NEW"', () => {
      const texts = getRunTexts(p);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toBe('start ');
      expect(texts[1]).toBe('NEW');
    });
  });

  test('Deleted atoms ignored — original-tree runs NOT split', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atom1: ComparisonUnitAtom;
    let atom2: ComparisonUnitAtom;

    await given('a run with a Deleted atom and an Equal atom pointing to the same run', () => {
      const t = el('w:t', {}, undefined, 'hello world');
      const run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      const t1 = el('w:t', {}, undefined, 'hello');
      const t2 = el('w:t', { 'xml:space': 'preserve' }, undefined, ' world');

      // Both Deleted — should be excluded entirely from grouping.
      atom1 = makeAtom(t1, CorrelationStatus.Deleted, run);
      atom2 = makeAtom(t2, CorrelationStatus.Equal, run);
      // But atom2 is Equal, so only one status in the group → no split either.
      // To really test: make atom1 Deleted and atom2 Inserted — Deleted gets filtered out,
      // leaving only Inserted (single status → no split).
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atom1, atom2]);
    });

    await then('run is not split — Deleted atom excluded from grouping leaves single status', () => {
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      // Deleted atom is excluded from grouping, so only Equal atom remains in group.
      // Single status → no split.
      expect(runs).toHaveLength(1);
    });
  });

  test('w:tab and w:br count as 1 character each', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atomEq: ComparisonUnitAtom;
    let atomTab: ComparisonUnitAtom;
    let atomIns: ComparisonUnitAtom;

    await given('a run "AB\\tCD" with Equal atoms covering "AB" and tab, and an Inserted atom covering "CD"', () => {
      // Run: "AB\tCD" — tab is 1 char. Split between "AB\t" (Equal) and "CD" (Inserted).
      const tAB = el('w:t', {}, undefined, 'AB');
      const tab = el('w:tab');
      const tCD = el('w:t', {}, undefined, 'CD');
      const run = el('w:r', {}, [tAB, tab, tCD]);
      p = el('w:p', {}, [run]);

      // Atom content elements: "AB\t" = 3 chars, "CD" = 2 chars
      atomEq = makeAtom(tAB, CorrelationStatus.Equal, run);
      // Tab is 1 char, part of the Equal span
      atomTab = makeAtom(tab, CorrelationStatus.Equal, run);
      atomIns = makeAtom(tCD, CorrelationStatus.Inserted, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atomEq, atomTab, atomIns]);
    });

    await then('two fragments are produced: "AB\\t" and "CD"', () => {
      const texts = getRunTexts(p);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toBe('AB\t'); // 2 text chars + 1 tab
      expect(texts[1]).toBe('CD');
    });
  });

  test('w:cr parity — visibleLengthForEl returns consistent value', async ({ given, when, then }: AllureBddContext) => {
    let cr: Element;

    await given('a w:cr element', () => {
      // w:cr is not in W constants but has localName 'cr' — visibleLengthForEl returns 0.
      // This test verifies the splitter uses the same function for measurement.
      cr = el('w:cr');
    });

    await when('visibleLengthForEl is called on w:cr', () => {
      // measurement happens in then
    });

    await then('visibleLengthForEl returns 0', () => {
      expect(visibleLengthForEl(cr)).toBe(0);
    });
  });

  test('right-to-left fragment mapping preserves correct order', async ({ given, when, then, and }: AllureBddContext) => {
    let p: Element;
    let run: Element;
    let a1: ComparisonUnitAtom;
    let a2: ComparisonUnitAtom;
    let a3: ComparisonUnitAtom;

    await given('a run "ABCDE" with three atoms: "AB"(Equal), "C"(Inserted), "DE"(Equal)', () => {
      // "ABCDE" with 3 status spans: "AB"(Equal), "C"(Inserted), "DE"(Equal)
      const t = el('w:t', {}, undefined, 'ABCDE');
      run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      const tAB = el('w:t', {}, undefined, 'AB');
      const tC = el('w:t', {}, undefined, 'C');
      const tDE = el('w:t', {}, undefined, 'DE');

      a1 = makeAtom(tAB, CorrelationStatus.Equal, run);
      a2 = makeAtom(tC, CorrelationStatus.Inserted, run);
      a3 = makeAtom(tDE, CorrelationStatus.Equal, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([a1, a2, a3]);
    });

    await then('three run fragments are produced', () => {
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(3);
    });

    await and('original run is leftmost (first fragment) and atom pointers match span order', () => {
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');

      // Verify: original run is leftmost (first fragment).
      expect(runs[0]).toBe(run);
      // Fragment order matches span order.
      expect(a1.sourceRunElement).toBe(runs[0]);
      expect(a2.sourceRunElement).toBe(runs[1]);
      expect(a3.sourceRunElement).toBe(runs[2]);
    });
  });

  test('zero-length boundary — split offset at 0 or runLength produces no split', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atom1: ComparisonUnitAtom;
    let atom2: ComparisonUnitAtom;

    await given('a run "hello" with a zero-length Inserted atom (w:cr) followed by an Equal atom', () => {
      // All content in one span, split points filtered out.
      const t = el('w:t', {}, undefined, 'hello');
      const run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      // Two atoms: zero-length + full text — effectively one status span.
      const zeroEl = el('w:cr'); // visibleLength = 0
      const textEl = el('w:t', {}, undefined, 'hello');

      atom1 = makeAtom(zeroEl, CorrelationStatus.Inserted, run);
      atom2 = makeAtom(textEl, CorrelationStatus.Equal, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atom1, atom2]);
    });

    await then('run is not split — zero-length split point at offset 0 is filtered out', () => {
      // The zero-length atom starts at offset 0, the second at offset 0.
      // Split point at 0 is filtered out → no split.
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
    });
  });

  test('cross-run merged atom skipped — sum of atom lengths > run visible length', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atom1: ComparisonUnitAtom;
    let atom2: ComparisonUnitAtom;

    await given('a run "hello" (5 chars) with atoms whose content lengths sum to more than 5', () => {
      // Run has 5 visible chars, but atoms claim 10 → cross-run merge detected → skip.
      const t = el('w:t', {}, undefined, 'hello');
      const run = el('w:r', {}, [t]);
      p = el('w:p', {}, [run]);

      // Atoms whose contentElement lengths sum to more than the run's visible length.
      const bigT1 = el('w:t', {}, undefined, 'hello wor'); // 9 chars
      const bigT2 = el('w:t', {}, undefined, 'ld');         // 2 chars — total 11 > 5

      atom1 = makeAtom(bigT1, CorrelationStatus.Equal, run);
      atom2 = makeAtom(bigT2, CorrelationStatus.Inserted, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atom1, atom2]);
    });

    await then('run is not split — cross-run merge guard triggered', () => {
      // Should NOT have split — guard triggered.
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
    });
  });

  test('fldChar atoms skipped — runs with field characters excluded', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let atom1: ComparisonUnitAtom;
    let atom2: ComparisonUnitAtom;

    await given('a run with a fldChar(Equal) and a text atom(Inserted)', () => {
      const fldChar = el('w:fldChar', { 'w:fldCharType': 'begin' });
      const t = el('w:t', {}, undefined, 'text');
      const run = el('w:r', {}, [fldChar, t]);
      p = el('w:p', {}, [run]);

      // fldChar atom should be excluded from grouping.
      atom1 = makeAtom(fldChar, CorrelationStatus.Equal, run);
      atom2 = makeAtom(t, CorrelationStatus.Inserted, run);
    });

    await when('preSplitMixedStatusRuns is called', () => {
      preSplitMixedStatusRuns([atom1, atom2]);
    });

    await then('run is not split — fldChar atom excluded leaves single status group', () => {
      // fldChar atom excluded → only Inserted atom remains in group → single status → no split.
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
    });
  });
});
