import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { getParagraphBookmarkId, insertParagraphBookmarks } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';
import { setParagraphSpacing, setTableCellPadding, setTableRowHeight } from './layout.js';
import { OOXML, W } from './namespaces.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import { parseXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Layout Primitives' });

const W_NS = OOXML.W_NS;

function makeDocument(bodyXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${OOXML.W_NS}" xmlns:r="${OOXML.R_NS}">` +
      `<w:body>${bodyXml}</w:body>` +
      `</w:document>`,
  );
}

function createIndexedDocument(bodyXml: string): { doc: Document; paragraphIds: string[] } {
  const doc = makeDocument(bodyXml);
  insertParagraphBookmarks(doc, 'attachment-1');
  const paragraphIds = Array.from(doc.getElementsByTagNameNS(W_NS, W.p)).map((paragraph) => {
    const paragraphId = getParagraphBookmarkId(paragraph as Element);
    if (!paragraphId) throw new Error('Expected paragraph bookmark');
    return paragraphId;
  });
  return { doc, paragraphIds };
}

function firstDirectChild(parent: Element, localName: string): Element {
  const child = getDirectChildrenByName(parent, localName)[0];
  if (!child) throw new Error(`Expected ${localName} under ${parent.localName}`);
  return child;
}

function wordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(W_NS, localName) ??
    element.getAttribute(`w:${localName}`) ??
    element.getAttribute(localName)
  );
}

function revisionId(element: Element): number {
  const raw = wordAttr(element, 'id');
  if (!raw) throw new Error('Expected revision ID');
  return Number(raw);
}

