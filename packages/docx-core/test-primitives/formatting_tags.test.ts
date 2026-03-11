import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

import {
  computeModalBaseline,
  computeParagraphFontBaseline,
  emitFormattingTags,
  type AnnotatedRun,
  type FormattingBaseline,
  type FontBaseline,
} from '../src/primitives/formatting_tags.js';
import type { RunFormatting } from '../src/primitives/styles.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Formatting Tags' });

function runFormatting(partial?: Partial<RunFormatting>): RunFormatting {
  return {
    bold: false,
    italic: false,
    underline: false,
    highlightVal: null,
    fontName: '',
    fontSizePt: 0,
    colorHex: null,
    ...(partial ?? {}),
  };
}

function annotatedRun(
  text: string,
  formatting: Partial<RunFormatting> = {},
  opts?: { hyperlinkUrl?: string | null; isHeaderRun?: boolean },
): AnnotatedRun {
  return {
    text,
    formatting: runFormatting(formatting),
    hyperlinkUrl: opts?.hyperlinkUrl ?? null,
    charCount: text.length,
    isHeaderRun: opts?.isHeaderRun ?? false,
  };
}

describe('formatting_tags', () => {
  test('computeModalBaseline chooses char-weighted modal tuple and enables suppression at >= 60%', async ({ given, when, then }: AllureBddContext) => {
    let baseline: ReturnType<typeof computeModalBaseline>;

    await given('runs with 15 plain chars and 4 bold chars', async () => {
      // setup is inline
    });

    await when('computeModalBaseline is called', async () => {
      baseline = computeModalBaseline([
        annotatedRun('Plain text body', {}),
        annotatedRun('Bold', { bold: true }),
      ]);
    });

    await then('baseline matches plain tuple with suppression', async () => {
      expect(baseline).toEqual({
        bold: false,
        italic: false,
        underline: false,
        suppressed: true,
      });
    });
  });

  test('computeModalBaseline tie-breaks by earliest run order', async ({ given, when, then }: AllureBddContext) => {
    let baseline: ReturnType<typeof computeModalBaseline>;

    await given('two runs with equal char weight', async () => {
      // setup is inline
    });

    await when('computeModalBaseline is called', async () => {
      baseline = computeModalBaseline([
        annotatedRun('AA', {}),
        annotatedRun('BB', { bold: true }),
      ]);
    });

    await then('earliest tuple (plain) wins', async () => {
      // Equal char weight (2 vs 2) should resolve to the earliest tuple.
      expect(baseline.bold).toBe(false);
      expect(baseline.italic).toBe(false);
      expect(baseline.underline).toBe(false);
    });
  });

  test('emitFormattingTags suppresses baseline b/i/u tags but keeps deviations', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('runs with body, bold, and tail text', async () => {
      // setup is inline
    });

    await when('emitFormattingTags is called with baseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Body ', {}),
        annotatedRun('Bold', { bold: true }),
        annotatedRun(' Tail', {}),
      ];
      const baseline = computeModalBaseline(runs);
      tagged = emitFormattingTags({ runs, baseline });
    });

    await then('bold deviation is tagged, baseline is not', async () => {
      expect(tagged).toBe('Body <b>Bold</b> Tail');
    });
  });

  test('emitFormattingTags uses absolute tags when suppression is disabled', async ({ given, when, then, and }: AllureBddContext) => {
    let tagged: string;

    await given('runs with bold, plain, and italic text', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with suppression disabled', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('AA', { bold: true }),
        annotatedRun('BB', {}),
        annotatedRun('CC', { italic: true }),
      ];

      // Force absolute mode; otherwise tie + suppression rules would vary by fixture.
      const absoluteBaseline: FormattingBaseline = {
        bold: true,
        italic: false,
        underline: false,
        suppressed: false,
      };

      tagged = emitFormattingTags({ runs, baseline: absoluteBaseline });
    });

    await then('bold run has <b> tags', async () => {
      expect(tagged).toContain('<b>AA</b>');
    });

    await and('italic run has <i> tags', async () => {
      expect(tagged).toContain('<i>CC</i>');
    });
  });

  test('emitFormattingTags nests hyperlink + b/i/u/highlight in stable order and escapes href', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('a run with all formatting and a hyperlink', async () => {
      // setup is inline
    });

    await when('emitFormattingTags is called', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun(
          'X',
          { bold: true, italic: true, underline: true, highlightVal: 'yellow' },
          { hyperlinkUrl: 'https://example.com/a?x=1&y="2"' },
        ),
      ];

      tagged = emitFormattingTags({
        runs,
        baseline: { bold: false, italic: false, underline: false, suppressed: false },
      });
    });

    await then('tags nest in correct order with escaped href', async () => {
      expect(tagged).toBe(
        '<a href="https://example.com/a?x=1&amp;y=&quot;2&quot;"><b><i><u><highlight>X</highlight></u></i></b></a>',
      );
    });
  });

  // --- Paragraph-local font baselines ---

  test('computeParagraphFontBaseline suppresses uniform color', async ({ given, when, then }: AllureBddContext) => {
    let fb: FontBaseline;

    await given('runs with uniform red color', async () => {
      // setup is inline
    });

    await when('computeParagraphFontBaseline is called', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Hello ', { colorHex: 'FF0000' }),
        annotatedRun('world', { colorHex: 'FF0000' }),
      ];
      fb = computeParagraphFontBaseline(runs);
    });

    await then('modal color is FF0000 and suppressed', async () => {
      expect(fb.modalColor).toBe('FF0000');
      expect(fb.colorSuppressed).toBe(true);
    });
  });

  test('computeParagraphFontBaseline detects mixed colors', async ({ given, when, then }: AllureBddContext) => {
    let fb: FontBaseline;

    await given('runs with red and blue colors', async () => {
      // setup is inline
    });

    await when('computeParagraphFontBaseline is called', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Red text. ', { colorHex: 'FF0000' }),
        annotatedRun('BL', { colorHex: '0000FF' }),
      ];
      fb = computeParagraphFontBaseline(runs);
    });

    await then('modal color is FF0000 and suppressed', async () => {
      expect(fb.modalColor).toBe('FF0000');
      expect(fb.colorSuppressed).toBe(true);
    });
  });

  test('emitFormattingTags emits <font color> for deviating run with fontBaseline', async ({ given, when, then, and }: AllureBddContext) => {
    let tagged: string;

    await given('runs with black and red colors', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Normal ', { colorHex: '000000' }),
        annotatedRun('Red', { colorHex: 'FF0000' }),
        annotatedRun(' Normal', { colorHex: '000000' }),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('red run has <font color> tag', async () => {
      expect(tagged).toContain('<font color="FF0000">Red</font>');
    });

    await and('baseline color is not tagged', async () => {
      expect(tagged).not.toContain('<font color="000000">');
    });
  });

  test('emitFormattingTags emits no <font> tags for uniform paragraph', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('runs with uniform color, size, and font', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('All same color ', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Arial' }),
        annotatedRun('more text', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Arial' }),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('no <font> tags are emitted', async () => {
      expect(tagged).not.toContain('<font');
      expect(tagged).toBe('All same color more text');
    });
  });

  test('emitFormattingTags emits <font size> for deviating font size', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('runs with 12pt and 18pt font sizes', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Normal text ', { fontSizePt: 12 }),
        annotatedRun('Big', { fontSizePt: 18 }),
        annotatedRun(' Normal', { fontSizePt: 12 }),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('deviating run has <font size="18"> tag', async () => {
      expect(tagged).toContain('<font size="18">Big</font>');
    });
  });

  test('emitFormattingTags emits <font face> for deviating font name', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('runs with Calibri and Times New Roman fonts', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Default text ', { fontName: 'Calibri' }),
        annotatedRun('Serif', { fontName: 'Times New Roman' }),
        annotatedRun(' Default', { fontName: 'Calibri' }),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('deviating run has <font face> tag', async () => {
      expect(tagged).toContain('<font face="Times New Roman">Serif</font>');
    });
  });

  test('emitFormattingTags combines font and BIU tags', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('a bold red run among plain runs', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Normal ', {}),
        annotatedRun('Bold Red', { bold: true, colorHex: 'FF0000' }),
        annotatedRun(' Normal', {}),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('font tag wraps bold tag per nesting order', async () => {
      // Font tag should be outside of bold per nesting order: <a> -> <font> -> <b> -> <i> -> <u> -> <highlight>
      expect(tagged).toContain('<font color="FF0000"><b>Bold Red</b></font>');
    });
  });

  test('emitFormattingTags with mixed colors but uniform font emits only color tags', async ({ given, when, then, and }: AllureBddContext) => {
    let tagged: string;

    await given('runs with mixed colors but same font', async () => {
      // setup is inline
    });

    await when('emitFormattingTags with fontBaseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Black text. ', { colorHex: '000000', fontSizePt: 12, fontName: 'Calibri' }),
        annotatedRun('Red', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Calibri' }),
        annotatedRun(' black again.', { colorHex: '000000', fontSizePt: 12, fontName: 'Calibri' }),
      ];
      const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
      const fontBaseline = computeParagraphFontBaseline(runs);

      tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    });

    await then('red run has color tag', async () => {
      expect(tagged).toContain('<font color="FF0000">Red</font>');
    });

    await and('no size or face attributes are emitted', async () => {
      expect(tagged).not.toContain('size=');
      expect(tagged).not.toContain('face=');
    });
  });
});
