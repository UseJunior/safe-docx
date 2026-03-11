import { describe, expect } from 'vitest';
import { parseXml } from '../src/primitives/xml.js';
import { OOXML, W } from '../src/primitives/namespaces.js';
import { mergeRuns } from '../src/primitives/merge_runs.js';
import { simplifyRedlines } from '../src/primitives/simplify_redlines.js';
import { type AllureBddContext, testAllure } from './helpers/allure-test.js';

const W_NS = OOXML.W_NS;

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Normalization' });

const humanReadableTest = test.allure({

  tags: ['human-readable'],

  parameters: { audience: 'non-technical' },

});

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

function countWrappers(doc: Document, localName: string): number {
  return doc.getElementsByTagNameNS(W_NS, localName).length;
}

describe('Traceability: Auto-Normalization on Open — Run Merging', () => {
  humanReadableTest.openspec('merge adjacent runs with equivalent formatting')('Scenario: merge adjacent runs with equivalent formatting', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof mergeRuns>;

    await given('a document with two adjacent bold runs', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>World</w:t></w:r>' +
        '</w:p>',
      );
    });

    await when('merge_runs is called on adjacent format-identical runs', async () => {
      result = mergeRuns(doc);
      await attachPrettyJson('merge_runs result', result);
    });

    await then('the adjacent runs are consolidated into a single run', async () => {
      expect(result.runsMerged).toBeGreaterThanOrEqual(1);
      expect(countRuns(doc)).toBe(1);
    });

    await and('the merged run preserves the original visible text and formatting', async () => {
      expect(bodyText(doc)).toBe('Hello World');
      const rPr = doc.getElementsByTagNameNS(W_NS, W.rPr).item(0);
      expect(rPr).toBeTruthy();
      expect(rPr!.getElementsByTagNameNS(W_NS, W.b).length).toBe(1);
    });
  });

  humanReadableTest.openspec('never merge across field boundaries')('Scenario: never merge across field boundaries', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof mergeRuns>;

    await given('a document with runs separated by fldChar elements', async () => {
      doc = makeDoc(
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
    });

    await when('merge_runs is called on runs separated by fldChar elements', async () => {
      result = mergeRuns(doc);
      await attachPrettyJson('merge_runs result', result);
    });

    await then('the runs are not merged across the field boundary', async () => {
      expect(result.runsMerged).toBe(0);
    });

    await and('field structure remains intact', async () => {
      expect(countRuns(doc)).toBe(7);
      expect(bodyText(doc)).toContain('Before');
      expect(bodyText(doc)).toContain('After');
    });
  });

  humanReadableTest.openspec('never merge across comment range boundaries')('Scenario: never merge across comment range boundaries', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof mergeRuns>;

    await given('a document with runs separated by comment range markers', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:commentRangeStart w:id="0"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/>' +
        '</w:p>',
      );
    });

    await when('merge_runs is called on runs separated by comment range markers', async () => {
      result = mergeRuns(doc);
      await attachPrettyJson('merge_runs result', result);
    });

    await then('the runs are not merged across comment range boundaries', async () => {
      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });
  });

  humanReadableTest.openspec('never merge across bookmark boundaries')('Scenario: never merge across bookmark boundaries', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof mergeRuns>;

    await given('a document with runs separated by bookmark markers', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:r><w:t>Before</w:t></w:r>' +
        '<w:bookmarkStart w:id="0" w:name="bm1"/>' +
        '<w:r><w:t>After</w:t></w:r>' +
        '<w:bookmarkEnd w:id="0"/>' +
        '</w:p>',
      );
    });

    await when('merge_runs is called on runs separated by bookmark markers', async () => {
      result = mergeRuns(doc);
      await attachPrettyJson('merge_runs result', result);
    });

    await then('the runs are not merged across bookmark boundaries', async () => {
      expect(result.runsMerged).toBe(0);
      expect(countRuns(doc)).toBe(2);
    });
  });

  humanReadableTest.openspec('never merge across tracked-change wrapper boundaries')('Scenario: never merge across tracked-change wrapper boundaries', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof mergeRuns>;

    await given('a document with runs in different tracked-change wrappers', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="A" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Inserted1</w:t></w:r>' +
        '</w:ins>' +
        '<w:del w:id="2" w:author="A" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Deleted1</w:t></w:r>' +
        '</w:del>' +
        '</w:p>',
      );
    });

    await when('merge_runs is called on runs in different tracked-change wrappers', async () => {
      result = mergeRuns(doc);
      await attachPrettyJson('merge_runs result', result);
    });

    await then('runs in different tracked-change wrappers are not merged', async () => {
      expect(result.runsMerged).toBe(0);
    });
  });
});

