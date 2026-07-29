import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

import {
  emitFormattingTags,
  mergeAdjacentTags,
  type AnnotatedRun,
  type FormattingBaseline,
} from '../src/primitives/formatting_tags.js';
import { tokenizeToonInline } from '../src/primitives/document_view-comments.js';
import { parseXml } from '../src/primitives/xml.js';
import {
  extractStyleRunFormatting,
  parseStylesXml,
  type RunFormatting,
  type StyleRunFormatting,
  type StylesModel,
} from '../src/primitives/styles.js';

const TEST_FEATURE = 'update-docx-to-odf-style-fidelity';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const BASELINE: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: false };

function annotatedRun(text: string, formatting: Partial<RunFormatting> = {}): AnnotatedRun {
  return {
    text,
    formatting: {
      bold: false,
      italic: false,
      underline: false,
      highlightVal: false,
      fontName: '',
      fontSizePt: 0,
      colorHex: 'auto',
      ...formatting,
    },
    hyperlinkUrl: null,
    charCount: text.length,
    isHeaderRun: false,
  };
}

function stylesModelFrom(stylesBodyXml: string): StylesModel {
  return parseStylesXml(parseXml(`<w:styles xmlns:w="${W_NS}">${stylesBodyXml}</w:styles>`));
}

describe('full-mode highlight color tags', () => {
  test.openspec('[HLCOLOR-01] Full mode emits the highlight value, compact mode does not')(
    'full mode carries the w:highlight value as a color attribute; compact mode stays value-less',
    async ({ given, when, then, and }: AllureBddContext) => {
      let runs: AnnotatedRun[];
      let full: string;
      let compact: string;

      await given('a plain run followed by a green-highlighted run', async () => {
        runs = [annotatedRun('plain '), annotatedRun('lit', { highlightVal: 'green' })];
      });

      await when('tags are emitted in full and compact modes', async () => {
        full = emitFormattingTags({ runs, baseline: BASELINE, formattingMode: 'full' });
        compact = emitFormattingTags({ runs, baseline: BASELINE });
      });

      await then('full mode carries the color attribute', async () => {
        expect(full!).toContain('<highlight color="green">lit</highlight>');
      });

      await and('compact mode emits the value-less historical form', async () => {
        expect(compact!).toContain('<highlight>lit</highlight>');
        expect(compact!).not.toContain('color=');
      });

      await and('the tokenizer yields the attributed open tag as one tag token', async () => {
        const tokens = tokenizeToonInline(full!);
        expect(tokens).toContainEqual({ kind: 'tag', value: '<highlight color="green">' });
        expect(tokens.filter((t) => t.kind === 'text').map((t) => t.value).join('')).toBe('plain lit');
      });
    },
  );

  test.openspec('[HLCOLOR-02] Adjacent different-color highlights stay merged in compact mode')(
    'adjacent different-color highlights collapse in compact mode and stay distinct in full mode',
    async ({ given, when, then, and }: AllureBddContext) => {
      let runs: AnnotatedRun[];
      let compact: string;
      let full: string;

      await given('adjacent runs highlighted green and cyan', async () => {
        runs = [annotatedRun('one', { highlightVal: 'green' }), annotatedRun('two', { highlightVal: 'cyan' })];
      });

      await when('tags are emitted and adjacent tags merged in both modes', async () => {
        compact = mergeAdjacentTags(emitFormattingTags({ runs, baseline: BASELINE }));
        full = mergeAdjacentTags(emitFormattingTags({ runs, baseline: BASELINE, formattingMode: 'full' }));
      });

      await then('compact mode collapses to one value-less span (historical behavior)', async () => {
        expect(compact!).toBe('<highlight>onetwo</highlight>');
      });

      await and('full mode keeps the two color spans distinct', async () => {
        expect(full!).toBe('<highlight color="green">one</highlight><highlight color="cyan">two</highlight>');
      });
    },
  );
});

describe('style-chain run formatting extraction', () => {
  test.openspec('[STYLEFMT-01] Chain resolution distinguishes unspecified from false')(
    'extractStyleRunFormatting resolves the basedOn chain with tri-state semantics',
    async ({ given, when, then, and }: AllureBddContext) => {
      let model: StylesModel;
      let resolved: StyleRunFormatting;

      await given('Heading1 based on a bold 20pt Heading base, itself adding only a color', async () => {
        model = stylesModelFrom(
          `<w:style w:type="paragraph" w:styleId="Heading">` +
            `<w:name w:val="Heading"/>` +
            `<w:rPr><w:b/><w:sz w:val="40"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="paragraph" w:styleId="Heading1">` +
            `<w:name w:val="heading 1"/>` +
            `<w:basedOn w:val="Heading"/>` +
            `<w:rPr><w:color w:val="2E74B5"/></w:rPr>` +
            `</w:style>`,
        );
      });

      await when('formatting is extracted for Heading1', async () => {
        resolved = extractStyleRunFormatting(model!, 'Heading1');
      });

      await then('inherited and own properties resolve through the chain', async () => {
        expect(resolved!.bold).toBe(true);
        expect(resolved!.fontSizePt).toBe(20); // w:sz is half-points
        expect(resolved!.colorHex).toBe('2E74B5');
      });

      await and('properties no chain member specifies stay null (not false)', async () => {
        expect(resolved!.italic).toBeNull();
        expect(resolved!.fontName).toBeNull();
      });

      await and('an explicit w:val="0" override resolves to false, and unknown ids to all-null', async () => {
        const overrideModel = stylesModelFrom(
          `<w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style>` +
            `<w:style w:type="paragraph" w:styleId="Quiet"><w:basedOn w:val="Base"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>`,
        );
        expect(extractStyleRunFormatting(overrideModel, 'Quiet').bold).toBe(false);
        expect(extractStyleRunFormatting(overrideModel, 'Nope')).toEqual({
          bold: null,
          italic: null,
          fontName: null,
          fontSizePt: null,
          colorHex: null,
        });
      });
    },
  );
});
