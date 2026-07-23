import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import {
  buildNodesForDocumentView,
  type DocumentViewNode,
} from '../src/primitives/document_view.js';
import {
  BUILT_IN_HEADING_ALIASES_V1,
  getBuiltInHeadingLevel,
} from '../src/primitives/heading_styles.js';
import { parseXml } from '../src/primitives/xml.js';

const TEST_FEATURE = 'add-deterministic-heading-provenance';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const outlineTest = test.conformance({
  spec: 'ECMA-376',
  edition: 5,
  part: 1,
  section: '17.3.1.20',
});
const numberingTest = test
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.6' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.9.22' });

function wrapDocument(bodyXml: string): Document {
  return parseXml(
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}

function wrapStyles(stylesXml: string): Document {
  return parseXml(`<w:styles xmlns:w="${W_NS}">${stylesXml}</w:styles>`);
}

function wrapNumbering(numberingXml: string): Document {
  return parseXml(`<w:numbering xmlns:w="${W_NS}">${numberingXml}</w:numbering>`);
}

function buildNodes(params: {
  bodyXml: string;
  stylesXml?: string;
  numberingXml?: string;
  inTable?: boolean;
}): DocumentViewNode[] {
  const document = wrapDocument(params.bodyXml);
  const paragraphs = Array.from(document.getElementsByTagNameNS(W_NS, 'p')).map(
    (p, index) => ({
      id: `_bk_${index + 1}`,
      p,
      ...(params.inTable
        ? {
            tableContext: {
              table_id: '_tbl_0',
              table_index: 0,
              row_index: 0,
              col_index: index,
              col_header: '',
              total_rows: 1,
              total_cols: 1,
              is_header_row: false,
              para_in_cell: 0,
              cell_para_count: 1,
            },
          }
        : {}),
    }),
  );
  return buildNodesForDocumentView({
    paragraphs,
    stylesXml: params.stylesXml ? wrapStyles(params.stylesXml) : null,
    numberingXml: params.numberingXml ? wrapNumbering(params.numberingXml) : null,
    include_semantic_tags: false,
    show_formatting: false,
  }).nodes;
}

function paragraph(
  text: string,
  properties = '',
): string {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const BODY_STYLE =
  `<w:style w:type="paragraph" w:styleId="BodyText">` +
  `<w:name w:val="Body Text"/></w:style>`;
const HEADING_STYLES =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="heading 1"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2">` +
  `<w:name w:val="heading 2"/></w:style>`;

describe('deterministic heading provenance', () => {
  outlineTest.openspec('[HEAD-PROV-01] Effective outline level classifies a generic paragraph')(
    'resolves direct and inherited outline levels with direct precedence',
    async ({ given, when, then, and }: AllureBddContext) => {
      const stylesXml =
        `<w:style w:type="paragraph" w:styleId="OutlineBase">` +
        `<w:name w:val="Outline Base"/><w:pPr><w:outlineLvl w:val="4"/></w:pPr>` +
        `</w:style>` +
        `<w:style w:type="paragraph" w:styleId="OutlineChild">` +
        `<w:name w:val="Outline Child"/><w:basedOn w:val="OutlineBase"/></w:style>`;
      const bodyXml =
        paragraph(
          'Direct outline heading',
          `<w:pStyle w:val="OutlineChild"/><w:outlineLvl w:val="1"/>`,
        ) +
        paragraph('Inherited outline heading', `<w:pStyle w:val="OutlineChild"/>`);

      await given('a style-chain outline level and a conflicting direct value', () => {});
      const nodes = buildNodes({ bodyXml, stylesXml });
      await when('the document view is built', () => {});

      await then('the direct value maps from OOXML 1 to public heading level 2', () => {
        expect(nodes[0]!.heading).toEqual({
          text: 'Direct outline heading',
          source: 'outline_level',
          level: 2,
        });
      });
      await and('the inherited value is used when no direct value exists', () => {
        expect(nodes[1]!.heading).toEqual({
          text: 'Inherited outline heading',
          source: 'outline_level',
          level: 5,
        });
      });
    },
  );

  outlineTest.openspec('[HEAD-PROV-02] Body-text and malformed outline values do not classify')(
    'ignores body-text, missing, malformed, negative, and out-of-range outline values',
    async ({ given, when, then }: AllureBddContext) => {
      const values = ['9', null, 'not-a-number', '-1', '10'];
      const bodyXml = values
        .map((value, index) =>
          paragraph(
            `ordinary body paragraph ${index}`,
            value === null ? '' : `<w:outlineLvl w:val="${value}"/>`,
          ),
        )
        .join('');

      await given('paragraphs carrying every non-heading outline-level shape', () => {});
      const nodes = buildNodes({ bodyXml });
      await when('the document view is built without other heading evidence', () => {});

      await then('none receives deterministic or heuristic heading metadata', () => {
        expect(nodes).toHaveLength(values.length);
        expect(nodes.every((node) => node.heading === undefined)).toBe(true);
      });
    },
  );

  numberingTest.openspec('[HEAD-PROV-03] Active numbering-level style association classifies')(
    'uses only the active numbering level and fails closed on missing definitions',
    async ({ given, when, then, and }: AllureBddContext) => {
      const numberingXml =
        `<w:abstractNum w:abstractNumId="1">` +
        `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:pStyle w:val="BodyText"/>` +
        `<w:lvlText w:val="%1."/></w:lvl>` +
        `<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/>` +
        `<w:lvlText w:val="%2."/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>`;
      const bodyXml =
        paragraph(
          'Numbered Terms',
          `<w:numPr><w:ilvl w:val="1"/><w:numId w:val="10"/></w:numPr>`,
        ) +
        paragraph(
          'ordinary numbered body',
          `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="10"/></w:numPr>`,
        ) +
        paragraph(
          'missing numbering definition body',
          `<w:numPr><w:ilvl w:val="1"/><w:numId w:val="999"/></w:numPr>`,
        );

      await given('one active heading-associated level, another level, and a missing numId', () => {});
      const nodes = buildNodes({
        bodyXml,
        stylesXml: BODY_STYLE + HEADING_STYLES,
        numberingXml,
      });
      await when('the document view is built', () => {});

      await then('the active Heading 2 association classifies with list provenance', () => {
        expect(nodes[0]!.heading).toEqual({
          text: 'Numbered Terms',
          source: 'list_metadata',
          level: 2,
        });
      });
      await and('an unrelated level and missing definition do not classify', () => {
        expect(nodes[1]!.heading).toBeUndefined();
        expect(nodes[2]!.heading).toBeUndefined();
      });
    },
  );

  test.openspec('[HEAD-PROV-04] Built-in heading style wins conflicting metadata')(
    'applies word-style then list-metadata then outline-level precedence',
    async ({ given, when, then, and }: AllureBddContext) => {
      const numberingXml =
        `<w:abstractNum w:abstractNumId="2">` +
        `<w:lvl w:ilvl="0"><w:pStyle w:val="Heading2"/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="20"><w:abstractNumId w:val="2"/></w:num>`;
      const list = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="20"/></w:numPr>`;
      const bodyXml =
        paragraph(
          'Style Wins',
          `<w:pStyle w:val="Heading1"/>${list}<w:outlineLvl w:val="2"/>`,
        ) +
        paragraph(
          'List Wins',
          `<w:pStyle w:val="BodyText"/>${list}<w:outlineLvl w:val="0"/>`,
        );

      await given('paragraphs with conflicting deterministic evidence', () => {});
      const nodes = buildNodes({
        bodyXml,
        stylesXml: BODY_STYLE + HEADING_STYLES,
        numberingXml,
      });
      await when('the document view is built', () => {});

      await then('the built-in paragraph style wins list and outline metadata', () => {
        expect(nodes[0]!.heading).toEqual({
          text: 'Style Wins',
          source: 'word_style',
          level: 1,
        });
      });
      await and('list metadata wins outline metadata when the style is not a heading', () => {
        expect(nodes[1]!.heading).toEqual({
          text: 'List Wins',
          source: 'list_metadata',
          level: 2,
        });
      });
    },
  );

  test.openspec('[HEAD-PROV-05] Localized built-in name maps to its heading level')(
    'recognizes the French built-in heading display name',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a custom style id whose exact display name is Titre 1', () => {});
      const nodes = buildNodes({
        bodyXml: paragraph('Objet', `<w:pStyle w:val="FrenchHeading"/>`),
        stylesXml:
          `<w:style w:type="paragraph" w:styleId="FrenchHeading">` +
          `<w:name w:val="Titre 1"/></w:style>`,
      });
      await when('the document view is built', () => {});

      await then('the paragraph is a level-1 word-style heading', () => {
        expect(nodes[0]!.heading).toEqual({
          text: 'Objet',
          source: 'word_style',
          level: 1,
        });
      });
    },
  );

  test.openspec('[HEAD-PROV-06] TOC style is not a built-in heading alias')(
    'does not classify TOC styles as headings',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a TOC 1 paragraph style with no other heading evidence', () => {});
      const nodes = buildNodes({
        bodyXml: paragraph(
          'ordinary table of contents entry body',
          `<w:pStyle w:val="TOC1"/>`,
        ),
        stylesXml:
          `<w:style w:type="paragraph" w:styleId="TOC1">` +
          `<w:name w:val="TOC 1"/></w:style>`,
      });
      await when('the document view is built', () => {});

      await then('the paragraph has no deterministic heading', () => {
        expect(nodes[0]!.heading).toBeUndefined();
      });
    },
  );

  test.openspec('[HEAD-PROV-07] Nested deterministic headings retain order and levels')(
    'retains 1-2-1 order across style, list, and outline provenance',
    async ({ given, when, then }: AllureBddContext) => {
      const numberingXml =
        `<w:abstractNum w:abstractNumId="3">` +
        `<w:lvl w:ilvl="0"><w:pStyle w:val="Heading2"/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="30"><w:abstractNumId w:val="3"/></w:num>`;
      const bodyXml =
        paragraph('First', `<w:pStyle w:val="Heading1"/>`) +
        paragraph(
          'Second',
          `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="30"/></w:numPr>`,
        ) +
        paragraph('Third', `<w:outlineLvl w:val="0"/>`);

      await given('three deterministic headings from distinct sources', () => {});
      const nodes = buildNodes({
        bodyXml,
        stylesXml: HEADING_STYLES,
        numberingXml,
      });
      await when('the document view is built', () => {});

      await then('document order and levels remain exactly 1, 2, 1', () => {
        expect(nodes.map((node) => node.heading?.level)).toEqual([1, 2, 1]);
        expect(nodes.map((node) => node.heading?.source)).toEqual([
          'word_style',
          'list_metadata',
          'outline_level',
        ]);
      });
    },
  );

  test('the versioned alias table and literal style IDs are exact and bounded', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    await given('every v1 localized alias and every literal Heading1 through Heading9 id', () => {});
    const aliasLevels = BUILT_IN_HEADING_ALIASES_V1.map(({ name }) =>
      getBuiltInHeadingLevel('CustomStyle', `  ${name.replace(' ', '   ')}  `),
    );
    const idLevels = Array.from({ length: 9 }, (_, index) =>
      getBuiltInHeadingLevel(`Heading${index + 1}`, null),
    );
    await when('the bounded lookup normalizes Unicode whitespace but performs no fuzzy match', () => {});

    await then('every alias and literal id maps to its declared level', () => {
      expect(aliasLevels).toEqual(
        BUILT_IN_HEADING_ALIASES_V1.map(({ level }) => level),
      );
      expect(idLevels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
    await and('TOC and near-miss names remain outside the alias table', () => {
      expect(getBuiltInHeadingLevel('TOC1', 'TOC 1')).toBeNull();
      expect(getBuiltInHeadingLevel('Custom', 'Headingish 1')).toBeNull();
    });
  });

  test('explicit deterministic structure remains visible inside table cells', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const numberingXml =
      `<w:abstractNum w:abstractNumId="4">` +
      `<w:lvl w:ilvl="0"><w:pStyle w:val="Heading2"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="40"><w:abstractNumId w:val="4"/></w:num>`;
    const bodyXml =
      paragraph('Styled Cell', `<w:pStyle w:val="Heading1"/>`) +
      paragraph(
        'Numbered Cell',
        `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="40"/></w:numPr>`,
      ) +
      paragraph('Outlined Cell', `<w:outlineLvl w:val="2"/>`);

    await given('style, list, and outline headings inside table cells', () => {});
    const nodes = buildNodes({
      bodyXml,
      stylesXml: HEADING_STYLES,
      numberingXml,
      inTable: true,
    });
    await when('the document view is built', () => {});

    await then('all deterministic sources remain headings in their cells', () => {
      expect(nodes.map((node) => node.heading?.source)).toEqual([
        'word_style',
        'list_metadata',
        'outline_level',
      ]);
    });
  });
});
