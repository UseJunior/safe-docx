import type {
  BlockSpec,
  InlineSpec,
  NumberingSpec,
  ParagraphSpec,
  StyleSpec,
} from '@usejunior/docx-core';

import type {InlineStyle, Theme} from './engine.js';

export interface Preset {
  theme: Theme;
  styles: StyleSpec[];
  numbering: NumberingSpec[];
  page: {
    sizeTwips: {w: number; h: number};
    marginsTwips: {
      top: number;
      right: number;
      bottom: number;
      left: number;
      header?: number;
      footer?: number;
    };
  };
}

export const MDX_STYLE_BODY = 'MdxBody';
export const MDX_STYLE_HEADING_1 = 'MdxHeading1';
export const MDX_STYLE_HEADING_2 = 'MdxHeading2';
export const MDX_STYLE_HEADING_3 = 'MdxHeading3';

export const MDX_BULLET_NUM_ID = 'mdxBullet';
export const MDX_ORDERED_NUM_ID = 'mdxOrdered';

const FONT_BODY = 'Calibri';
const COLOR_BODY = '1A1A1A';
const COLOR_SUBHEADING = '333333';

const defaultPage = {
  sizeTwips: {w: 12240, h: 15840},
  marginsTwips: {top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720},
} as const;

function paragraph(
  styleId: string,
  runs: InlineSpec[],
  overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {},
): ParagraphSpec {
  return {kind: 'paragraph', styleId, runs, ...overrides};
}

function renderText(text: string, style: InlineStyle): InlineSpec[] {
  return [{kind: 'text', text, bold: style.bold, italic: style.italic}];
}

function fieldRuns(text: string, filled: boolean, style: InlineStyle): InlineSpec[] {
  return [{kind: 'text', text: filled ? text : `[${text}]`, bold: true, italic: style.italic}];
}

const styles: StyleSpec[] = [
  {
    styleId: MDX_STYLE_BODY,
    name: 'Markdocx Body',
    type: 'paragraph',
    basedOn: 'Normal',
    next: MDX_STYLE_BODY,
    paragraph: {
      alignment: 'left',
      spacing: {afterTwips: 160, lineTwips: 276, lineRule: 'auto'},
    },
    run: {font: FONT_BODY, sizePt: 11, colorHex: COLOR_BODY},
  },
  {
    styleId: MDX_STYLE_HEADING_1,
    name: 'Markdocx Heading 1',
    type: 'paragraph',
    basedOn: 'Normal',
    next: MDX_STYLE_BODY,
    paragraph: {
      alignment: 'left',
      spacing: {beforeTwips: 0, afterTwips: 120},
      keepNext: true,
    },
    run: {font: FONT_BODY, sizePt: 20, bold: true, colorHex: COLOR_BODY},
  },
  {
    styleId: MDX_STYLE_HEADING_2,
    name: 'Markdocx Heading 2',
    type: 'paragraph',
    basedOn: 'Normal',
    next: MDX_STYLE_BODY,
    paragraph: {
      alignment: 'left',
      spacing: {beforeTwips: 240, afterTwips: 80},
      keepNext: true,
    },
    run: {font: FONT_BODY, sizePt: 15, bold: true, colorHex: COLOR_BODY},
  },
  {
    styleId: MDX_STYLE_HEADING_3,
    name: 'Markdocx Heading 3',
    type: 'paragraph',
    basedOn: 'Normal',
    next: MDX_STYLE_BODY,
    paragraph: {
      alignment: 'left',
      spacing: {beforeTwips: 200, afterTwips: 80},
      keepNext: true,
    },
    run: {font: FONT_BODY, sizePt: 12, bold: true, colorHex: COLOR_SUBHEADING},
  },
];

const listIndents = [720, 1080, 1440, 1800];

function listLevels(
  numFmt: 'bullet' | 'decimal',
  lvlText: (ilvl: number) => string,
): NumberingSpec['levels'] {
  return listIndents.map((left, ilvl) => ({
    ilvl,
    start: numFmt === 'decimal' ? 1 : undefined,
    numFmt,
    // Each ordered level must reference its OWN counter token (`%${ilvl+1}`); a
    // static `%1.` would make every nested level reuse level 0's counter.
    lvlText: lvlText(ilvl),
    suff: 'tab',
    lvlJc: 'left',
    indentTwips: {left, hanging: 360},
    ...(numFmt === 'bullet' ? {runProps: {font: 'Symbol'}} : {}),
  }));
}

const numbering: NumberingSpec[] = [
  {numId: MDX_BULLET_NUM_ID, levels: listLevels('bullet', () => '\u2022')},
  {numId: MDX_ORDERED_NUM_ID, levels: listLevels('decimal', (ilvl) => `%${ilvl + 1}.`)},
];

const theme: Theme = {
  bodyParagraph(runs, overrides = {}) {
    return paragraph(MDX_STYLE_BODY, runs, overrides);
  },
  titleHeadingParagraph(runs) {
    return paragraph(MDX_STYLE_HEADING_1, runs);
  },
  sectionHeadingParagraph(runs) {
    return paragraph(MDX_STYLE_HEADING_2, runs);
  },
  subHeadingParagraph(runs) {
    return paragraph(MDX_STYLE_HEADING_3, runs);
  },
  horizontalRule(): BlockSpec[] {
    return [
      paragraph(MDX_STYLE_BODY, [{kind: 'text', text: '____________________________'}], {
        alignment: 'center',
        spacing: {beforeTwips: 120, afterTwips: 120},
      }),
    ];
  },
  renderText,
  fieldRuns,
  listLevel(level, ordered) {
    const ilvl = Math.min(level, listIndents.length - 1);
    return {
      numId: ordered ? MDX_ORDERED_NUM_ID : MDX_BULLET_NUM_ID,
      ilvl,
      continuationIndentTwips: listIndents[ilvl]!,
      itemAfterTwips: 80,
    };
  },
};

export const defaultPreset: Preset = {
  theme,
  styles,
  numbering,
  page: defaultPage,
};
