/**
 * Header/footer references when accept or reject removes a section boundary
 * (#1144 part B).
 *
 * Every expectation below was recorded from Word 16 for Mac Accept All /
 * Reject All on the same fixture shapes (S1e: an empty boundary paragraph
 * whose inserted mark owns the `w:sectPr`, rejected; S3b: a content paragraph
 * whose deleted mark owns the `w:sectPr`, accepted). Word copies every
 * reference of the removed section onto the following section when that
 * section has none, and copies nothing when it has any of its own; the
 * survivor keeps its own `w:titlePg` and page setup.
 *
 * Each case runs on docx-core `acceptChanges`/`rejectChanges` and on
 * docx-compare `acceptAllChanges`/`rejectAllChanges`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.15
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */
import { describe, expect } from 'vitest';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';
import { acceptChanges } from '../src/primitives/accept_changes.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';
import {
  carryForwardHeaderFooterRefs,
  followingSectionProperties,
} from '../src/primitives/section_boundary_references.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'carry-header-footer-references-on-section-removal';
const test = testAllure
  .epic('DOCX Primitives')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.15' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DATE = 'w:author="Tester" w:date="2026-10-08T00:00:00Z"';

type RefType = 'default' | 'first' | 'even';
const ALL: RefType[] = ['default', 'first', 'even'];

interface SectionSpec {
  /** Reference-set label: rIds read `rIdH<set><type>` / `rIdF<set><type>`. */
  set: string;
  headers?: RefType[];
  footers?: RefType[];
  landscape?: boolean;
  titlePg?: boolean;
  nextPage?: boolean;
}

