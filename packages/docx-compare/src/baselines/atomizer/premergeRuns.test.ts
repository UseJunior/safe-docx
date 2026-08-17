import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer as compareDocuments } from './pipeline.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { premergeAdjacentRuns } from './premergeRuns.js';
import { el, testDoc } from '../../testing/dom-test-helpers.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { childElements, getLeafText } from '@usejunior/docx-core';
import { assertDefined } from '../../testing/test-utils.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Premerge Runs' });

describe('premergeAdjacentRuns', () => {
  test('merges adjacent runs with identical formatting', async ({ given, when, then, and }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two adjacent runs with identical bold formatting', () => {
      const rPr = el('w:rPr', {}, [el('w:b')]);
      const r1 = el('w:r', {}, [rPr, el('w:t', {}, undefined, 'Hello')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, ' world')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported', () => {
      expect(merges).toBe(1);
    });

    await and('paragraph has one run child with two w:t elements', () => {
      const pChildren = childElements(p);
      expect(pChildren).toHaveLength(1);
      const firstChild = pChildren[0];
      assertDefined(firstChild, 'p children[0]');
      expect(firstChild.tagName).toBe('w:r');
      const runChildren = childElements(firstChild);
      const textChildren = runChildren.filter((c) => c.tagName === 'w:t');
      expect(textChildren).toHaveLength(2);
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe(
        'Hello world'
      );
    });
  });

  test('does not merge runs when formatting differs', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with different formatting (bold vs italic)', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('does not merge runs that contain unsafe children', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs where one contains a w:drawing child', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:drawing'), el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('does not merge runs when non-rsid run attributes differ', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with different non-rsid attributes', () => {
      // The strict OOXML run schema only defines rsid attributes on w:r, but
      // extension/foreign attributes occur in the wild — stay conservative and
      // refuse to merge when any non-rsid attribute differs.
      const r1 = el('w:r', { 'w:author': 'alice' }, [el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', { 'w:author': 'bob' }, [el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('merges runs whose attributes differ only by rsids', async ({ given, when, then, and }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('three runs where the middle run lacks w:rsidRPr (issue #675 shape)', () => {
      // Word produces this shape when a token is retyped in a later editing
      // session: the fragments differ only in revision-save identifiers.
      const r1 = el('w:r', { 'w:rsidRPr': '00F9719D', 'w:rsidR': '00932CCC' }, [el('w:t', { 'xml:space': 'preserve' }, undefined, '$')]);
      const r2 = el('w:r', { 'w:rsidR': '00932CCC' }, [el('w:t', {}, undefined, '204')]);
      const r3 = el('w:r', { 'w:rsidRPr': '00F9719D', 'w:rsidR': '00932CCC' }, [el('w:t', {}, undefined, ',000.00')]);
      p = el('w:p', {}, [r1, r2, r3]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('all three runs collapse into one', () => {
      expect(merges).toBe(2);
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('$204,000.00');
    });

    await and('the merged run keeps the first run\'s rsid attributes', () => {
      const merged = childElements(p)[0]!;
      expect(merged.getAttribute('w:rsidRPr')).toBe('00F9719D');
      expect(merged.getAttribute('w:rsidR')).toBe('00932CCC');
    });
  });

  test('merges runs with entirely different rsid values', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with different w:rsidRPr values and identical formatting', () => {
      const r1 = el('w:r', { 'w:rsidRPr': 'AAAA' }, [el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', { 'w:rsidRPr': 'BBBB' }, [el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and the runs collapse into one', () => {
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });

  test('merges pretty-printed runs containing whitespace-only text nodes', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with indentation text nodes as direct children', () => {
      // Pretty-printed document.xml puts whitespace text nodes inside every
      // run; that whitespace is insignificant and must not block merging.
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Hello')], '\n        ');
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, ' world')], '\n        ');
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and text concatenates across the runs', () => {
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('Hello world');
    });
  });

  test('does not merge runs with stray non-whitespace direct text', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('a run with non-whitespace text directly under w:r', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')], 'stray');
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      // Direct non-whitespace text under w:r is not representable content the
      // merge understands — stay conservative and refuse.
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('does not merge when stray text follows an initial whitespace text node', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('a run with indentation before w:t and stray text after it', () => {
      // Every direct text child must be scanned: getLeafText() returns only
      // the FIRST text child, so a whitespace node before <w:t> must not let
      // later non-whitespace text slip past the guard — mergeRunInto moves
      // element children only and would silently drop the stray text.
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A')], '\n        ');
      r1.appendChild(testDoc.createTextNode('stray'));
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'B')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
      expect(childElements(p)[0]!.textContent).toContain('stray');
    });
  });

  test('skips empty runs (no w:t children)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('an empty run followed by a run with text, both bold', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')])]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:b')]), el('w:t', {}, undefined, 'Hello')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // r1 is empty but still safe to merge — content from r2 moves into r1
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });

  test('does not merge runs with mixed content (w:t + w:tab + w:br)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;
    let merged: Element;

    await given('two runs with mixed safe content (w:t, w:tab, w:br) and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'A'), el('w:tab')]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'B'), el('w:br')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      // Both runs are safe (w:t, w:tab, w:br are in SAFE_RUN_CHILD_TAGS), but they have no rPr
      // so formatting is identical — they CAN be merged
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and merged run contains all content elements', () => {
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
      // Merged run should contain all content elements
      merged = childElements(p)[0]!;
      const mergedChildren = childElements(merged);
      expect(mergedChildren.map((c) => c.tagName)).toEqual(['w:t', 'w:tab', 'w:t', 'w:br']);
    });
  });

  test('collapses three+ adjacent mergeable runs into one', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('four adjacent italic runs each with a single character', () => {
      const r1 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'A')]);
      const r2 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'B')]);
      const r3 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'C')]);
      const r4 = el('w:r', {}, [el('w:rPr', {}, [el('w:i')]), el('w:t', {}, undefined, 'D')]);
      p = el('w:p', {}, [r1, r2, r3, r4]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('three merges are reported and all runs collapse into one with text "ABCD"', () => {
      expect(merges).toBe(3);
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('ABCD');
    });
  });

  test('does not merge across field character boundaries (fldChar)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('three runs where the middle run contains a field character begin', () => {
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Before')]);
      const rField = el('w:r', {}, [el('w:fldChar', { 'w:fldCharType': 'begin' })]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'After')]);
      p = el('w:p', {}, [r1, rField, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and all three runs remain', () => {
      // fldChar is not in SAFE_RUN_CHILD_TAGS, so rField is unsafe — blocks merging
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(3);
    });
  });

  test('is a no-op for paragraph with only pPr + one run', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('a paragraph with pPr and a single run', () => {
      const pPr = el('w:pPr', {}, [el('w:jc', { 'w:val': 'center' })]);
      const r1 = el('w:r', {}, [el('w:t', {}, undefined, 'Only run')]);
      p = el('w:p', {}, [pPr, r1]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and the single run remains', () => {
      expect(merges).toBe(0);
      // pPr is not a w:r so only 1 run — nothing to merge
      const runs = childElements(p).filter((c) => c.tagName === 'w:r');
      expect(runs).toHaveLength(1);
    });
  });

  test('concatenates text content correctly after merge', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;

    await given('three runs with text "Hello ", "world", and "!" and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello ')]);
      const r2 = el('w:r', {}, [el('w:t', {}, undefined, 'world')]);
      const r3 = el('w:r', {}, [el('w:t', {}, undefined, '!')]);
      p = el('w:p', {}, [r1, r2, r3]);
    });

    await when('premergeAdjacentRuns is called', () => {
      premergeAdjacentRuns(p);
    });

    await then('all runs collapse into one with concatenated text "Hello world!"', () => {
      expect(childElements(p)).toHaveLength(1);
      const merged = childElements(p)[0]!;
      const textChildren = childElements(merged).filter((c) => c.tagName === 'w:t');
      expect(textChildren.map((c) => getLeafText(c) ?? '').join('')).toBe('Hello world!');
    });
  });

  test('merges runs with identical rPr but different xml:space handling', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two bold runs where the first w:t has xml:space="preserve"', () => {
      const r1 = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', { 'xml:space': 'preserve' }, undefined, 'Hello '),
      ]);
      const r2 = el('w:r', {}, [
        el('w:rPr', {}, [el('w:b')]),
        el('w:t', {}, undefined, 'world'),
      ]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // xml:space is on w:t, not on w:r or w:rPr — rPr is still identical
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });

  test('does not merge runs with nested elements under non-rPr children', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs where the second w:t has a nested w:sym child element', () => {
      // A w:t with a nested child element is unusual but should be rejected
      const t1 = el('w:t', {}, undefined, 'A');
      const t2 = el('w:t', {}, [el('w:sym', { 'w:char': 'F0E0' })]);
      const r1 = el('w:r', {}, [t1]);
      const r2 = el('w:r', {}, [t2]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('no merges are reported and both runs remain', () => {
      // t2 has a child element under w:t — runIsSafeToMerge returns false
      expect(merges).toBe(0);
      expect(childElements(p)).toHaveLength(2);
    });
  });

  test('handles runs with w:delText (deleted text)', async ({ given, when, then }: AllureBddContext) => {
    let p: Element;
    let merges: number;

    await given('two runs with w:delText children and no rPr', () => {
      const r1 = el('w:r', {}, [el('w:delText', {}, undefined, 'removed ')]);
      const r2 = el('w:r', {}, [el('w:delText', {}, undefined, 'text')]);
      p = el('w:p', {}, [r1, r2]);
    });

    await when('premergeAdjacentRuns is called', () => {
      merges = premergeAdjacentRuns(p);
    });

    await then('one merge is reported and runs collapse into one', () => {
      // w:delText is in SAFE_RUN_CHILD_TAGS, runs have no rPr — should merge
      expect(merges).toBe(1);
      expect(childElements(p)).toHaveLength(1);
    });
  });
});

