import { describe, expect } from 'vitest';
import { itAllure, allureStep, allureJsonAttachment } from './testing/allure-test.js';

const it = itAllure;
import { parseXml } from './xml.js';
import { OOXML, W } from './namespaces.js';
import { mergeRuns } from './merge_runs.js';

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function countRuns(doc: Document): number {
  return doc.getElementsByTagNameNS(W_NS, W.r).length;
}

function bodyText(doc: Document): string {
  const texts: string[] = [];
  const ts = doc.getElementsByTagNameNS(W_NS, W.t);
  for (let i = 0; i < ts.length; i++) {
    texts.push(ts.item(i)!.textContent ?? '');
  }
  return texts.join('');
}

describe('merge_runs', () => {
  describe('basic merging', () => {
    it('merges two adjacent runs with identical formatting', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(1);
      expect(countRuns(doc)).toBe(1);
      expect(bodyText(doc)).toBe('Hello World');
    });

    it('merges three adjacent identical runs into one', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '<w:r><w:t>C</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(2);
      expect(countRuns(doc)).toBe(1);
      expect(bodyText(doc)).toBe('ABC');
    });

    it('does not merge runs with different formatting', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>Italic</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('merges runs that differ only in rsid attributes', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r w:rsidR="00A1"><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>' +
        '<w:r w:rsidR="00B2"><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(1);
      expect(countRuns(doc)).toBe(1);
      expect(bodyText(doc)).toBe('AB');
    });

    it('handles runs with no rPr (both empty = identical)', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(1);
      expect(bodyText(doc)).toBe('AB');
    });
  });

  describe('proofErr removal', () => {
    it('removes proofErr elements from paragraphs', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:proofErr w:type="spellStart"/>' +
        '<w:r><w:t>teh</w:t></w:r>' +
        '<w:proofErr w:type="spellEnd"/>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.proofErrRemoved).toBe(2);
      const proofErrs = doc.getElementsByTagNameNS(W_NS, 'proofErr');
      expect(proofErrs.length).toBe(0);
    });
  });

  describe('safety barriers', () => {
    it('does NOT merge across fldChar boundaries (as sibling)', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:fldChar w:fldCharType="begin"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge runs that contain fldChar children', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Amount: </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> MERGEFIELD Amount </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>100</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t> due.</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      // The 7 runs must remain separate: field runs should never merge.
      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(7);
    });

    it('does NOT merge across instrText boundaries', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:instrText> PAGE </w:instrText>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge across bookmarkStart boundaries', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge across bookmarkEnd boundaries', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:bookmarkEnd w:id="0"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge across commentRangeStart boundaries', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:commentRangeStart w:id="0"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge across commentRangeEnd boundaries', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });

    it('does NOT merge runs in different tracked-change wrappers', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Inserted1</w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="A" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Inserted2</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      // Each wrapper is its own container — runs from different wrappers
      // are never in the same group.
      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
    });
  });

  describe('merging inside tracked-change wrappers', () => {
    it('merges identical runs within the same w:ins wrapper', () => {
      const doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>A</w:t></w:r>' +
        '<w:r><w:t>B</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(1);
      expect(bodyText(doc)).toBe('AB');
    });
  });

  describe('edge cases', () => {
    it('returns zeros for empty body', () => {
      const doc = makeDoc('');

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(result.proofErrRemoved).toBe(0);
    });

    it('handles single-run paragraphs without error', () => {
      const doc = makeDoc(
        '<w:p><w:r><w:t>Only</w:t></w:r></w:p>',
      );

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(bodyText(doc)).toBe('Only');
    });

    it('handles document with no body element', () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"/>`;
      const doc = parseXml(xml);

      const result = mergeRuns(doc);

      expect(result.runsMerged).toBe(0);
      expect(result.proofErrRemoved).toBe(0);
    });
  });
});

const TEST_FEATURE = 'add-auto-normalization-on-open';

