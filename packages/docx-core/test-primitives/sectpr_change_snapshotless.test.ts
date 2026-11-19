/**
 * Accept and reject of a `w:sectPrChange` that has no `w:sectPr` snapshot
 * (#987).
 *
 * CT_SectPrChange's snapshot is optional (wml.xsd `minOccurs="0"`). An absent
 * snapshot records no prior page setup, so resolving the record must not
 * touch the live section. Every expectation below was recorded from Word 16
 * for Mac Accept All / Reject All on the same fixture shapes: Word drops the
 * record and keeps the live `w:sectPr` (page setup, `w:titlePg`, header/footer
 * references and, for a paragraph-owned `w:sectPr`, the section break) at both
 * body and paragraph level. A break goes away only when its paragraph mark is
 * itself a revision that the operation removes (an inserted mark rejected, a
 * deleted mark accepted); its references then carry forward (#1144).
 *
 * Each case runs on docx-core `acceptChanges`/`rejectChanges` and on
 * docx-compare `acceptAllChanges`/`rejectAllChanges`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/987
 */
import { describe, expect } from 'vitest';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';
import { acceptChanges } from '../src/primitives/accept_changes.js';
import { rejectChanges } from '../src/primitives/reject_changes.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'preserve-section-on-snapshotless-sectprchange';
const test = testAllure
  .epic('DOCX Primitives')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DATE = 'w:author="Tester" w:date="2026-10-08T00:00:00Z"';
const TYPES = ['default', 'first', 'even'] as const;

const MARGINS = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const LANDSCAPE = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const PORTRAIT = '<w:pgSz w:w="12240" w:h="15840"/>';
const NO_SNAPSHOT = `<w:sectPrChange w:id="9" ${DATE}/>`;
const INSERTED_MARK = `<w:rPr><w:ins w:id="1" ${DATE}/></w:rPr>`;
const DELETED_MARK = `<w:rPr><w:del w:id="1" ${DATE}/></w:rPr>`;

const referencesXml = (set: string): string =>
  TYPES.map((t) => `<w:headerReference w:type="${t}" r:id="rIdH${set}${t}"/>`).join('')
  + TYPES.map((t) => `<w:footerReference w:type="${t}" r:id="rIdF${set}${t}"/>`).join('');

interface SectionSpec {
  set: string;
  references?: boolean;
  landscape?: boolean;
  titlePg?: boolean;
  nextPage?: boolean;
  change?: string;
}

function sectPr(spec: SectionSpec): string {
  return `<w:sectPr>${spec.references ? referencesXml(spec.set) : ''}`
    + `${spec.nextPage ? '<w:type w:val="nextPage"/>' : ''}${spec.landscape ? LANDSCAPE : PORTRAIT}${MARGINS}`
    + `${spec.titlePg ? '<w:titlePg/>' : ''}${spec.change ?? ''}</w:sectPr>`;
}

const paragraph = (text: string, pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

const wrap = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;

/**
 * A paragraph-owned landscape, title-page section bound to set A whose live
 * `w:sectPr` carries a snapshot-less `w:sectPrChange`, followed by a portrait
 * body section (bound to set B when `survivorReferences`).
 */
function paragraphSection(opts: { references: boolean; mark?: string; survivorReferences?: boolean }): string {
  const section = sectPr({ set: 'A', references: opts.references, landscape: true, titlePg: true, nextPage: true, change: NO_SNAPSHOT });
  return wrap(paragraph('First section', `${opts.mark ?? ''}${section}`)
    + paragraph('Second section') + sectPr({ set: 'B', references: opts.survivorReferences }));
}

/** A single landscape, title-page body section with a snapshot-less change. */
function bodySection(references: boolean): string {
  return wrap(paragraph('Only section')
    + sectPr({ set: 'B', references, landscape: true, titlePg: true, change: NO_SNAPSHOT }));
}

type Mode = 'accept' | 'reject';
type Applier = { name: string; apply: (xml: string) => string };
const APPLIERS: Record<Mode, Applier[]> = {
  accept: [
    { name: 'docx-core acceptChanges', apply: (xml) => { const doc = parseXml(xml); acceptChanges(doc); return serializeXml(doc); } },
    { name: 'docx-compare acceptAllChanges', apply: acceptAllChanges },
  ],
  reject: [
    { name: 'docx-core rejectChanges', apply: (xml) => { const doc = parseXml(xml); rejectChanges(doc); return serializeXml(doc); } },
    { name: 'docx-compare rejectAllChanges', apply: rejectAllChanges },
  ],
};

interface SectionSummary {
  /** `body` or the text of the paragraph that owns the section. */
  owner: string;
  references: string[];
  landscape: boolean;
  titlePg: boolean;
  margins: boolean;
}

function summarize(xml: string): { paragraphs: string[]; sections: SectionSummary[]; revisions: number } {
  const doc = parseXml(xml);
  const text = (node: Element): string =>
    Array.from(node.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join('');
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0)!;
  const paragraphs = Array.from(body.childNodes)
    .filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === 'p')
    .map(text);
  const sections = Array.from(doc.getElementsByTagNameNS(W_NS, 'sectPr'))
    .filter((section) => (section.parentNode as Element | null)?.localName !== 'sectPrChange')
    .map((section) => {
      const parent = section.parentNode as Element;
      const children = Array.from(section.childNodes).filter((n): n is Element => n.nodeType === 1);
      return {
        owner: parent.localName === 'body' ? 'body' : text(parent.parentNode as Element),
        references: children
          .filter((c) => c.localName === 'headerReference' || c.localName === 'footerReference')
          .map((c) => `${c.localName === 'headerReference' ? 'H' : 'F'}.${c.getAttributeNS(W_NS, 'type')}=${c.getAttributeNS(R_NS, 'id')}`)
          .sort(),
        landscape: children.some((c) => c.localName === 'pgSz' && c.getAttributeNS(W_NS, 'orient') === 'landscape'),
        titlePg: children.some((c) => c.localName === 'titlePg'),
        margins: children.some((c) => c.localName === 'pgMar'),
      };
    });
  const revisions = ['ins', 'del', 'sectPrChange']
    .reduce((count, local) => count + doc.getElementsByTagNameNS(W_NS, local).length, 0);
  return { paragraphs, sections, revisions };
}