describe('Traceability: Auto-Normalization on Open — Redline Simplification', () => {
  humanReadableTest.openspec('merge adjacent same-author same-type tracked-change wrappers')('Scenario: merge adjacent same-author same-type tracked-change wrappers', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof simplifyRedlines>;

    await given('a document with adjacent same-author w:ins wrappers', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Hello </w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>World</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );
    });

    await when('simplify_redlines is called on adjacent same-author w:ins wrappers', async () => {
      result = simplifyRedlines(doc);
      await attachPrettyJson('simplify_redlines result', result);
    });

    await then('the adjacent wrappers are consolidated into a single wrapper', async () => {
      expect(result.wrappersConsolidated).toBeGreaterThanOrEqual(1);
      expect(countWrappers(doc, 'ins')).toBe(1);
    });

    await and('the merged wrapper preserves all child content', async () => {
      expect(bodyText(doc)).toBe('Hello World');
    });
  });

  humanReadableTest.openspec('never merge wrappers from different authors')('Scenario: never merge wrappers from different authors', async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof simplifyRedlines>;

    await given('a document with adjacent different-author w:ins wrappers', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Alice text</w:t></w:r>' +
        '</w:ins>' +
        '<w:ins w:id="2" w:author="Bob" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Bob text</w:t></w:r>' +
        '</w:ins>' +
        '</w:p>',
      );
    });

    await when('simplify_redlines is called on adjacent different-author wrappers', async () => {
      result = simplifyRedlines(doc);
      await attachPrettyJson('simplify_redlines result', result);
    });

    await then('the wrappers are not merged', async () => {
      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(2);
    });

    await and('author attribution is preserved', async () => {
      const wrappers = doc.getElementsByTagNameNS(W_NS, 'ins');
      const authors = new Set<string>();
      for (let i = 0; i < wrappers.length; i++) {
        authors.add(wrappers.item(i)!.getAttribute('w:author') ?? '');
      }
      expect(authors).toEqual(new Set(['Alice', 'Bob']));
    });
  });

  humanReadableTest.openspec('never merge across different change types')('Scenario: never merge across different change types', async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
    let doc: Document;
    let result: ReturnType<typeof simplifyRedlines>;

    await given('a document with adjacent w:ins and w:del from the same author', async () => {
      doc = makeDoc(
        '<w:p>' +
        '<w:ins w:id="1" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>New</w:t></w:r>' +
        '</w:ins>' +
        '<w:del w:id="2" w:author="Alice" w:date="2025-01-01T00:00:00Z">' +
        '<w:r><w:t>Old</w:t></w:r>' +
        '</w:del>' +
        '</w:p>',
      );
    });

    await when('simplify_redlines is called on adjacent w:ins + w:del from same author', async () => {
      result = simplifyRedlines(doc);
      await attachPrettyJson('simplify_redlines result', result);
    });

    await then('the wrappers are not merged', async () => {
      expect(result.wrappersConsolidated).toBe(0);
      expect(countWrappers(doc, 'ins')).toBe(1);
      expect(countWrappers(doc, 'del')).toBe(1);
    });
  });
});