describe('layout tracked-change emission', () => {
  test('setParagraphSpacing emits pPrChange with the prior paragraph properties snapshot', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let paragraphId: string;
    let paragraph: Element;
    let pPr: Element;
    let spacing: Element;
    let pPrChange: Element;
    let previousSpacing: Element;

    await given('a bookmarked paragraph that already has spacing properties', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>`,
      );
      doc = indexed.doc;
      [paragraphId] = indexed.paragraphIds as [string];
    });

    await when('tracked paragraph spacing is updated', () => {
      const result = setParagraphSpacing(
        doc,
        { paragraphIds: [paragraphId], beforeTwips: 240 },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      expect(result).toEqual({ affectedParagraphs: 1, missingParagraphIds: [] });

      paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      pPr = firstDirectChild(paragraph, W.pPr);
      spacing = firstDirectChild(pPr, W.spacing);
      pPrChange = firstDirectChild(pPr, 'pPrChange');
      previousSpacing = firstDirectChild(firstDirectChild(pPrChange, W.pPr), W.spacing);
    });

    await then('the outer spacing is updated while the inner pPr snapshot preserves the old state', () => {
      expect(wordAttr(pPrChange, 'author')).toBe('SafeDocX AI');
      expect(wordAttr(pPrChange, 'date')).toBe('2026-05-03T14:15:16Z');
      expect(revisionId(pPrChange)).toBe(1);
      expect(wordAttr(spacing, 'before')).toBe('240');
      expect(wordAttr(spacing, 'after')).toBe('120');
      expect(wordAttr(previousSpacing, 'before')).toBeNull();
      expect(wordAttr(previousSpacing, 'after')).toBe('120');
    });
  });

  test('setTableRowHeight emits trPrChange with the prior row properties snapshot', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let trPr: Element;
    let trHeight: Element;
    let trPrChange: Element;
    let previousTrHeight: Element;

    await given('a table row that already has a height definition', () => {
      doc = makeDocument(
        `<w:tbl><w:tr><w:trPr><w:trHeight w:val="360" w:hRule="atLeast"/></w:trPr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      );
    });

    await when('tracked row height is updated', () => {
      const result = setTableRowHeight(
        doc,
        { tableIndexes: [0], valueTwips: 480, rule: 'exact' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
      expect(result).toEqual({ affectedRows: 1, missingTableIndexes: [], missingRowIndexes: [] });

      const table = doc.getElementsByTagNameNS(W_NS, W.tbl).item(0) as Element;
      const row = firstDirectChild(table, W.tr);
      trPr = firstDirectChild(row, W.trPr);
      trHeight = firstDirectChild(trPr, W.trHeight);
      trPrChange = firstDirectChild(trPr, 'trPrChange');
      previousTrHeight = firstDirectChild(firstDirectChild(trPrChange, W.trPr), W.trHeight);
    });

    await then('the outer row properties are updated while the inner trPr snapshot preserves the old height', () => {
      expect(wordAttr(trPrChange, 'author')).toBe('SafeDocX AI');
      expect(wordAttr(trPrChange, 'date')).toBe('2026-05-03T14:15:16Z');
      expect(revisionId(trPrChange)).toBe(1);
      expect(wordAttr(trHeight, 'val')).toBe('480');
      expect(wordAttr(trHeight, 'hRule')).toBe('exact');
      expect(wordAttr(previousTrHeight, 'val')).toBe('360');
      expect(wordAttr(previousTrHeight, 'hRule')).toBe('atLeast');
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.68' })(
      'setTableCellPadding emits tcPrChange with the prior cell properties snapshot',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let tcMar: Element;
        let left: Element;
        let tcPrChange: Element;
        let previousTcMar: Element;

        await given('a table cell that already has top padding', () => {
          doc = makeDocument(
            `<w:tbl><w:tr><w:tc><w:tcPr><w:tcMar><w:top w:w="100" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
          );
        });

        await when('tracked left padding is added', () => {
          const result = setTableCellPadding(
            doc,
            { tableIndexes: [0], leftDxa: 240 },
            createRevisionContext({
              author: 'SafeDocX AI',
              date: '2026-05-03T14:15:16Z',
              idState: createRevisionIdState(),
            }),
          );
          expect(result).toEqual({
            affectedCells: 1,
            missingTableIndexes: [],
            missingRowIndexes: [],
            missingCellIndexes: [],
          });

          const table = doc.getElementsByTagNameNS(W_NS, W.tbl).item(0) as Element;
          const row = firstDirectChild(table, W.tr);
          const cell = firstDirectChild(row, W.tc);
          const tcPr = firstDirectChild(cell, W.tcPr);
          tcMar = firstDirectChild(tcPr, W.tcMar);
          left = firstDirectChild(tcMar, W.left);
          tcPrChange = firstDirectChild(tcPr, 'tcPrChange');
          previousTcMar = firstDirectChild(firstDirectChild(tcPrChange, W.tcPr), W.tcMar);
        });

        await then('the outer cell properties are updated while the inner tcPr snapshot preserves the old padding', () => {
          expect(wordAttr(tcPrChange, 'author')).toBe('SafeDocX AI');
          expect(wordAttr(tcPrChange, 'date')).toBe('2026-05-03T14:15:16Z');
          expect(revisionId(tcPrChange)).toBe(1);
          expect(Array.from(tcMar.children).map((child) => child.localName)).toEqual([W.top, W.left]);
          expect(wordAttr(left, 'w')).toBe('240');
          expect(wordAttr(left, 'type')).toBe('dxa');
          expect(getDirectChildrenByName(previousTcMar, W.left)).toHaveLength(0);
          expect(firstDirectChild(previousTcMar, W.top)).toBeDefined();
        });
      },
    );

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.4.68' })(
      'setTableCellPadding keeps logical start/end margins in the CT_TcMar sequence',
      async ({ given, when, then }: AllureBddContext) => {
        let doc: Document;
        let tcMar: Element;

        await given('a table cell whose margins use logical start/end directions', () => {
          doc = makeDocument(
            `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcMar><w:top w:w="100" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
          );
        });

        await when('left and bottom padding are added', () => {
          const result = setTableCellPadding(doc, { tableIndexes: [0], leftDxa: 240, bottomDxa: 60 });
          expect(result.affectedCells).toBe(1);

          const table = doc.getElementsByTagNameNS(W_NS, W.tbl).item(0) as Element;
          const cell = firstDirectChild(firstDirectChild(table, W.tr), W.tc);
          tcMar = firstDirectChild(firstDirectChild(cell, W.tcPr), W.tcMar);
        });

        await then('the pre-existing start/end margins stay interleaved per the schema sequence', () => {
          expect(Array.from(tcMar.children).map((child) => child.localName)).toEqual([
            W.top,
            W.start,
            W.left,
            W.bottom,
            W.end,
          ]);
        });
      },
    );

  test('layout primitives preserve legacy mutation behavior when revision context is omitted', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let paragraphId: string;

    await given('a document with paragraph, row, and cell layout properties', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      );
      doc = indexed.doc;
      [paragraphId] = indexed.paragraphIds as [string];
    });

    await when('the layout primitives run without tracked-change context', () => {
      setParagraphSpacing(doc, { paragraphIds: [paragraphId], beforeTwips: 240 });
      setTableRowHeight(doc, { tableIndexes: [0], valueTwips: 480, rule: 'exact' });
      setTableCellPadding(doc, { tableIndexes: [0], leftDxa: 240 });
    });

    await then('no property-change wrappers are emitted while the direct properties are still updated', () => {
      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      const pPr = firstDirectChild(paragraph, W.pPr);
      expect(getDirectChildrenByName(pPr, 'pPrChange')).toHaveLength(0);
      expect(wordAttr(firstDirectChild(pPr, W.spacing), 'before')).toBe('240');

      const table = doc.getElementsByTagNameNS(W_NS, W.tbl).item(0) as Element;
      const row = firstDirectChild(table, W.tr);
      const trPr = firstDirectChild(row, W.trPr);
      expect(getDirectChildrenByName(trPr, 'trPrChange')).toHaveLength(0);
      expect(wordAttr(firstDirectChild(trPr, W.trHeight), 'val')).toBe('480');

      const cell = firstDirectChild(row, W.tc);
      const tcPr = firstDirectChild(cell, W.tcPr);
      expect(getDirectChildrenByName(tcPr, 'tcPrChange')).toHaveLength(0);
      expect(wordAttr(firstDirectChild(firstDirectChild(tcPr, W.tcMar), W.left), 'w')).toBe('240');
    });
  });

  test('layout primitives emit empty prior snapshots and unique IDs when tracked properties are created from scratch', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let paragraphId: string;
    let emittedIds: number[];
    let previousPPr: Element;
    let previousTrPr: Element;
    let previousTcPr: Element;

    await given('a document whose targeted paragraph, row, and cell have no prior property blocks', () => {
      const indexed = createIndexedDocument(
        `<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>` +
          `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      );
      doc = indexed.doc;
      [paragraphId] = indexed.paragraphIds as [string];
    });

    await when('the three tracked layout primitives share one revision context', () => {
      const ctx = createRevisionContext({
        author: 'SafeDocX AI',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      });

      setParagraphSpacing(doc, { paragraphIds: [paragraphId], beforeTwips: 240 }, ctx);
      setTableRowHeight(doc, { tableIndexes: [0], valueTwips: 480, rule: 'exact' }, ctx);
      setTableCellPadding(doc, { tableIndexes: [0], leftDxa: 120 }, ctx);

      const paragraph = doc.getElementsByTagNameNS(W_NS, W.p).item(0) as Element;
      const pPr = firstDirectChild(paragraph, W.pPr);
      const table = doc.getElementsByTagNameNS(W_NS, W.tbl).item(0) as Element;
      const row = firstDirectChild(table, W.tr);
      const trPr = firstDirectChild(row, W.trPr);
      const cell = firstDirectChild(row, W.tc);
      const tcPr = firstDirectChild(cell, W.tcPr);

      const pPrChange = firstDirectChild(pPr, 'pPrChange');
      const trPrChange = firstDirectChild(trPr, 'trPrChange');
      const tcPrChange = firstDirectChild(tcPr, 'tcPrChange');
      emittedIds = [revisionId(pPrChange), revisionId(trPrChange), revisionId(tcPrChange)];
      previousPPr = firstDirectChild(pPrChange, W.pPr);
      previousTrPr = firstDirectChild(trPrChange, W.trPr);
      previousTcPr = firstDirectChild(tcPrChange, W.tcPr);
    });

    await then('each new change wrapper gets a unique ID and carries an empty prior-properties element', () => {
      expect(emittedIds).toEqual([1, 2, 3]);
      expect(new Set(emittedIds).size).toBe(3);
      expect(previousPPr.childNodes.length).toBe(0);
      expect(previousTrPr.childNodes.length).toBe(0);
      expect(previousTcPr.childNodes.length).toBe(0);
    });
  });

  test('a second tracked layout mutation replaces the existing pPrChange instead of stacking siblings', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let paragraphId: string;
    let pPr: Element;
    let pPrChanges: Element[];

    await given('a paragraph that already carries a pPrChange from a prior tracked spacing edit', () => {
      const indexed = createIndexedDocument(`<w:p><w:r><w:t>Hello</w:t></w:r></w:p>`);
      doc = indexed.doc;
      paragraphId = indexed.paragraphIds[0]!;

      setParagraphSpacing(
        doc,
        { paragraphIds: [paragraphId], beforeTwips: 120 },
        createRevisionContext({
          author: 'AuthorA',
          date: '2026-01-01T00:00:00Z',
          idState: createRevisionIdState(),
        }),
      );

      pPr = firstDirectChild(
        Array.from(doc.getElementsByTagNameNS(W_NS, W.p)).find((p) =>
          getParagraphBookmarkId(p as Element) === paragraphId,
        ) as Element,
        W.pPr,
      );
      expect(getDirectChildrenByName(pPr, 'pPrChange')).toHaveLength(1);
    });

    await when('a second tracked spacing edit is applied with a fresh revision context', () => {
      setParagraphSpacing(
        doc,
        { paragraphIds: [paragraphId], beforeTwips: 240 },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T15:30:00Z',
          idState: createRevisionIdState(),
        }),
      );
      pPrChanges = getDirectChildrenByName(pPr, 'pPrChange');
    });

    await then('exactly one pPrChange remains under the pPr, attributed to the latest author', () => {
      expect(pPrChanges).toHaveLength(1);
      expect(pPrChanges[0]!.getAttribute('w:author')).toBe('SafeDocX AI');
    });
  });

  test('a second tracked row-height mutation replaces the existing trPrChange', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let trPr: Element;
    let trPrChanges: Element[];

    await given('a row that already carries a trPrChange from a prior tracked row-height edit', () => {
      doc = makeDocument(`<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`);
      setTableRowHeight(
        doc,
        { tableIndexes: [0], rowIndexes: [0], valueTwips: 360, rule: 'atLeast' },
        createRevisionContext({
          author: 'AuthorA',
          date: '2026-01-01T00:00:00Z',
          idState: createRevisionIdState(),
        }),
      );
      const row = doc.getElementsByTagNameNS(W_NS, W.tr).item(0) as Element;
      trPr = firstDirectChild(row, W.trPr);
      expect(getDirectChildrenByName(trPr, 'trPrChange')).toHaveLength(1);
    });

    await when('a second tracked row-height edit is applied', () => {
      setTableRowHeight(
        doc,
        { tableIndexes: [0], rowIndexes: [0], valueTwips: 720, rule: 'exact' },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T15:30:00Z',
          idState: createRevisionIdState(),
        }),
      );
      trPrChanges = getDirectChildrenByName(trPr, 'trPrChange');
    });

    await then('exactly one trPrChange remains under the trPr, attributed to the latest author', () => {
      expect(trPrChanges).toHaveLength(1);
      expect(trPrChanges[0]!.getAttribute('w:author')).toBe('SafeDocX AI');
    });
  });

  test('a second tracked cell-padding mutation replaces the existing tcPrChange', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let tcPr: Element;
    let tcPrChanges: Element[];

    await given('a cell that already carries a tcPrChange from a prior tracked padding edit', () => {
      doc = makeDocument(`<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`);
      setTableCellPadding(
        doc,
        { tableIndexes: [0], rowIndexes: [0], cellIndexes: [0], topDxa: 100 },
        createRevisionContext({
          author: 'AuthorA',
          date: '2026-01-01T00:00:00Z',
          idState: createRevisionIdState(),
        }),
      );
      const cell = doc.getElementsByTagNameNS(W_NS, W.tc).item(0) as Element;
      tcPr = firstDirectChild(cell, W.tcPr);
      expect(getDirectChildrenByName(tcPr, 'tcPrChange')).toHaveLength(1);
    });

    await when('a second tracked padding edit is applied', () => {
      setTableCellPadding(
        doc,
        { tableIndexes: [0], rowIndexes: [0], cellIndexes: [0], topDxa: 200 },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T15:30:00Z',
          idState: createRevisionIdState(),
        }),
      );
      tcPrChanges = getDirectChildrenByName(tcPr, 'tcPrChange');
    });

    await then('exactly one tcPrChange remains under the tcPr, attributed to the latest author', () => {
      expect(tcPrChanges).toHaveLength(1);
      expect(tcPrChanges[0]!.getAttribute('w:author')).toBe('SafeDocX AI');
    });
  });

  test('tracked cell-padding edit on a cell with cellIns history preserves the topology revision in the snapshot', async ({ given, when, then }: AllureBddContext) => {
    let doc: Document;
    let tcPr: Element;
    let tcPrChange: Element;
    let snapshotTcPr: Element;

    await given('a cell with a pre-existing cellIns marker (cell-topology revision history)', () => {
      doc = makeDocument(
        `<w:tbl>` +
          `<w:tr>` +
            `<w:tc>` +
              `<w:tcPr>` +
                `<w:cellIns w:id="50" w:author="OldAuthor" w:date="2024-01-01T00:00:00Z"/>` +
                `<w:tcMar><w:top w:w="80" w:type="dxa"/></w:tcMar>` +
              `</w:tcPr>` +
              `<w:p/>` +
            `</w:tc>` +
          `</w:tr>` +
        `</w:tbl>`,
      );
    });

    await when('a tracked padding edit is applied', () => {
      setTableCellPadding(
        doc,
        { tableIndexes: [0], rowIndexes: [0], cellIndexes: [0], topDxa: 200 },
        createRevisionContext({
          author: 'SafeDocX AI',
          date: '2026-05-06T15:30:00Z',
          idState: createRevisionIdState(),
        }),
      );
      const cell = doc.getElementsByTagNameNS(W_NS, W.tc).item(0) as Element;
      tcPr = firstDirectChild(cell, W.tcPr);
      tcPrChange = firstDirectChild(tcPr, 'tcPrChange');
      snapshotTcPr = firstDirectChild(tcPrChange, W.tcPr);
    });

    await then('the snapshot inside tcPrChange preserves the prior cellIns and tcMar (CT_TcPrInner allows them)', () => {
      // The snapshot must retain cell-topology revision children.
      expect(getDirectChildrenByName(snapshotTcPr, 'cellIns')).toHaveLength(1);
      expect(getDirectChildrenByName(snapshotTcPr, 'cellIns')[0]!.getAttribute('w:author')).toBe('OldAuthor');
      // tcMar with the OLD top value also survives.
      const snapshotTcMar = firstDirectChild(snapshotTcPr, 'tcMar');
      const snapshotTop = firstDirectChild(snapshotTcMar, 'top');
      expect(snapshotTop.getAttribute('w:w')).toBe('80');
      // The OUTER tcPr has the NEW top value.
      const newTcMar = firstDirectChild(tcPr, 'tcMar');
      const newTop = firstDirectChild(newTcMar, 'top');
      expect(newTop.getAttribute('w:w')).toBe('200');
    });
  });
});
