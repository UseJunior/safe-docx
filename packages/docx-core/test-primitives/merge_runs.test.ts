import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { mergeRuns } from '../src/primitives/merge_runs.js';

const W_NS = OOXML.W_NS;

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Run Merging' });

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
    test('merges two adjacent runs with identical formatting', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with two adjacent bold runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('1 run is merged and 1 run remains', () => {
        expect(result.runsMerged).toBe(1);
        expect(countRuns(doc)).toBe(1);
      });
      await and('the combined text is Hello World', () => {
        expect(bodyText(doc)).toBe('Hello World');
      });
    });

    test('merges three adjacent identical runs into one', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with three adjacent plain runs A B C', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>A</w:t></w:r>' +
          '<w:r><w:t>B</w:t></w:r>' +
          '<w:r><w:t>C</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('2 runs are merged and 1 run remains', () => {
        expect(result.runsMerged).toBe(2);
        expect(countRuns(doc)).toBe(1);
      });
      await and('the combined text is ABC', () => {
        expect(bodyText(doc)).toBe('ABC');
      });
    });

    test('does not merge runs with different formatting', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a bold run followed by an italic run', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>' +
          '<w:r><w:rPr><w:i/></w:rPr><w:t>Italic</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged', () => {
        expect(result.runsMerged).toBe(0);
      });
      await and('both runs remain', () => {
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('merges runs that differ only in rsid attributes', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('two bold runs with different w:rsidR attributes', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r w:rsidR="00A1"><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>' +
          '<w:r w:rsidR="00B2"><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('1 run is merged and 1 remains', () => {
        expect(result.runsMerged).toBe(1);
        expect(countRuns(doc)).toBe(1);
      });
      await and('the combined text is AB', () => {
        expect(bodyText(doc)).toBe('AB');
      });
    });

    test('handles runs with no rPr (both empty = identical)', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('two plain runs with no rPr elements', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>A</w:t></w:r>' +
          '<w:r><w:t>B</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('1 run is merged', () => {
        expect(result.runsMerged).toBe(1);
      });
      await and('the combined text is AB', () => {
        expect(bodyText(doc)).toBe('AB');
      });
    });
  });

  describe('proofErr removal', () => {
    test('removes proofErr elements from paragraphs', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with spellStart and spellEnd proofErr elements', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:proofErr w:type="spellStart"/>' +
          '<w:r><w:t>teh</w:t></w:r>' +
          '<w:proofErr w:type="spellEnd"/>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('2 proofErr elements are reported as removed', () => {
        expect(result.proofErrRemoved).toBe(2);
      });
      await and('no proofErr elements remain in the document', () => {
        const proofErrs = doc.getElementsByTagNameNS(W_NS, 'proofErr');
        expect(proofErrs.length).toBe(0);
      });
    });
  });

  describe('safety barriers', () => {
    test('does NOT merge across fldChar boundaries (as sibling)', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a fldChar sibling between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:fldChar w:fldCharType="begin"/>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged', () => {
        expect(result.runsMerged).toBe(0);
      });
      await and('both runs remain', () => {
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge runs that contain fldChar children', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with 7 runs forming a complete field sequence', async () => {
        doc = makeDoc(
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
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged', () => {
        // The 7 runs must remain separate: field runs should never merge.
        expect(result.runsMerged).toBe(0);
      });
      await and('all 7 runs remain', () => {
        expect(countRuns(doc)).toBe(7);
      });
    });

    test('does NOT merge across instrText boundaries', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a bare instrText element between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:instrText> PAGE </w:instrText>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged', () => {
        expect(result.runsMerged).toBe(0);
      });
      await and('both runs remain', () => {
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge across bookmarkStart boundaries', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a w:bookmarkStart between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged and both runs remain', () => {
        expect(result.runsMerged).toBe(0);
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge across bookmarkEnd boundaries', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a w:bookmarkEnd between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:bookmarkEnd w:id="0"/>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged and both runs remain', () => {
        expect(result.runsMerged).toBe(0);
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge across commentRangeStart boundaries', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a w:commentRangeStart between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:commentRangeStart w:id="0"/>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged and both runs remain', () => {
        expect(result.runsMerged).toBe(0);
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge across commentRangeEnd boundaries', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with a w:commentRangeEnd between two runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:r><w:t>Before</w:t></w:r>' +
          '<w:commentRangeEnd w:id="0"/>' +
          '<w:r><w:t>After</w:t></w:r>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged and both runs remain', () => {
        expect(result.runsMerged).toBe(0);
        expect(countRuns(doc)).toBe(2);
      });
    });

    test('does NOT merge runs in different tracked-change wrappers', async ({ given, when, then }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with two separate w:ins wrappers each containing a run', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Inserted1</w:t></w:r>' +
          '</w:ins>' +
          '<w:ins w:id="2" w:author="A" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>Inserted2</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        // Each wrapper is its own container — runs from different wrappers
        // are never in the same group.
        result = mergeRuns(doc);
      });
      await then('no runs are merged across wrapper boundaries', () => {
        expect(result.runsMerged).toBe(0);
      });
    });
  });

  describe('merging inside tracked-change wrappers', () => {
    test('merges identical runs within the same w:ins wrapper', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a single w:ins wrapper containing two identical runs', async () => {
        doc = makeDoc(
          '<w:p>' +
          '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
          '<w:r><w:t>A</w:t></w:r>' +
          '<w:r><w:t>B</w:t></w:r>' +
          '</w:ins>' +
          '</w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('1 run is merged inside the wrapper', () => {
        expect(result.runsMerged).toBe(1);
      });
      await and('the combined text is AB', () => {
        expect(bodyText(doc)).toBe('AB');
      });
    });
  });

  describe('edge cases', () => {
    test('returns zeros for empty body', async ({ given, when, then }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a document with an empty body', async () => {
        doc = makeDoc('');
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('runsMerged and proofErrRemoved are both zero', () => {
        expect(result.runsMerged).toBe(0);
        expect(result.proofErrRemoved).toBe(0);
      });
    });

    test('handles single-run paragraphs without error', async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a paragraph with exactly one run', async () => {
        doc = makeDoc(
          '<w:p><w:r><w:t>Only</w:t></w:r></w:p>',
        );
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('no runs are merged', () => {
        expect(result.runsMerged).toBe(0);
      });
      await and('the text is unchanged', () => {
        expect(bodyText(doc)).toBe('Only');
      });
    });

    test('handles document with no body element', async ({ given, when, then }: AllureBddContext) => {
      let doc!: Document;
      let result!: ReturnType<typeof mergeRuns>;
      await given('a document element with no w:body child', async () => {
        const xml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<w:document xmlns:w="${W_NS}"/>`;
        doc = parseXml(xml);
      });
      await when('mergeRuns is called', async () => {
        result = mergeRuns(doc);
      });
      await then('runsMerged and proofErrRemoved are both zero', () => {
        expect(result.runsMerged).toBe(0);
        expect(result.proofErrRemoved).toBe(0);
      });
    });
  });
});
