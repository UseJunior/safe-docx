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
  buildSectPrBaseSnapshot,
  buildSectPrChangeElement,
  buildTcPrChangeElement,
  buildTrPrChangeElement,
  convertSerializedDeletionContent,
  createRevisionContainer,
  createRevisionContext,
  createRevisionIdAllocator,
  createRevisionIdState,
  inferStartingRevisionId,
  inferStartingRevisionIdState,
  RevisionIdAllocator,
  wrapElementWithDel,
  wrapElementWithIns,
  wrapSerializedContentWithDel,
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

  test('buildTrPrChangeElement snapshots prior row properties without nested trPrChange or row revision markers', async ({ given, when, then }: AllureBddContext) => {
    let trPr: Element;
    let serialized: string;

    await given('a row properties element that already contains tracked-change children', () => {
      trPr = parseFragment(
        '<w:trPr><w:trHeight w:val="360" w:hRule="atLeast"/><w:ins w:id="50"/><w:del w:id="51"/><w:trPrChange w:id="99"/></w:trPr>',
      );
    });

    await when('buildTrPrChangeElement snapshots the previous state', () => {
      serialized = serialize(
        buildTrPrChangeElement(
          trPr,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('the generated wrapper contains only CT_TrPrBase-compatible children', () => {
      expect(serialized).toContain('<w:trPrChange ');
      expect(serialized).toContain('<w:trPr><w:trHeight w:val="360" w:hRule="atLeast"/></w:trPr>');
      expect(serialized).not.toContain('w:trPrChange w:id="99"');
      expect(serialized).not.toContain('<w:ins ');
      expect(serialized).not.toContain('<w:del ');
    });
  });

  test('buildTcPrChangeElement snapshots prior cell properties preserving cell-topology revision children but stripping nested tcPrChange', async ({ given, when, then }: AllureBddContext) => {
    let tcPr: Element;
    let serialized: string;

    await given('a cell properties element that already contains cell-topology revision markers and a stale tcPrChange', () => {
      tcPr = parseFragment(
        '<w:tcPr><w:tcMar><w:top w:w="100" w:type="dxa"/></w:tcMar><w:cellIns w:id="40"/><w:cellDel w:id="41"/><w:cellMerge w:id="42"/><w:tcPrChange w:id="99"/></w:tcPr>',
      );
    });

    await when('buildTcPrChangeElement snapshots the previous state', () => {
      serialized = serialize(
        buildTcPrChangeElement(
          tcPr,
          createRevisionContext({
            author: 'Comparison',
            date: '2026-05-03T14:15:16Z',
            idState: createRevisionIdState(),
          }),
        ),
      );
    });

    await then('CT_TcPrInner preserves cellIns/cellDel/cellMerge but excludes the stale tcPrChange', () => {
      expect(serialized).toContain('<w:tcPrChange ');
      // The stale change-of-a-change marker is dropped.
      expect(serialized).not.toContain('w:tcPrChange w:id="99"');
      // Cell-topology revisions are part of CT_TcPrInner and must be preserved.
      expect(serialized).toContain('<w:cellIns w:id="40"/>');
      expect(serialized).toContain('<w:cellDel w:id="41"/>');
      expect(serialized).toContain('<w:cellMerge w:id="42"/>');
      // tcMar is also part of CT_TcPrInner and must be preserved.
      expect(serialized).toContain('<w:tcMar><w:top w:w="100" w:type="dxa"/></w:tcMar>');
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

  test('buildRPrChangeElement excludes alternate-prefix WML changes and preserves extension markup', () => {
    const rPr = parseFragment(
      '<w:rPr xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:x="urn:example:extension"><w:b/><q:rPrChange q:id="99"><q:rPr/></q:rPrChange><x:rPrChange x:keep="yes"/></w:rPr>',
    );

    const result = buildRPrChangeElement(
      rPr,
      createRevisionContext({
        author: 'Comparison',
        date: '2026-05-03T14:15:16Z',
        idState: createRevisionIdState(),
      }),
    );
    const snapshot = result.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'rPr',
    ).item(0) as Element;

    expect(
      snapshot.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'rPrChange',
      ).length,
    ).toBe(0);
    expect(
      snapshot
        .getElementsByTagNameNS('urn:example:extension', 'rPrChange')
        .item(0)
        ?.getAttribute('x:keep'),
    ).toBe('yes');
  });

  test('convertSerializedDeletionContent converts entity-laden text without corrupting it', async ({ given, when, then }: AllureBddContext) => {
    let content: string;
    let converted: string;

    await given('serialized run content whose text holds escaped angle brackets and ampersands', () => {
      content =
        '<w:r><w:t xml:space="preserve">if a &lt; b &amp;&amp; b &gt; c</w:t></w:r>';
    });

    await when('the content is converted for deletion', () => {
      converted = convertSerializedDeletionContent(content);
    });

    await then('the renamed element preserves the entity references and attributes', () => {
      expect(converted).toBe(
        '<w:r><w:delText xml:space="preserve">if a &lt; b &amp;&amp; b &gt; c</w:delText></w:r>',
      );
    });
  });

  test('convertSerializedDeletionContent converts every w:t in a run with multiple text children', async ({ given, when, then }: AllureBddContext) => {
    let content: string;
    let converted: string;

    await given('a run holding consecutive w:t elements and a field instruction', () => {
      content =
        '<w:r><w:t>first</w:t><w:t xml:space="preserve"> second</w:t><w:instrText>PAGEREF _Ref1</w:instrText></w:r>';
    });

    await when('the content is converted for deletion', () => {
      converted = convertSerializedDeletionContent(content);
    });

    await then('all text children are renamed and none survive as insertion-style tags', () => {
      expect(converted).toBe(
        '<w:r><w:delText>first</w:delText><w:delText xml:space="preserve"> second</w:delText><w:delInstrText>PAGEREF _Ref1</w:delInstrText></w:r>',
      );
    });
  });

  test('convertSerializedDeletionContent converts shapes the legacy regex sweep missed', async ({ given, when, then }: AllureBddContext) => {
    let selfClosing: string;
    let gtInAttribute: string;

    await given('runs with a self-closing w:t and an attribute value containing ">"', () => {
      selfClosing = '<w:r><w:t/></w:r>';
      gtInAttribute = '<w:r><w:t w14:textId="a>b">text</w:t></w:r>';
    });

    await when('the content is converted for deletion', () => {
      selfClosing = convertSerializedDeletionContent(selfClosing);
      gtInAttribute = convertSerializedDeletionContent(gtInAttribute);
    });

    await then('both shapes are renamed instead of leaking w:t into the deletion wrapper', () => {
      expect(selfClosing).toBe('<w:r><w:delText/></w:r>');
      expect(gtInAttribute).toContain('<w:delText ');
      expect(gtInAttribute).toContain('text</w:delText>');
      expect(gtInAttribute).not.toContain('<w:t');
    });
  });

  test('convertSerializedDeletionContent leaves non-text run content untouched', async ({ given, when, then }: AllureBddContext) => {
    let content: string;
    let converted: string;

    await given('serialized run content with no convertible text elements', () => {
      content = '<w:r><w:rPr><w:b/></w:rPr><w:tab/><w:br w:type="page"/></w:r>';
    });

    await when('the content is converted for deletion', () => {
      converted = convertSerializedDeletionContent(content);
    });

    await then('the content is returned byte-for-byte unchanged', () => {
      expect(converted).toBe(content);
    });
  });

  test('wrapSerializedContentWithDel wraps converted content with revision metadata', async ({ given, when, then }: AllureBddContext) => {
    let wrapped: string;

    await given('serialized run content with text', () => {
      wrapped = '';
    });

    await when('the content is wrapped in a w:del element', () => {
      wrapped = wrapSerializedContentWithDel(
        '<w:r><w:t>gone</w:t></w:r>',
        createRevisionContext({
          author: 'Comparison',
          date: '2026-05-03T14:15:16Z',
          idState: createRevisionIdState(),
        }),
      );
    });

    await then('the wrapper carries revision metadata around deletion-style content', () => {
      expect(wrapped).toBe(
        '<w:del w:id="1" w:author="Comparison" w:date="2026-05-03T14:15:16Z">' +
          '<w:r><w:delText>gone</w:delText></w:r></w:del>',
      );
    });
  });

  test(
    'wrapSerializedContentWithDel keeps a quote-bearing date in one attribute',
    async ({ when, then }: AllureBddContext) => {
      const date = '2026-05-03T14:15:16Z" data-injected="yes&<>';
      let wrapper: Element | undefined;

      await when('caller-supplied revision metadata is serialized', () => {
        const wrapped = wrapSerializedContentWithDel(
          '<w:r><w:t>gone</w:t></w:r>',
          createRevisionContext({
            author: 'Comparison',
            date,
            idState: createRevisionIdState(),
          }),
        );
        wrapper = parseFragment(wrapped);
      });

      await then('the date round-trips without injecting another attribute', () => {
        if (!wrapper) throw new Error('missing revision wrapper');
        expect(wrapper.getAttributeNS(OOXML.W_NS, 'date')).toBe(date);
        expect(wrapper.hasAttribute('data-injected')).toBe(false);
        expect(wrapper.attributes).toHaveLength(3);
      });
    },
  );
  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' })(
      'buildSectPrBaseSnapshot keeps only CT_SectPrBase content under any WML prefix (#944)',
      () => {
        const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const doc = parseXml(
          `<root xmlns:x="${OOXML.W_NS}" xmlns:r="${R_NS}">` +
            `<x:sectPr x:rsidR="00AB12CD" x:rsidSect="00EF3456">` +
            `<x:headerReference x:type="default" r:id="rId1"/>` +
            `<x:footerReference x:type="even" r:id="rId2"/>` +
            `<x:pgSz x:w="12240" x:h="15840"/><x:titlePg/>` +
            `<x:sectPrChange x:id="1" x:author="Prior" x:date="2026-01-01T00:00:00Z"><x:sectPr/></x:sectPrChange>` +
            `</x:sectPr></root>`,
        );
        const live = childElements(doc.documentElement)[0]!;

        const snapshot = buildSectPrBaseSnapshot(live, doc);
        expect(snapshot.localName).toBe('sectPr');
        expect(childElements(snapshot).map((child) => child.localName)).toEqual(['pgSz', 'titlePg']);
        expect(snapshot.getAttributeNS(OOXML.W_NS, 'rsidR')).toBe('00AB12CD');
        expect(snapshot.getAttributeNS(OOXML.W_NS, 'rsidSect')).toBe('00EF3456');
        expect(childElements(buildSectPrBaseSnapshot(null, doc))).toHaveLength(0);

        // The primitive emitter shares the same policy.
        const change = buildSectPrChangeElement(live, createRevisionContext({ author: 'A', date: new Date(0) }));
        expect(childElements(childElements(change)[0]!).map((child) => child.localName))
          .toEqual(['pgSz', 'titlePg']);
      },
    );
});


describe('RevisionIdAllocator', () => {
  test('starts in unseeded status and throws when allocated before seeding', async () => {
    const allocator = createRevisionIdAllocator();
    expect(allocator instanceof RevisionIdAllocator).toBe(true);
    expect(allocator.status).toBe('unseeded');
    expect(allocator.isReady).toBe(false);

    expect(() => allocator.allocate()).toThrow('Revision ID allocator is not ready (status: unseeded)');
    expect(() => allocator.reserveMoveRange('key1')).toThrow('Revision ID allocator is not ready (status: unseeded)');
    expect(() => allocateRevisionId(allocator)).toThrow('Revision ID allocator is not ready (status: unseeded)');
  });

  test('constructor with startId initializes directly into ready status', async () => {
    const allocator = createRevisionIdAllocator({ startId: 42 });
    expect(allocator.status).toBe('ready');
    expect(allocator.isReady).toBe(true);
    expect(allocator.nextId).toBe(42);
    expect(allocator.allocate()).toBe(42);
    expect(allocator.nextId).toBe(43);
  });

  test('seeds from a starting number, document elements, or resolver function', async () => {
    const allocNum = createRevisionIdAllocator();
    await allocNum.seed(100);
    expect(allocNum.status).toBe('ready');
    expect(allocNum.allocate()).toBe(100);

    const allocDoc = createRevisionIdAllocator();
    const doc = parseXml(
      '<w:document xmlns:w="' + OOXML.W_NS + '">' +
        '<w:body><w:p><w:ins w:id="75" w:author="Tester" w:date="2026-01-01T00:00:00Z"><w:r><w:t>A</w:t></w:r></w:ins></w:p></w:body>' +
      '</w:document>'
    );
    await allocDoc.seed([doc]);
    expect(allocDoc.status).toBe('ready');
    expect(allocDoc.allocate()).toBe(76);

    const allocFn = createRevisionIdAllocator();
    await allocFn.seed(async () => 500);
    expect(allocFn.status).toBe('ready');
    expect(allocFn.allocate()).toBe(500);
  });

  test('shares concurrent in-flight seed operations across multiple callers', async () => {
    const allocator = createRevisionIdAllocator();
    let invocations = 0;

    const slowSeeder = async () => {
      invocations++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 200;
    };

    const [r1, r2, r3] = await Promise.all([
      allocator.seed(slowSeeder),
      allocator.seed(slowSeeder),
      allocator.seed(slowSeeder),
    ]);

    expect(invocations).toBe(1);
    expect(r1).toBe(allocator);
    expect(r2).toBe(allocator);
    expect(r3).toBe(allocator);
    expect(allocator.status).toBe('ready');
    expect(allocator.allocate()).toBe(200);
    expect(allocator.allocate()).toBe(201);
  });

  test('retries failed seeds and transitions back to unseeded on error', async () => {
    const allocator = createRevisionIdAllocator();
    let attempts = 0;

    const flakySeeder = async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Seed I/O failure');
      }
      return 350;
    };

    await expect(allocator.seed(flakySeeder)).rejects.toThrow('Seed I/O failure');
    expect(allocator.status).toBe('unseeded');
    expect(allocator.isReady).toBe(false);

    // Second call retries
    await allocator.seed(flakySeeder);
    expect(attempts).toBe(2);
    expect(allocator.status).toBe('ready');
    expect(allocator.allocate()).toBe(350);
  });

  test('ensureReady is idempotent when already ready and defaults to startId 1', async () => {
    const allocator = createRevisionIdAllocator();
    await allocator.ensureReady();
    expect(allocator.status).toBe('ready');
    expect(allocator.allocate()).toBe(1);

    // Idempotent second call
    await allocator.ensureReady(999);
    expect(allocator.allocate()).toBe(2);
  });

  test('reserveMoveRange pairs source and destination IDs and caches by key', async () => {
    const allocator = createRevisionIdAllocator({ startId: 10 });
    const pair1 = allocator.reserveMoveRange('moveA');
    expect(pair1.sourceRangeId).toBe(10);
    expect(pair1.destRangeId).toBe(11);

    // Same key returns the same reservation
    const pair2 = allocator.reserveMoveRange('moveA');
    expect(pair2).toBe(pair1);

    // Different key allocates new pair
    const pair3 = allocator.reserveMoveRange('moveB');
    expect(pair3.sourceRangeId).toBe(12);
    expect(pair3.destRangeId).toBe(13);
  });

  test('preserves revision grouping policy (#926) without logical revision collisions', async () => {
    // Sibling wrappers of one logical edit (e.g. deletion split across bookmark)
    // share the same allocated ID under the same revision signature.
    // Distinct logical revisions receive incremented, non-colliding IDs.
    const allocator = createRevisionIdAllocator({ startId: 1 });
    const logicalRev1Id = allocator.allocate();
    expect(logicalRev1Id).toBe(1);

    // Sibling fragment uses the same ID
    const fragment1Id = logicalRev1Id;
    const fragment2Id = logicalRev1Id;
    expect(fragment1Id).toBe(fragment2Id);

    // Next logical revision gets the next unique ID
    const logicalRev2Id = allocator.allocate();
    expect(logicalRev2Id).toBe(2);
    expect(logicalRev2Id).not.toBe(logicalRev1Id);
  });

  test('scans supported stories and ignores non-revision element w:id attributes', async () => {
    const mainDoc = parseXml(
      '<w:document xmlns:w="' + OOXML.W_NS + '">' +
        '<w:body><w:p>' +
          '<w:bookmarkStart w:id="9999" w:name="b1"/>' +
          '<w:ins w:id="20" w:author="Tester" w:date="2026-01-01T00:00:00Z"><w:r><w:t>M</w:t></w:r></w:ins>' +
        '</w:p></w:body>' +
      '</w:document>'
    );
    const commentsDoc = parseXml(
      '<w:comments xmlns:w="' + OOXML.W_NS + '">' +
        '<w:comment w:id="8888" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">' +
          '<w:p><w:del w:id="45" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:delText>D</w:delText></w:del></w:p>' +
        '</w:comment>' +
      '</w:comments>'
    );
    const footnotesDoc = parseXml(
      '<w:footnotes xmlns:w="' + OOXML.W_NS + '">' +
        '<w:footnote w:id="7777" w:type="normal">' +
          '<w:p><w:pPr><w:pPrChange w:id="60" w:author="Writer" w:date="2026-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr></w:p>' +
        '</w:footnote>' +
      '</w:footnotes>'
    );

    const startingId = inferStartingRevisionId(mainDoc, commentsDoc, footnotesDoc);
    // Highest revision id is 60 (pPrChange in footnotes).
    // Bookmark 9999, comment 8888, footnote 7777 are ignored because they are not in REVISION_ID_ELEMENT_NAME_SET.
    expect(startingId).toBe(61);

    const allocator = inferStartingRevisionIdState(mainDoc, commentsDoc, footnotesDoc);
    expect(allocator.status).toBe('ready');
    expect(allocator.allocate()).toBe(61);
  });
});