const humanReadableIt = itAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE }).allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('Traceability: Auto-Normalization on Open — Run Merging', () => {
  humanReadableIt.openspec('merge adjacent runs with equivalent formatting')('Scenario: merge adjacent runs with equivalent formatting', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>' +
      '</w:p>',
    );

    const result = await allureStep('When merge_runs is called on adjacent format-identical runs', async () => {
      const r = mergeRuns(doc);
      await allureJsonAttachment('merge_runs result', r);
      return r;
    });

    await allureStep('Then the adjacent runs SHALL be consolidated into a single run', () => {
      expect(result.runsMerged).toBeGreaterThanOrEqual(1);
      expect(countRuns(doc)).toBe(1);
    });

    await allureStep('And the merged run SHALL preserve the original visible text and formatting', () => {
      expect(bodyText(doc)).toBe('Hello World');
      const rPr = doc.getElementsByTagNameNS(W_NS, W.rPr).item(0);
      expect(rPr).toBeTruthy();
      expect(rPr!.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
    });
  });

  humanReadableIt.openspec('never merge across field boundaries')('Scenario: never merge across field boundaries', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:r><w:t>Before</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText> MERGEFIELD Name </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>Value</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:r><w:t>After</w:t></w:r>' +
      '</w:p>',
    );

    const result = await allureStep('When merge_runs is called on runs separated by fldChar elements', async () => {
      const r = mergeRuns(doc);
      await allureJsonAttachment('merge_runs result', r);
      return r;
    });

    await allureStep('Then the runs SHALL NOT be merged across the field boundary', () => {
      expect(result.runsMerged).toBe(0);
    });

    await allureStep('And field structure SHALL remain intact', () => {
      expect(countRuns(doc)).toBe(7);
      expect(bodyText(doc)).toContain('Before');
      expect(bodyText(doc)).toContain('After');
    });
  });

  humanReadableIt.openspec('never merge across comment range boundaries')('Scenario: never merge across comment range boundaries', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:r><w:t>Before</w:t></w:r>' +
      '<w:commentRangeStart w:id="0"/>' +
      '<w:r><w:t>After</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/>' +
      '</w:p>',
    );

    const result = await allureStep('When merge_runs is called on runs separated by comment range markers', async () => {
      const r = mergeRuns(doc);
      await allureJsonAttachment('merge_runs result', r);
      return r;
    });

    await allureStep('Then the runs SHALL NOT be merged across comment range boundaries', () => {
      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });
  });

  humanReadableIt.openspec('never merge across bookmark boundaries')('Scenario: never merge across bookmark boundaries', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:r><w:t>Before</w:t></w:r>' +
      '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
      '<w:r><w:t>After</w:t></w:r>' +
      '<w:bookmarkEnd w:id="0"/>' +
      '</w:p>',
    );

    const result = await allureStep('When merge_runs is called on runs separated by bookmark markers', async () => {
      const r = mergeRuns(doc);
      await allureJsonAttachment('merge_runs result', r);
      return r;
    });

    await allureStep('Then the runs SHALL NOT be merged across bookmark boundaries', () => {
      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });
  });

  humanReadableIt.openspec('never merge across tracked-change wrapper boundaries')('Scenario: never merge across tracked-change wrapper boundaries', async () => {
    const doc = makeDoc(
      '<w:p>' +
      '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
      '<w:r><w:t>Inserted1</w:t></w:r>' +
      '</w:ins>' +
      '<w:del w:id="2" w:author="A" w:date="2025-01-01T00:00:00Z">' +
      '<w:r><w:t>Deleted1</w:t></w:r>' +
      '</w:del>' +
      '</w:p>',
    );

    const result = await allureStep('When merge_runs is called on runs in different tracked-change wrappers', async () => {
      const r = mergeRuns(doc);
      await allureJsonAttachment('merge_runs result', r);
      return r;
    });

    await allureStep('Then runs in different tracked-change wrappers SHALL NOT be merged', () => {
      expect(result.runsMerged).toBe(0);
    });
  });
});