describe('rsid-fragmented runs through the comparison pipeline (issue #675)', () => {
  // Source: unchanged amount split across three runs; the middle run carries no
  // w:rsidRPr while its neighbours do. Word produces this shape routinely when
  // a figure is retyped in a later editing session.
  const SPLIT_ALTERNATING_RSID =
    '<w:p>' +
    '<w:r w:rsidRPr="00F9719D" w:rsidR="00932CCC"><w:t xml:space="preserve">Alpha clause; beta clause; the amount shall not exceed $</w:t></w:r>' +
    '<w:r w:rsidR="00932CCC"><w:t>204</w:t></w:r>' +
    '<w:r w:rsidRPr="00F9719D" w:rsidR="00932CCC"><w:t xml:space="preserve">,000.00 or 0.50%, whichever is greater. Legacy Costs settle monthly.</w:t></w:r>' +
    '</w:p>';

  // Control: identical split, all three runs carry the same rsids.
  const SPLIT_UNIFORM_RSID = SPLIT_ALTERNATING_RSID.replace(
    '<w:r w:rsidR="00932CCC"><w:t>204</w:t></w:r>',
    '<w:r w:rsidRPr="00F9719D" w:rsidR="00932CCC"><w:t>204</w:t></w:r>',
  );

  // Revised: one run. "$204,000.00" is unchanged; the only real edits are the
  // leading clause and the trailing term.
  const SINGLE_RUN =
    '<w:p>' +
    '<w:r><w:t xml:space="preserve">Alpha clause and any further clause reasonably incurred; the amount shall not exceed $204,000.00 or 0.50%, whichever is greater. Updated Costs settle monthly.</w:t></w:r>' +
    '</w:p>';

  async function documentXml(docx: Buffer): Promise<string> {
    const part = (await JSZip.loadAsync(docx)).file('word/document.xml');
    assertDefined(part, 'word/document.xml in comparison result');
    return part.async('string');
  }

  function delTexts(xml: string): string[] {
    return [...xml.matchAll(/<w:delText[^>]*>([^<]*)<\/w:delText>/g)].map((m) => m[1]!);
  }

  test('alternating-rsid run split does not produce a phantom delete+insert', async ({ given, when, then, and }: AllureBddContext) => {
    let alternating!: Buffer;
    let uniform!: Buffer;
    let revised!: Buffer;
    let alternatingResult!: Awaited<ReturnType<typeof compareDocuments>>;
    let uniformResult!: Awaited<ReturnType<typeof compareDocuments>>;
    let alternatingXml!: string;
    let uniformXml!: string;

    await given('a repro pair and a control pair differing only in rsid uniformity', async () => {
      alternating = await buildDocxFromBodyXml(SPLIT_ALTERNATING_RSID);
      uniform = await buildDocxFromBodyXml(SPLIT_UNIFORM_RSID);
      revised = await buildDocxFromBodyXml(SINGLE_RUN);
    });

    await when('both pairs are compared in inplace mode', async () => {
      alternatingResult = await compareDocuments(alternating, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
      });
      uniformResult = await compareDocuments(uniform, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
      });
      alternatingXml = await documentXml(alternatingResult.document);
      uniformXml = await documentXml(uniformResult.document);
    });

    await then('the unchanged amount is not struck through in the repro output', () => {
      expect(delTexts(alternatingXml).join('')).not.toContain('204');
    });

    await and('both pairs report identical comparison stats', () => {
      expect(alternatingResult.stats).toEqual(uniformResult.stats);
    });

    await and('both outputs mark only the genuine edits', () => {
      for (const xml of [alternatingXml, uniformXml]) {
        const deleted = delTexts(xml).join('');
        expect(deleted).toContain('Legacy');
        expect(deleted).not.toContain('$');
        expect(xml).toContain('$204,000.00');
      }
    });
  });

  test('bracket removal around unchanged words does not strike the words', async ({ given, when, then, and }: AllureBddContext) => {
    let source!: Buffer;
    let revised!: Buffer;
    let xml!: string;

    await given('a source with "[or officer]" split across rsid-fragmented runs and a bracketless revision', async () => {
      // Reduced from the NVCA COI pair: premerge heals the run fragmentation,
      // so tokenization must split the brackets into their own atoms or the
      // unchanged words "or" / "officer" get struck and reinserted.
      source = await buildDocxFromBodyXml(
        '<w:p>' +
          '<w:r w:rsidRPr="00F9719D" w:rsidR="00932CCC"><w:t xml:space="preserve">No director [or</w:t></w:r>' +
          '<w:r w:rsidR="00932CCC"><w:t xml:space="preserve"> officer]</w:t></w:r>' +
          '<w:r w:rsidRPr="00F9719D" w:rsidR="00932CCC"><w:t xml:space="preserve"> shall be personally liable. Legacy term applies.</w:t></w:r>' +
          '</w:p>',
      );
      revised = await buildDocxFromBodyXml(
        '<w:p>' +
          '<w:r><w:t xml:space="preserve">No director or officer shall be personally liable. Updated term applies.</w:t></w:r>' +
          '</w:p>',
      );
    });

    await when('the documents are compared in inplace mode', async () => {
      const result = await compareDocuments(source, revised, {
        comparisonStrategy: 'legacy',
        reconstructionMode: 'inplace',
      });
      xml = await documentXml(result.document);
    });

    await then('only the brackets and the genuine edit are deleted', () => {
      const deleted = delTexts(xml);
      expect(deleted).toContain('[');
      expect(deleted).toContain(']');
      expect(deleted.join(' ')).toContain('Legacy');
      expect(deleted.join(' ')).not.toContain('or');
      expect(deleted.join(' ')).not.toContain('officer');
    });

    await and('the unchanged words are not reinserted', () => {
      const inserted = [...xml.matchAll(/<w:ins [^>]*>([\s\S]*?)<\/w:ins>/g)]
        .flatMap((m) => [...m[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]!))
        .join(' ');
      expect(inserted).toContain('Updated');
      expect(inserted).not.toContain('officer');
    });
  });
});