function sectPr(spec: SectionSpec): string {
  const headers = (spec.headers ?? []).map((t) => `<w:headerReference w:type="${t}" r:id="rIdH${spec.set}${t}"/>`).join('');
  const footers = (spec.footers ?? []).map((t) => `<w:footerReference w:type="${t}" r:id="rIdF${spec.set}${t}"/>`).join('');
  const size = spec.landscape
    ? '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
    : '<w:pgSz w:w="12240" w:h="15840"/>';
  return `<w:sectPr>${headers}${footers}${spec.nextPage ? '<w:type w:val="nextPage"/>' : ''}${size}`
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
    + `${spec.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
}

const paragraph = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const wrap = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;

type Shape = 's1e' | 's3b';
type Position = 'body' | 'para';

/** The removed section: landscape, set A. */
const removedSection = (overrides: Partial<SectionSpec> = {}): SectionSpec =>
  ({ set: 'A', headers: ALL, footers: ALL, landscape: true, titlePg: true, nextPage: true, ...overrides });

/**
 * S1e rejects an inserted empty boundary; S3b accepts a deleted mark on a
 * content paragraph. The survivor is the body-level `w:sectPr`, or a
 * paragraph-owned one followed by a final section bound to set C.
 */
function fixture(shape: Shape, removed: SectionSpec, survivor: SectionSpec, position: Position): string {
  const boundary = shape === 's1e'
    ? paragraph('First section') + `<w:p><w:pPr><w:rPr><w:ins w:id="1" ${DATE}/></w:rPr>${sectPr(removed)}</w:pPr></w:p>`
    : paragraph('First section', `<w:rPr><w:del w:id="1" ${DATE}/></w:rPr>${sectPr(removed)}`);
  const tail = position === 'body'
    ? paragraph('Second section') + sectPr(survivor)
    : paragraph('Second section', sectPr({ ...survivor, nextPage: true })) + paragraph('Third section')
      + sectPr({ set: 'C', headers: ALL, footers: ALL, titlePg: true });
  return wrap(boundary + tail);
}

type Applier = { name: string; apply: (xml: string) => string };
const APPLIERS: Record<Shape, Applier[]> = {
  s3b: [
    { name: 'docx-core acceptChanges', apply: (xml) => { const doc = parseXml(xml); acceptChanges(doc); return serializeXml(doc); } },
    { name: 'docx-compare acceptAllChanges', apply: acceptAllChanges },
  ],
  s1e: [
    { name: 'docx-core rejectChanges', apply: (xml) => { const doc = parseXml(xml); rejectChanges(doc); return serializeXml(doc); } },
    { name: 'docx-compare rejectAllChanges', apply: rejectAllChanges },
  ],
};

interface SectionSummary {
  references: string[];
  titlePg: boolean;
  landscape: boolean;
}

function liveSections(xml: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(W_NS, 'sectPr')).filter((section) => {
    const parent = section.parentNode as Element | null;
    return parent?.localName === 'body' || (parent?.localName === 'pPr' && (parent.parentNode as Element | null)?.localName === 'p');
  });
}

function summarize(xml: string): SectionSummary[] {
  return liveSections(xml).map((section) => {
    const children = Array.from(section.childNodes).filter((n): n is Element => n.nodeType === 1);
    return {
      references: children
        .filter((c) => c.localName === 'headerReference' || c.localName === 'footerReference')
        .map((c) => `${c.localName === 'headerReference' ? 'H' : 'F'}.${c.getAttributeNS(W_NS, 'type')}=${c.getAttributeNS(R_NS, 'id')}`)
        .sort(),
      titlePg: children.some((c) => c.localName === 'titlePg'),
      landscape: children.some((c) => c.localName === 'pgSz' && c.getAttributeNS(W_NS, 'orient') === 'landscape'),
    };
  });
}

/** The sorted reference list a section bound to `set` would carry. */
function refs(set: string, headers: RefType[] = [], footers: RefType[] = []): string[] {
  return [
    ...headers.map((t) => `H.${t}=rIdH${set}${t}`),
    ...footers.map((t) => `F.${t}=rIdF${set}${t}`),
  ].sort();
}

const FINAL_C: SectionSummary = { references: refs('C', ALL, ALL), titlePg: true, landscape: false };

/** Expected live sections after the boundary is removed, per Word. */
function expectedSections(survivor: SectionSummary, position: Position): SectionSummary[] {
  return position === 'body' ? [survivor] : [survivor, FINAL_C];
}

function runMatrix(
  removed: SectionSpec,
  survivor: SectionSpec,
  expected: SectionSummary,
  shapes: Shape[] = ['s1e', 's3b'],
  positions: Position[] = ['body', 'para'],
): void {
  for (const shape of shapes) {
    for (const position of positions) {
      const xml = fixture(shape, removed, survivor, position);
      for (const applier of APPLIERS[shape]) {
        const result = applier.apply(xml);
        expect(summarize(result), `${shape}/${position}/${applier.name}`)
          .toEqual(expectedSections(expected, position));
      }
    }
  }
}

describe('Traceability: Removing a Section Boundary Carries Its Header/Footer References Forward', () => {
  test.openspec('accepting a deleted section break carries its references to a linked final section')(
    'accepting a deleted section break carries its references to a linked final section',
    async ({ given, when, then }: AllureBddContext) => {
      let removed!: SectionSpec;
      let survivor!: SectionSpec;
      await given('a deleted mark owning six references, then a body section with none (S3b)', async () => {
        removed = removedSection();
        survivor = { set: 'B' };
      });
      await when('all changes are accepted on both appliers', async () => {});
      await then('one portrait section remains, bound to all six removed references', async () => {
        runMatrix(removed, survivor, { references: refs('A', ALL, ALL), titlePg: false, landscape: false }, ['s3b'], ['body']);
      });
    },
  );

  test.openspec('rejecting an inserted section break carries its references to a linked final section')(
    'rejecting an inserted section break carries its references to a linked final section',
    async ({ given, when, then }: AllureBddContext) => {
      let removed!: SectionSpec;
      let survivor!: SectionSpec;
      await given('an inserted empty boundary owning six references, then a body section with none (S1e)', async () => {
        removed = removedSection();
        survivor = { set: 'B' };
      });
      await when('all changes are rejected on both appliers', async () => {});
      await then('one portrait section remains, bound to all six removed references', async () => {
        runMatrix(removed, survivor, { references: refs('A', ALL, ALL), titlePg: false, landscape: false }, ['s1e'], ['body']);
      });
    },
  );

  test.openspec('a following paragraph-level section receives the references')(
    'a following paragraph-level section receives the references',
    async ({ given, when, then, and }: AllureBddContext) => {
      let removed!: SectionSpec;
      await given('a removed boundary, then a paragraph-owned section with no references, then a final section bound to set C', async () => {
        removed = removedSection({ headers: ['default'], footers: ['default'], titlePg: false });
      });
      await when('the boundary is removed by accept (S3b) and by reject (S1e)', async () => {});
      await then('the paragraph-owned survivor receives the removed references', async () => {
        runMatrix(removed, { set: 'B' }, { references: refs('A', ['default'], ['default']), titlePg: false, landscape: false }, ['s1e', 's3b'], ['para']);
      });
      await and('the final section keeps its own references (asserted in the same matrix)', async () => {});
    },
  );

  test.openspec('a following section with any reference of its own keeps only its own')(
    'a following section with any reference of its own keeps only its own',
    async ({ given, when, then }: AllureBddContext) => {
      const survivors: SectionSpec[] = [
        { set: 'B', headers: ['default'], footers: ['default'] },
        { set: 'B', headers: ['default'] },
        { set: 'B', footers: ['default'] },
        { set: 'B', headers: ['first'] },
        { set: 'B', footers: ['even'] },
      ];
      await given('survivors bound to a default header and footer, a default header only, a default footer only, a first-page header only, or an even-page footer only', async () => {});
      await when('a boundary with all six references is removed by accept and by reject', async () => {});
      await then('each survivor keeps exactly its own references', async () => {
        for (const survivor of survivors) {
          runMatrix(removedSection(), survivor, {
            references: refs('B', survivor.headers, survivor.footers),
            titlePg: false,
            landscape: false,
          });
        }
        // A removed section lacking even-page references, over a default-only survivor.
        runMatrix(
          removedSection({ headers: ['default', 'first'], footers: ['default', 'first'] }),
          { set: 'B', headers: ['default'], footers: ['default'] },
          { references: refs('B', ['default'], ['default']), titlePg: false, landscape: false },
        );
      });
    },
  );

  test.openspec('the survivor keeps its own title-page setting')(
    'the survivor keeps its own title-page setting',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a removed boundary with titlePg over a survivor without it, and the reverse', async () => {});
      await when('the boundary is removed by accept and by reject', async () => {});
      await then('titlePg and page size follow the survivor, while the references are carried', async () => {
        runMatrix(removedSection({ titlePg: true }), { set: 'B', titlePg: false },
          { references: refs('A', ALL, ALL), titlePg: false, landscape: false });
        runMatrix(removedSection({ titlePg: false }), { set: 'B', titlePg: true },
          { references: refs('A', ALL, ALL), titlePg: true, landscape: false });
      });
    },
  );

  test.openspec('a survivor bound to every header and footer is unchanged')(
    'a survivor bound to every header and footer is unchanged',
    async ({ given, when, then }: AllureBddContext) => {
      const survivor: SectionSpec = { set: 'B', headers: ALL, footers: ALL, titlePg: true };
      await given('a survivor bound to all six types with titlePg', async () => {});
      await when('a boundary with all six references is removed by accept and by reject', async () => {});
      await then('the survivor sectPr is byte-identical to its input', async () => {
        for (const shape of ['s1e', 's3b'] as const) {
          const xml = fixture(shape, removedSection({ titlePg: false }), survivor, 'body');
          for (const applier of APPLIERS[shape]) {
            const sections = liveSections(applier.apply(xml));
            expect(sections, applier.name).toHaveLength(1);
            expect(serializeXml(sections[0]!).replace(/ xmlns:\w+="[^"]*"/g, ''), applier.name).toBe(sectPr(survivor));
          }
        }
      });
    },
  );
});

describe('section boundary reference helpers', () => {
  test('carries references from an emptied boundary dropped before a table', async ({ given, when, then }: AllureBddContext) => {
    let xml!: string;
    await given('an inserted empty boundary followed by a table, then a body section with no references', async () => {
      xml = wrap(paragraph('First section')
        + `<w:p><w:pPr><w:rPr><w:ins w:id="1" ${DATE}/></w:rPr>${sectPr(removedSection())}</w:pPr></w:p>`
        + '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>'
        + `<w:tr><w:tc>${paragraph('Cell')}</w:tc></w:tr></w:tbl>${paragraph('After')}${sectPr({ set: 'B' })}`);
    });
    await when('all changes are rejected on both appliers', async () => {});
    await then('the boundary paragraph is dropped and the body section receives its references', async () => {
      for (const applier of APPLIERS.s1e) {
        expect(summarize(applier.apply(xml)), applier.name)
          .toEqual([{ references: refs('A', ALL, ALL), titlePg: false, landscape: false }]);
      }
    });
  });

  test('the comparison story checks can project without the carry', async ({ given, then }: AllureBddContext) => {
    let xml!: string;
    await given('S1e and S3b fixtures over a body section with no references', async () => {
      xml = fixture('s1e', removedSection(), { set: 'B' }, 'body');
    });
    await then('carryHeaderFooterReferences: false leaves the survivor unbound on both projections', async () => {
      expect(summarize(rejectAllChanges(xml, { carryHeaderFooterReferences: false })))
        .toEqual([{ references: [], titlePg: false, landscape: false }]);
      expect(summarize(acceptAllChanges(fixture('s3b', removedSection(), { set: 'B' }, 'body'), { carryHeaderFooterReferences: false })))
        .toEqual([{ references: [], titlePg: false, landscape: false }]);
    });
  });

  test('docx-core reject of a snapshot-less paragraph section change carries its references', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    await given('a paragraph-owned sectPr with references whose sectPrChange has no snapshot', async () => {
      doc = parseXml(wrap(paragraph('First section',
        sectPr(removedSection()).replace('</w:sectPr>', `<w:sectPrChange w:id="2" ${DATE}/></w:sectPr>`))
        + paragraph('Second section') + sectPr({ set: 'B' })));
    });
    await when('all changes are rejected natively', async () => {
      rejectChanges(doc);
    });
    await then('the paragraph section is removed and the body section receives its references', async () => {
      expect(summarize(serializeXml(doc))).toEqual([{ references: refs('A', ALL, ALL), titlePg: false, landscape: false }]);
    });
  });

  test('the following section skips section-change snapshots and nested history', async ({ given, then, and }: AllureBddContext) => {
    let doc!: Document;
    await given('a boundary followed by a paragraph whose live sectPr holds a sectPrChange snapshot', async () => {
      doc = parseXml(wrap(
        paragraph('One', sectPr({ set: 'A', headers: ['default'] }))
        + paragraph('Two', `<w:sectPr><w:pgSz w:w="1"/><w:sectPrChange w:id="3" ${DATE}><w:sectPr><w:pgSz w:w="2"/></w:sectPr></w:sectPrChange></w:sectPr>`)
        + sectPr({ set: 'B' }),
      ));
    });
    await then('the survivor of the first boundary is the second paragraph\'s live sectPr', async () => {
      const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
      const survivor = followingSectionProperties(paragraphs.item(0)!);
      expect(survivor?.parentNode?.parentNode).toBe(paragraphs.item(1));
    });
    await and('the final paragraph section is followed by the body section', async () => {
      const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
      const survivor = followingSectionProperties(paragraphs.item(1)!);
      expect((survivor?.parentNode as Element | null)?.localName).toBe('body');
    });
  });

  test('carryForwardHeaderFooterRefs reports whether it copied anything', async ({ given, then }: AllureBddContext) => {
    let removed!: Element;
    await given('a removed section with one header reference', async () => {
      removed = parseXml(wrap(sectPr({ set: 'A', headers: ['default'] }))).getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
    });
    await then('it copies into an unbound survivor ahead of its page setup, and declines a bound one or an empty source', async () => {
      const unbound = parseXml(wrap(sectPr({ set: 'B' }))).getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
      expect(carryForwardHeaderFooterRefs(removed, unbound)).toBe(true);
      expect((unbound.firstChild as Element).localName).toBe('headerReference');
      const bound = parseXml(wrap(sectPr({ set: 'B', footers: ['first'] }))).getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
      expect(carryForwardHeaderFooterRefs(removed, bound)).toBe(false);
      const empty = parseXml(wrap(sectPr({ set: 'C' }))).getElementsByTagNameNS(W_NS, 'sectPr').item(0)!;
      expect(carryForwardHeaderFooterRefs(empty, parseXml(wrap(sectPr({ set: 'D' }))).getElementsByTagNameNS(W_NS, 'sectPr').item(0)!)).toBe(false);
    });
  });
});
