/**
 * Native accept of a tracked paragraph-level section-break removal (#1143).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.32
 * @see https://github.com/UseJunior/safe-docx/issues/1143
 */
import { describe, expect } from 'vitest';
import { acceptAllChanges } from '@usejunior/docx-compare';
import { acceptChanges } from '../src/primitives/accept_changes.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

const TEST_FEATURE = 'remove-native-accepted-ghost-section-break';
const test = testAllure
  .epic('DOCX Primitives')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.32' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const wrapBodyXml = (bodyXml: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`;

const FINAL_SECTION = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

function removedBreak(id: string, author: string, text: string): string {
  return `<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z">`
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440"/></w:sectPr>'
    + `</w:sectPrChange></w:sectPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function paragraphSections(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'sectPr'))
    .filter((section) => (section.parentNode as Element | null)?.localName === 'pPr');
}

function bodySections(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'sectPr'))
    .filter((section) => (section.parentNode as Element | null)?.localName === 'body');
}

describe('Traceability: Accept Tracked Section-Break Removals', () => {
  test.openspec('native accept removes a tracked paragraph section-break removal')(
    'native accept removes a tracked paragraph section-break removal',
    async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      let summary!: ReturnType<typeof acceptChanges>;

      await given('a paragraph whose live sectPr holds only a sectPrChange with prior page setup', async () => {
        doc = parseXml(wrapBodyXml(removedBreak('1', 'A', 'Alpha') + '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p>' + FINAL_SECTION));
      });
      await when('all changes are accepted', async () => {
        summary = acceptChanges(doc);
      });
      await then('no paragraph-level section break remains', async () => {
        expect(paragraphSections(doc)).toHaveLength(0);
        expect(serializeXml(doc)).not.toContain('sectPrChange');
      });
      await and('the revision is reported once and the final section is untouched', async () => {
        expect(summary.propertyChangesResolved).toBe(1);
        expect(bodySections(doc)).toHaveLength(1);
        expect(serializeXml(bodySections(doc)[0]!)).toBe(
          `<w:sectPr xmlns:w="${W_NS}"><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
        );
        expect(serializeXml(doc)).toContain('<w:t>Alpha</w:t>');
      });
    },
  );

  test.openspec('native accept keeps an added default section break')(
    'native accept keeps an added default section break',
    async ({ given, when, then }: AllureBddContext) => {
      let doc!: Document;

      await given('a paragraph whose empty live sectPr carries an empty sectPrChange snapshot', async () => {
        doc = parseXml(wrapBodyXml(
          '<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="1" w:author="A"><w:sectPr/></w:sectPrChange></w:sectPr></w:pPr>'
          + '<w:r><w:t>Added break</w:t></w:r></w:p>' + FINAL_SECTION,
        ));
      });
      await when('all changes are accepted', async () => {
        acceptChanges(doc);
      });
      await then('the added paragraph-level section break survives without its change record', async () => {
        expect(paragraphSections(doc)).toHaveLength(1);
        expect(serializeXml(doc)).not.toContain('sectPrChange');
      });
    },
  );

  test.openspec('native accept preserves live and final section properties')(
    'native accept preserves live and final section properties',
    async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;

      await given('a paragraph sectPr with a live property and a body sectPr that each carry a change record', async () => {
        doc = parseXml(wrapBodyXml(
          '<w:p><w:pPr><w:sectPr><w:pgMar w:top="900"/>'
          + '<w:sectPrChange w:id="1" w:author="A"><w:sectPr><w:pgMar w:top="800"/></w:sectPr></w:sectPrChange>'
          + '</w:sectPr></w:pPr><w:r><w:t>Live section</w:t></w:r></w:p>'
          + '<w:sectPr><w:sectPrChange w:id="2" w:author="A"><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:sectPrChange></w:sectPr>',
        ));
      });
      await when('all changes are accepted', async () => {
        acceptChanges(doc);
      });
      await then('the live paragraph section keeps its current property', async () => {
        expect(paragraphSections(doc)).toHaveLength(1);
        expect(serializeXml(doc)).toContain('w:pgMar w:top="900"');
        expect(serializeXml(doc)).not.toContain('w:pgMar w:top="800"');
      });
      await and('the body-level final section properties container is kept', async () => {
        expect(bodySections(doc)).toHaveLength(1);
        expect(serializeXml(doc)).not.toContain('sectPrChange');
      });
    },
  );

  test.openspec('selective accept leaves foreign section-break history untouched')(
    'selective accept leaves foreign section-break history untouched',
    async ({ given, when, then, and }: AllureBddContext) => {
      let doc!: Document;
      const foreign = removedBreak('2', 'Foreign', 'Bravo');

      await given('two tracked section-break removals by different authors', async () => {
        doc = parseXml(wrapBodyXml(removedBreak('1', 'Target', 'Alpha') + foreign + FINAL_SECTION));
      });
      await when('only the target author\'s revisions are accepted', async () => {
        acceptChanges(doc, { filter: (el) => el.getAttributeNS(W_NS, 'author') === 'Target' });
      });
      await then('the target removal leaves no paragraph-level section break', async () => {
        const remaining = paragraphSections(doc);
        expect(remaining).toHaveLength(1);
        expect(serializeXml(doc)).not.toContain('w:author="Target"');
      });
      await and('the foreign paragraph and its section history are byte-identical', async () => {
        const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
        expect(serializeXml(paragraphs[1]!).replace(` xmlns:w="${W_NS}"`, '')).toBe(foreign);
      });
    },
  );

  test.openspec('native accept and comparison accept agree on section-break removals')(
    'native accept and comparison accept agree on section-break removals',
    async ({ given, when, then }: AllureBddContext) => {
      let xml!: string;
      let native!: Document;
      let compared!: Document;

      await given('a tracked section-break removal followed by an added default section break', async () => {
        xml = wrapBodyXml(
          removedBreak('1', 'A', 'Removed break')
          + '<w:p><w:pPr><w:sectPr><w:sectPrChange w:id="2" w:author="A"><w:sectPr/></w:sectPrChange></w:sectPr></w:pPr>'
          + '<w:r><w:t>Added break</w:t></w:r></w:p>'
          + FINAL_SECTION,
        );
      });
      await when('the document is accepted natively and by the comparison acceptor', async () => {
        native = parseXml(xml);
        acceptChanges(native);
        compared = parseXml(acceptAllChanges(xml));
      });
      await then('both keep only the added break as a paragraph-level section', async () => {
        const owners = (doc: Document) => paragraphSections(doc)
          .map((section) => section.parentNode?.parentNode?.textContent ?? '');
        expect(owners(native)).toEqual(['Added break']);
        expect(owners(compared)).toEqual(owners(native));
        expect(bodySections(compared)).toHaveLength(bodySections(native).length);
      });
    },
  );
});
