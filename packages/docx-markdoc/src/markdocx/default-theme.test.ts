import type {ParagraphSpec} from '@usejunior/docx-core';
import {describe, expect} from 'vitest';
import {itAllure as it} from '../../../docx-core/src/testing/allure-test.js';

import {
  defaultPreset,
  MDX_BULLET_NUM_ID,
  MDX_ORDERED_NUM_ID,
  MDX_STYLE_BODY,
  MDX_STYLE_HEADING_1,
  MDX_STYLE_HEADING_2,
  MDX_STYLE_HEADING_3,
} from './default-theme.js';
import {renderMarkdocxToDocumentSpec} from './render.js';

describe('default markdocx preset', () => {
  it('defines explicit custom Word styles for body and headings', () => {
    expect(defaultPreset.styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          styleId: MDX_STYLE_BODY,
          basedOn: 'Normal',
          paragraph: {alignment: 'left', spacing: {afterTwips: 160, lineTwips: 276, lineRule: 'auto'}},
          run: {font: 'Calibri', sizePt: 11, colorHex: '1A1A1A'},
        }),
        expect.objectContaining({
          styleId: MDX_STYLE_HEADING_1,
          basedOn: 'Normal',
          paragraph: {alignment: 'left', spacing: {beforeTwips: 0, afterTwips: 120}, keepNext: true},
          run: {font: 'Calibri', sizePt: 20, bold: true, colorHex: '1A1A1A'},
        }),
        expect.objectContaining({
          styleId: MDX_STYLE_HEADING_2,
          basedOn: 'Normal',
          paragraph: {alignment: 'left', spacing: {beforeTwips: 240, afterTwips: 80}, keepNext: true},
          run: {font: 'Calibri', sizePt: 15, bold: true, colorHex: '1A1A1A'},
        }),
        expect.objectContaining({
          styleId: MDX_STYLE_HEADING_3,
          basedOn: 'Normal',
          paragraph: {alignment: 'left', spacing: {beforeTwips: 200, afterTwips: 80}, keepNext: true},
          run: {font: 'Calibri', sizePt: 12, bold: true, colorHex: '333333'},
        }),
      ]),
    );
    expect(defaultPreset.styles.find((style) => style.styleId === MDX_STYLE_HEADING_2)?.basedOn).not.toBe('Heading2');
  });

  it('ships separate bullet and ordered numbering definitions', () => {
    expect(defaultPreset.numbering).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          numId: MDX_BULLET_NUM_ID,
          levels: expect.arrayContaining([expect.objectContaining({ilvl: 0, numFmt: 'bullet'})]),
        }),
        expect.objectContaining({
          numId: MDX_ORDERED_NUM_ID,
          levels: expect.arrayContaining([expect.objectContaining({ilvl: 0, numFmt: 'decimal'})]),
        }),
      ]),
    );
  });

  it('gives each ordered level its own counter token so nested numbering is correct', () => {
    const ordered = defaultPreset.numbering.find((def) => def.numId === MDX_ORDERED_NUM_ID);
    expect(ordered?.levels.map((level) => level.lvlText)).toEqual(['%1.', '%2.', '%3.', '%4.']);
  });

  it('assembles a one-section DocumentSpec with styled blocks', () => {
    const spec = renderMarkdocxToDocumentSpec(
      ['# Title', '', 'A paragraph.', '', '1. one', '', '- bullet', '', '---', '', '## Section', '', '### Sub'].join('\n'),
    );

    expect(spec.styles).toBe(defaultPreset.styles);
    expect(spec.numbering).toBe(defaultPreset.numbering);
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0].page).toBe(defaultPreset.page);

    const paragraphs = spec.sections[0].blocks.filter((block): block is ParagraphSpec => block.kind === 'paragraph');
    expect(paragraphs.map((paragraph) => paragraph.styleId)).toEqual(
      expect.arrayContaining([MDX_STYLE_HEADING_1, MDX_STYLE_BODY, MDX_STYLE_HEADING_2, MDX_STYLE_HEADING_3]),
    );
    expect(paragraphs.find((paragraph) => paragraph.runs.some((run) => run.kind === 'text' && run.text === 'one'))?.list).toEqual({
      numId: MDX_ORDERED_NUM_ID,
      ilvl: 0,
    });
    expect(paragraphs.find((paragraph) => paragraph.runs.some((run) => run.kind === 'text' && run.text === 'bullet'))?.list).toEqual({
      numId: MDX_BULLET_NUM_ID,
      ilvl: 0,
    });
  });
});