function refs(set: string): string[] {
  return [...TYPES.map((t) => `H.${t}=rIdH${set}${t}`), ...TYPES.map((t) => `F.${t}=rIdF${set}${t}`)].sort();
}

const landscapeA = (references: boolean): SectionSummary =>
  ({ owner: 'First section', references: references ? refs('A') : [], landscape: true, titlePg: true, margins: true });
const portraitBody = (references: string[] = []): SectionSummary =>
  ({ owner: 'body', references, landscape: false, titlePg: false, margins: true });

function expectWord(xml: string, mode: Mode, expected: ReturnType<typeof summarize>): void {
  for (const applier of APPLIERS[mode]) {
    expect(summarize(applier.apply(xml)), `${applier.name}`).toEqual(expected);
  }
}

const KEPT_PARAGRAPH_SECTION = (references: boolean, survivor: string[] = []) => ({
  paragraphs: ['First section', 'Second section'],
  sections: [landscapeA(references), portraitBody(survivor)],
  revisions: 0,
});

describe('snapshot-less w:sectPrChange (Word 16 Accept All / Reject All)', () => {
  test.openspec('rejecting a snapshot-less paragraph section change keeps the section break')(
    'rejecting a snapshot-less paragraph section change keeps the section break',
    async ({ given, when, then }: AllureBddContext) => {
      let withReferences!: string;
      let withoutReferences!: string;
      let survivorBound!: string;
      await given('a paragraph-owned landscape title-page sectPr whose sectPrChange has no snapshot', async () => {
        withReferences = paragraphSection({ references: true });
        withoutReferences = paragraphSection({ references: false });
        survivorBound = paragraphSection({ references: true, survivorReferences: true });
      });
      await when('all changes are rejected on both appliers', async () => {});
      await then('only the record goes: the break, its page setup and its references stay', async () => {
        expectWord(withReferences, 'reject', KEPT_PARAGRAPH_SECTION(true));
        expectWord(withoutReferences, 'reject', KEPT_PARAGRAPH_SECTION(false));
        expectWord(survivorBound, 'reject', KEPT_PARAGRAPH_SECTION(true, refs('B')));
      });
    },
  );

  test.openspec('rejecting a snapshot-less body section change keeps the final section')(
    'rejecting a snapshot-less body section change keeps the final section',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a landscape title-page body sectPr whose sectPrChange has no snapshot, with and without references', async () => {});
      await when('all changes are rejected on both appliers', async () => {});
      await then('the body section keeps its page setup and references', async () => {
        for (const references of [true, false]) {
          expectWord(bodySection(references), 'reject', {
            paragraphs: ['Only section'],
            sections: [{ owner: 'body', references: references ? refs('B') : [], landscape: true, titlePg: true, margins: true }],
            revisions: 0,
          });
        }
      });
    },
  );

  test.openspec('accepting a snapshot-less section change keeps the live section')(
    'accepting a snapshot-less section change keeps the live section',
    async ({ given, when, then }: AllureBddContext) => {
      await given('paragraph-owned and body-level sectPrs whose sectPrChange has no snapshot', async () => {});
      await when('all changes are accepted on both appliers', async () => {});
      await then('only the record goes', async () => {
        expectWord(paragraphSection({ references: true }), 'accept', KEPT_PARAGRAPH_SECTION(true));
        expectWord(paragraphSection({ references: false }), 'accept', KEPT_PARAGRAPH_SECTION(false));
        expectWord(bodySection(true), 'accept', {
          paragraphs: ['Only section'],
          sections: [{ owner: 'body', references: refs('B'), landscape: true, titlePg: true, margins: true }],
          revisions: 0,
        });
      });
    },
  );

  test.openspec('a snapshot-less section change on a removed break still carries its references')(
    'a snapshot-less section change on a removed break still carries its references',
    async ({ given, when, then, and }: AllureBddContext) => {
      await given('a section whose paragraph mark is inserted or deleted and whose sectPrChange has no snapshot', async () => {});
      await when('rejecting the inserted mark', async () => {});
      await then('the break goes, its paragraph merges forward and the body section receives its references', async () => {
        expectWord(paragraphSection({ references: true, mark: INSERTED_MARK }), 'reject', {
          paragraphs: ['First sectionSecond section'],
          sections: [portraitBody(refs('A'))],
          revisions: 0,
        });
        expectWord(paragraphSection({ references: false, mark: INSERTED_MARK }), 'reject', {
          paragraphs: ['First sectionSecond section'],
          sections: [portraitBody()],
          revisions: 0,
        });
      });
      await and('accepting the inserted mark, or rejecting the deleted one, keeps the break', async () => {
        expectWord(paragraphSection({ references: true, mark: INSERTED_MARK }), 'accept', KEPT_PARAGRAPH_SECTION(true));
        expectWord(paragraphSection({ references: false, mark: INSERTED_MARK }), 'accept', KEPT_PARAGRAPH_SECTION(false));
        expectWord(paragraphSection({ references: true, mark: DELETED_MARK }), 'reject', KEPT_PARAGRAPH_SECTION(true));
      });
      await and('accepting the deleted mark removes the break and carries its references', async () => {
        expectWord(paragraphSection({ references: true, mark: DELETED_MARK }), 'accept', {
          paragraphs: ['First sectionSecond section'],
          sections: [portraitBody(refs('A'))],
          revisions: 0,
        });
      });
    },
  );

  test('an added default-property break recorded without a snapshot is kept', async ({ given, then }: AllureBddContext) => {
    let xml!: string;
    await given('a paragraph whose live sectPr holds only a snapshot-less sectPrChange', async () => {
      xml = wrap(paragraph('First section', `<w:sectPr>${NO_SNAPSHOT}</w:sectPr>`)
        + paragraph('Second section') + sectPr({ set: 'B', references: true }));
    });
    await then('both accept and reject keep the paragraph section break (Word writes it with default page setup)', async () => {
      for (const mode of ['accept', 'reject'] as const) {
        for (const applier of APPLIERS[mode]) {
          const out = summarize(applier.apply(xml));
          expect(out.sections.map((s) => s.owner), applier.name).toEqual(['First section', 'body']);
          expect(out.sections[1]!.references, applier.name).toEqual(refs('B'));
          expect(out.revisions, applier.name).toBe(0);
        }
      }
    });
  });

  test('the #987 reproduction keeps its header binding and page size', async ({ given, when, then }: AllureBddContext) => {
    let doc!: Document;
    let expected!: string;
    let result!: ReturnType<typeof rejectChanges>;
    await given('the issue\'s schema-valid paragraph section with a default header and an AI sectPrChange', async () => {
      const xml = (change: string): string => wrap('<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId4"/>'
        + `<w:pgSz w:w="12240" w:h="15840"/>${change}</w:sectPr></w:pPr>`
        + '<w:r><w:t>A</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>');
      doc = parseXml(xml('<w:sectPrChange w:id="2" w:author="AI"/>'));
      expected = serializeXml(parseXml(xml('')));
    });
    await when('all changes are rejected natively', async () => {
      result = rejectChanges(doc);
    });
    await then('the record is resolved and nothing else changes', async () => {
      expect(result.propertyChangesReverted).toBe(1);
      expect(serializeXml(doc)).toBe(expected);
    });
  });

  test('selective reject resolves the selected author\'s record and leaves a foreign one untouched', async ({ given, when, then, and }: AllureBddContext) => {
    let doc!: Document;
    let foreignBefore!: string;
    let result!: ReturnType<typeof rejectChanges>;
    await given('a paragraph section with an AI snapshot-less sectPrChange and a body section with a Human one', async () => {
      const change = (author: string): string => `<w:sectPrChange w:id="9" w:author="${author}" w:date="2026-10-08T00:00:00Z"/>`;
      doc = parseXml(wrap(paragraph('First section', sectPr({ set: 'A', references: true, landscape: true, titlePg: true, change: change('AI') }))
        + paragraph('Second section') + sectPr({ set: 'B', references: true, change: change('Human') })));
      foreignBefore = serializeXml(doc.getElementsByTagNameNS(W_NS, 'body').item(0)!.lastChild!);
    });
    await when('only AI changes are rejected', async () => {
      result = rejectChanges(doc, { filter: (el) => el.getAttributeNS(W_NS, 'author') === 'AI' });
    });
    await then('the AI record is resolved and its paragraph section is kept whole', async () => {
      expect(result.propertyChangesReverted).toBe(1);
      const summary = summarize(serializeXml(doc));
      expect(summary.sections[0]).toEqual(landscapeA(true));
      expect(summary.revisions).toBe(1);
    });
    await and('the Human body section is byte-for-byte unchanged', async () => {
      expect(serializeXml(doc.getElementsByTagNameNS(W_NS, 'body').item(0)!.lastChild!)).toBe(foreignBefore);
    });
  });
});
