import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { childElements } from './dom-helpers.js';
import { OOXML } from './namespaces.js';
import { parseXml } from './xml.js';
import {
  allocateRevisionId,
  buildPPrChangeElement,
  buildRPrChangeElement,
  createRevisionContainer,
  createRevisionContext,
  createRevisionIdState,
  wrapElementWithDel,
  wrapElementWithIns,
} from './track-changes-emitter.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Track Changes Emitter',
});

function parseFragment(fragment: string): Element {
  const doc = parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<root xmlns:w="${OOXML.W_NS}">${fragment}</root>`,
  );
  const element = childElements(doc.documentElement)[0];
  if (!element) throw new Error('missing fragment root');
  return element;
}

function serialize(element: Element): string {
  return new XMLSerializer().serializeToString(element);
}

describe('track-changes-emitter', () => {
  test('wrapElementWithIns emits a valid w:ins wrapper', async ({ given, when, then }: AllureBddContext) => {
    let run: Element;
    let serialized: string;

    await given('a run element and a shared revision context', () => {
      run = parseFragment('<w:r><w:t>Hello</w:t></w:r>');
    });

    await when('wrapElementWithIns wraps the run', () => {
      serialized = serialize(
        wrapElementWithIns(
          run,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('the serialized wrapper includes the tracked-change metadata and content', () => {
      expect(serialized).toContain('<w:ins ');
      expect(serialized).toContain('w:id="1"');
      expect(serialized).toContain('w:author="Comparison"');
      expect(serialized).toContain('w:date="2026-05-03T14:15:16Z"');
      expect(serialized).toContain('<w:r><w:t>Hello</w:t></w:r>');
    });
  });

  test('wrapElementWithDel converts text and field instruction descendants', async ({ given, when, then }: AllureBddContext) => {
    let run: Element;
    let serialized: string;

    await given('a run containing both visible text and field instructions', () => {
      run = parseFragment(
        '<w:r><w:t xml:space="preserve"> Hello </w:t><w:instrText>PAGE</w:instrText></w:r>',
      );
    });

    await when('wrapElementWithDel wraps the run', () => {
      serialized = serialize(
        wrapElementWithDel(
          run,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('deletion-specific text tags are emitted', () => {
      expect(serialized).toContain('<w:del ');
      expect(serialized).toContain('<w:delText xml:space="preserve"> Hello </w:delText>');
      expect(serialized).toContain('<w:delInstrText>PAGE</w:delInstrText>');
      expect(serialized).not.toContain('<w:t');
      expect(serialized).not.toContain('<w:instrText');
    });
  });

  test('createRevisionContainer allocates tracked-change metadata for caller-owned content', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let serialized: string;

    await given('a document and a shared revision context', () => {
      doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?><root xmlns:w="${OOXML.W_NS}"/>`);
    });

    await when('a deletion container is created for multi-run ownership', () => {
      serialized = serialize(
        createRevisionContainer(
          doc,
          'del',
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('the wrapper includes revision metadata and no placeholder children', () => {
      expect(serialized).toContain('<w:del ');
      expect(serialized).toContain('w:id="1"');
      expect(serialized).toContain('w:author="Comparison"');
      expect(serialized).toContain('w:date="2026-05-03T14:15:16Z"');
      expect(serialized).not.toContain('<w:r');
    });
  });

  test('RevisionIdState allocates monotonically increasing unique IDs', async ({ given, when, then }: AllureBddContext) => {
    let ids: number[];

    await given('a fresh revision ID state', () => {
      ids = [];
    });

    await when('multiple IDs are allocated from the shared state', () => {
      const state = createRevisionIdState();
      ids = [allocateRevisionId(state), allocateRevisionId(state), allocateRevisionId(state)];
    });

    await then('each allocated ID is unique and increasing', () => {
      expect(ids).toEqual([1, 2, 3]);
      expect(new Set(ids).size).toBe(3);
    });
  });

  test('buildPPrChangeElement snapshots prior paragraph properties in CT_PPrBase form', async ({ given, when, then }: AllureBddContext) => {
    let pPr: Element;
    let serialized: string;

    await given('a paragraph properties element with paragraph and run properties', () => {
      pPr = parseFragment(
        '<w:pPr><w:spacing w:before="120"/><w:rPr><w:b/></w:rPr><w:sectPr/></w:pPr>',
      );
    });

    await when('buildPPrChangeElement snapshots the previous state', () => {
      serialized = serialize(
        buildPPrChangeElement(
          pPr,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('the change element contains only valid prior paragraph property children', () => {
      expect(serialized).toContain('<w:pPrChange ');
      expect(serialized).toContain('<w:pPr><w:spacing w:before="120"/></w:pPr>');
      expect(serialized).not.toContain('<w:rPr>');
      expect(serialized).not.toContain('<w:sectPr');
    });
  });

  test('buildRPrChangeElement snapshots prior run properties without nested rPrChange', async ({ given, when, then }: AllureBddContext) => {
    let rPr: Element;
    let serialized: string;

    await given('a run properties element that already contains a nested rPrChange', () => {
      rPr = parseFragment('<w:rPr><w:b/><w:rPrChange w:id="99"/></w:rPr>');
    });

    await when('buildRPrChangeElement snapshots the previous state', () => {
      serialized = serialize(
        buildRPrChangeElement(
          rPr,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('the generated wrapper contains the old run properties inside a single w:rPr', () => {
      expect(serialized).toContain('<w:rPrChange ');
      expect(serialized).toContain('<w:rPr><w:b/></w:rPr>');
      expect(serialized).not.toContain('w:rPrChange w:id="99"');
    });
  });
});
