import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { DocxDocument } from './document.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { OOXML, W } from './namespaces.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Primitives' });

const W_NS = OOXML.W_NS;

type DocxDocumentConstructor = new (
  zip: unknown,
  documentXml: Document,
  stylesXml: Document | null,
  numberingXml: Document | null,
  footnotesXml: Document | null,
  relsMap: Map<string, string>,
) => DocxDocument;

function makeDocxDocument(bodyXml: string): DocxDocument {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  const documentXml = parseXml(xml);
  const Ctor = DocxDocument as unknown as DocxDocumentConstructor;
  return new Ctor({} as object, documentXml, null, null, null, new Map<string, string>());
}

function createIndexedDocument(bodyXml: string): { document: DocxDocument; paragraphIds: string[] } {
  const document = makeDocxDocument(bodyXml);
  document.insertParagraphBookmarks('attachment-1');
  const paragraphIds = document.getParagraphs().map((paragraph) => {
    const id = getParagraphBookmarkId(paragraph);
    if (!id) throw new Error('Expected paragraph bookmark');
    return id;
  });
  return { document, paragraphIds };
}

function paragraphById(document: DocxDocument, paragraphId: string): Element {
  const paragraph = document.getParagraphElementById(paragraphId);
  if (!paragraph) throw new Error(`Missing paragraph ${paragraphId}`);
  return paragraph;
}

function paragraphOrder(document: DocxDocument): string[] {
  return document.getParagraphs().map((paragraph) => {
    const id = getParagraphBookmarkId(paragraph);
    if (!id) throw new Error('Expected paragraph bookmark');
    return id;
  });
}

function paragraphText(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagNameNS(W_NS, W.t))
    .map((node) => node.textContent ?? '')
    .join('');
}

function revisionId(element: Element): number {
  const raw = element.getAttribute('w:id') ?? element.getAttributeNS(W_NS, 'id');
  if (!raw) throw new Error('Expected revision ID');
  return Number(raw);
}

function getTrackedInsertionNodes(paragraph: Element): { paragraphMark: Element; runInsertion: Element } {
  const pPr = getDirectChildrenByName(paragraph, W.pPr)[0];
  expect(pPr).toBeDefined();

  const rPr = pPr ? getDirectChildrenByName(pPr, W.rPr)[0] : undefined;
  expect(rPr).toBeDefined();

  const paragraphMarkers = rPr ? getDirectChildrenByName(rPr, 'ins') : [];
  const runInsertions = getDirectChildrenByName(paragraph, 'ins');

  expect(paragraphMarkers).toHaveLength(1);
  expect(runInsertions).toHaveLength(1);

  return {
    paragraphMark: paragraphMarkers[0]!,
    runInsertion: runInsertions[0]!,
  };
}

function trackedInsertionIds(document: DocxDocument): number[] {
  const cloned = document.getDocumentXmlClone();
  return Array.from(cloned.getElementsByTagNameNS(W_NS, 'ins')).map((element) => revisionId(element as Element));
}

describe('DocxDocument.insertParagraph tracked-change emission', () => {
  test('emits paragraph-mark and run-level insertion revisions for tracked AFTER insertion', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let insertedParagraphId: string;
    let insertedParagraph: Element;

    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-05-03T14:15:16Z',
      idState: createRevisionIdState(),
    });

    await given('an indexed document with two formatted paragraphs', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Anchor one</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Anchor two</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('a tracked paragraph is inserted after the anchor', () => {
      const result = document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted after',
        },
        ctx,
      );
      insertedParagraphId = result.newParagraphId;
      insertedParagraph = paragraphById(document, insertedParagraphId);
    });

    await then('the new paragraph carries distinct paragraph-mark and run-level insertion IDs after the anchor', () => {
      const { paragraphMark, runInsertion } = getTrackedInsertionNodes(insertedParagraph);
      expect(paragraphMark.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(paragraphMark.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
      expect(runInsertion.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(runInsertion.getAttribute('w:date')).toBe('2026-05-03T14:15:16Z');
      expect(revisionId(paragraphMark)).not.toBe(revisionId(runInsertion));
      expect(Array.from(runInsertion.getElementsByTagNameNS(W_NS, W.r))).toHaveLength(1);
      expect(paragraphText(insertedParagraph)).toBe('Inserted after');

      const order = paragraphOrder(document);
      expect(order.indexOf(insertedParagraphId)).toBe(order.indexOf(anchorId) + 1);
    });
  });

  test('emits paragraph-mark and run-level insertion revisions for tracked BEFORE insertion', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let insertedParagraphId: string;
    let insertedParagraph: Element;

    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-05-03T14:15:16Z',
      idState: createRevisionIdState(),
    });

    await given('an indexed document with two paragraphs', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Anchor one</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Anchor two</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('a tracked paragraph is inserted before the anchor', () => {
      const result = document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'BEFORE',
          newText: 'Inserted before',
        },
        ctx,
      );
      insertedParagraphId = result.newParagraphId;
      insertedParagraph = paragraphById(document, insertedParagraphId);
    });

    await then('the new paragraph is wrapped in tracked insertion markup before the anchor', () => {
      const { paragraphMark, runInsertion } = getTrackedInsertionNodes(insertedParagraph);
      expect(revisionId(paragraphMark)).not.toBe(revisionId(runInsertion));
      expect(paragraphText(insertedParagraph)).toBe('Inserted before');

      const order = paragraphOrder(document);
      expect(order.indexOf(insertedParagraphId)).toBe(order.indexOf(anchorId) - 1);
    });
  });

  test('allocates a unique tracked paragraph-mark and run-level insertion pair for each inserted paragraph', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let insertedParagraphIds: string[];
    let emittedIds: number[];

    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-05-03T14:15:16Z',
      idState: createRevisionIdState(),
    });

    await given('an indexed document with a single anchor paragraph', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>Anchor</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('two paragraphs are inserted in one tracked call', () => {
      const result = document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted one\n\nInserted two',
        },
        ctx,
      );
      insertedParagraphIds = result.newParagraphIds;
      emittedIds = insertedParagraphIds.flatMap((paragraphId) => {
        const { paragraphMark, runInsertion } = getTrackedInsertionNodes(paragraphById(document, paragraphId));
        return [revisionId(paragraphMark), revisionId(runInsertion)];
      });
    });

    await then('each new paragraph gets its own distinct revision ID pair in insertion order', () => {
      expect(insertedParagraphIds).toHaveLength(2);
      expect(paragraphText(paragraphById(document, insertedParagraphIds[0]!))).toBe('Inserted one');
      expect(paragraphText(paragraphById(document, insertedParagraphIds[1]!))).toBe('Inserted two');
      expect(new Set(emittedIds).size).toBe(4);
      expect(emittedIds.slice().sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);

      const order = paragraphOrder(document);
      expect(order.indexOf(insertedParagraphIds[0]!)).toBe(order.indexOf(anchorId) + 1);
      expect(order.indexOf(insertedParagraphIds[1]!)).toBe(order.indexOf(insertedParagraphIds[0]!) + 1);
    });
  });

  test('preserves legacy untracked insertion behavior when revision context is omitted', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let insertedParagraphId: string;
    let insertedParagraph: Element;

    await given('an indexed document with a paragraph anchor', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('a paragraph is inserted without tracked-change context', () => {
      const result = document.insertParagraph({
        positionalAnchorNodeId: anchorId,
        relativePosition: 'AFTER',
        newText: 'Plain insertion',
      });
      insertedParagraphId = result.newParagraphId;
      insertedParagraph = paragraphById(document, insertedParagraphId);
    });

    await then('the inserted paragraph remains unwrapped and no w:ins markup appears anywhere', () => {
      expect(getDirectChildrenByName(insertedParagraph, 'ins')).toHaveLength(0);
      expect(getDirectChildrenByName(insertedParagraph, W.r)).toHaveLength(1);
      expect(paragraphText(insertedParagraph)).toBe('Plain insertion');
      expect(document.getDocumentXmlClone().getElementsByTagNameNS(W_NS, 'ins')).toHaveLength(0);
    });
  });

  test('emits tracked paragraph insertion markup even when styleSourceId falls back to the anchor paragraph', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let insertedParagraphId: string;
    let styleSourceFallback: boolean | undefined;

    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-05-03T14:15:16Z',
      idState: createRevisionIdState(),
    });

    await given('an indexed document with a single paragraph anchor', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:t>Anchor</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('tracked insertion requests a missing style source', () => {
      const result = document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Fallback insertion',
          styleSourceId: 'nonexistent',
        },
        ctx,
      );
      insertedParagraphId = result.newParagraphId;
      styleSourceFallback = result.styleSourceFallback;
    });

    await then('the insertion still emits paragraph-mark and run-level w:ins wrappers', () => {
      const { paragraphMark, runInsertion } = getTrackedInsertionNodes(paragraphById(document, insertedParagraphId));
      expect(styleSourceFallback).toBe(true);
      expect(revisionId(paragraphMark)).not.toBe(revisionId(runInsertion));
    });
  });

  test('reuses shared revision state across multiple tracked insertParagraph calls without ID collisions', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let emittedIds: number[];

    const ctx = createRevisionContext({
      author: 'SafeDocX AI',
      date: '2026-05-03T14:15:16Z',
      idState: createRevisionIdState(),
    });

    await given('an indexed document with one anchor paragraph and a shared revision context', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>`,
      );
      document = indexed.document;
      anchorId = indexed.paragraphIds[0]!;
    });

    await when('tracked paragraph insertion is invoked twice with the same context', () => {
      const first = document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'First insertion',
        },
        ctx,
      );
      document.insertParagraph(
        {
          positionalAnchorNodeId: first.newParagraphId,
          relativePosition: 'AFTER',
          newText: 'Second insertion',
        },
        ctx,
      );
      emittedIds = trackedInsertionIds(document);
    });

    await then('all four emitted insertion IDs remain unique across both calls', () => {
      expect(emittedIds).toHaveLength(4);
      expect(new Set(emittedIds).size).toBe(4);
      expect(emittedIds.slice().sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
    });
  });

  test('strips stale revision markup from style source while preserving inherited formatting', async ({ given, when, then }: AllureBddContext) => {
    let document: DocxDocument;
    let anchorId: string;
    let styleSourceId: string;
    let insertedParagraph: Element;

    await given('an anchor and a style-source paragraph that already carries revision markup', () => {
      const indexed = createIndexedDocument(
        `<w:p>` +
          `<w:pPr><w:jc w:val="center"/></w:pPr>` +
          `<w:r><w:t>Anchor</w:t></w:r>` +
        `</w:p>` +
        `<w:p>` +
          `<w:pPr>` +
            `<w:jc w:val="center"/>` +
            `<w:spacing w:before="240"/>` +
            `<w:rPr>` +
              `<w:ins w:id="900" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z"/>` +
              `<w:rPrChange w:id="901" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange>` +
            `</w:rPr>` +
            `<w:pPrChange w:id="902" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z"><w:pPr/></w:pPrChange>` +
          `</w:pPr>` +
          `<w:r><w:rPr><w:rPrChange w:id="903" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>Source</w:t></w:r>` +
        `</w:p>`,
      );
      document = indexed.document;
      [anchorId, styleSourceId] = indexed.paragraphIds as [string, string];
    });

    await when('a tracked insertion uses that paragraph as the style source', () => {
      document.insertParagraph(
        {
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Fresh paragraph',
          styleSourceId,
        },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T22:30:00Z',
          // Seeded above the fixture's stale ids (900-903), matching the
          // session invariant that startId exceeds every pre-existing
          // revision id (inferStartingRevisionIdState).
          idState: createRevisionIdState(904),
        }),
      );
      const insertedId = paragraphOrder(document)[1]!;
      insertedParagraph = paragraphById(document, insertedId);
    });

    await then('only the fresh AI revision markers remain and inherited formatting is preserved', () => {
      const pPr = getDirectChildrenByName(insertedParagraph, W.pPr)[0]!;
      const rPr = getDirectChildrenByName(pPr, W.rPr)[0]!;

      // Inherited formatting from the style source survives.
      expect(getDirectChildrenByName(pPr, 'jc')).toHaveLength(1);
      expect(getDirectChildrenByName(pPr, 'spacing')).toHaveLength(1);

      // Stale paragraph-level revision markup was stripped.
      expect(getDirectChildrenByName(pPr, 'pPrChange')).toHaveLength(0);

      // Only the fresh paragraph-mark <w:ins/> remains in rPr.
      const insMarkers = getDirectChildrenByName(rPr, 'ins');
      expect(insMarkers).toHaveLength(1);
      expect(insMarkers[0]!.getAttribute('w:author')).toBe('SafeDocX AI');
      expect(insMarkers[0]!.getAttribute('w:id')).not.toBe('900');

      // Stale rPrChange in rPr was stripped.
      expect(getDirectChildrenByName(rPr, 'rPrChange')).toHaveLength(0);

      // Run inside the new <w:ins> wrapper does NOT carry the source run's rPrChange.
      const runWrapper = getDirectChildrenByName(insertedParagraph, 'ins')[0]!;
      const runs = getDirectChildrenByName(runWrapper, W.r);
      expect(runs).toHaveLength(1);
      const runRPr = getDirectChildrenByName(runs[0]!, W.rPr)[0];
      if (runRPr) {
        expect(getDirectChildrenByName(runRPr, 'rPrChange')).toHaveLength(0);
      }

      // Visible content is the new text.
      expect(paragraphText(insertedParagraph)).toBe('Fresh paragraph');
    });
  });
});
