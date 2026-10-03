import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';

import {
  computeModalBaseline,
  computeParagraphFontBaseline,
  emitFormattingTags,
  mergeAdjacentTags,
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
    caps: false,
    smallCaps: false,
    strike: false,
    emboss: false,
    imprint: false,
    outline: false,
    shadow: false,
    vanish: false,
    underline: false,
    highlightVal: false,
    // What the resolver reports for a run that declares no font or size (#752).
    fontName: null,
    fontSizePt: null,
    colorHex: 'auto',
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

  test(
    'emitFormattingTags attribute-escapes document-derived font metadata',
    async ({ when, then }: AllureBddContext) => {
      let tagged: string;

      await when('a run contains quote-bearing color and font values', () => {
        const runs: AnnotatedRun[] = [
          annotatedRun('X', {
            colorHex: 'FF0000" onmouseover="alert(1)&<>',
            fontName: 'A&B "Display" <Fallback>',
          }),
        ];
        const baseline: FormattingBaseline = {
          bold: false,
          italic: false,
          underline: false,
          suppressed: false,
        };
        const fontBaseline = computeParagraphFontBaseline(runs, { formattingMode: 'full' });

        tagged = emitFormattingTags({
          runs,
          baseline,
          fontBaseline,
          formattingMode: 'full',
        });
      });

      await then('the values remain inside their original attributes', () => {
        expect(tagged).toBe(
          '<font color="FF0000&quot; onmouseover=&quot;alert(1)&amp;&lt;&gt;" ' +
            'face="A&amp;B &quot;Display&quot; &lt;Fallback&gt;">X</font>',
        );
      });
    },
  );

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

  test('unresolved runs form their own modal bucket, so explicitly sized minority runs keep their tags (#752)', async ({ given, when, then }: AllureBddContext) => {
    let fb: FontBaseline;
    let tagged: string;

    await given('a paragraph whose majority runs leave size, font and colour unresolved', async () => {
      // setup is inline
    });

    await when('the font baseline is computed and tags emitted', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Unresolved majority text ', { colorHex: null }),
        annotatedRun('Big', { fontSizePt: 14, fontName: 'Georgia', colorHex: 'FF0000' }),
      ];
      fb = computeParagraphFontBaseline(runs);
      tagged = emitFormattingTags({ runs, baseline: computeModalBaseline(runs), fontBaseline: fb });
    });

    await then('the unresolved bucket is the modal, reported as "no modal", and the minority run is tagged', async () => {
      expect(fb.modalFontSizePt).toBe(0);
      expect(fb.modalFontName).toBe('');
      expect(fb.modalColor).toBeNull();
      expect(fb.fontSizeSuppressed).toBe(true);
      expect(tagged).toBe('Unresolved majority text <font color="FF0000" size="14" face="Georgia">Big</font>');
    });
  });

  test('an unresolved run inside a resolved modal paragraph gets no fabricated size, font or colour (#752)', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('a paragraph sized 12pt in Arial except one run whose size, font and colour are unresolved', async () => {
      // setup is inline
    });

    await when('tags are emitted against the paragraph baseline', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Resolved body text here ', { fontSizePt: 12, fontName: 'Arial', colorHex: '000000' }),
        annotatedRun('odd', { fontSizePt: null, fontName: null, colorHex: null }),
      ];
      tagged = emitFormattingTags({
        runs,
        baseline: computeModalBaseline(runs),
        fontBaseline: computeParagraphFontBaseline(runs),
      });
    });

    await then('no size="0" or empty face is emitted for the unresolved run', async () => {
      expect(tagged).toBe('Resolved body text here odd');
    });
  });

  test('an unresolved b/i/u modal never tags unresolved runs, and resolved deviations still tag (#752)', async ({ given, when, then, and }: AllureBddContext) => {
    let baseline: FormattingBaseline;
    let tagged: string;

    await given('a paragraph whose majority bold/italic/underline are unresolved', async () => {
      // setup is inline
    });

    await when('the modal baseline is computed and tags emitted', async () => {
      const runs: AnnotatedRun[] = [
        annotatedRun('Unresolved majority ', { bold: null, italic: null, underline: null }),
        annotatedRun('Bold', { bold: true, italic: false, underline: false }),
      ];
      baseline = computeModalBaseline(runs);
      tagged = emitFormattingTags({ runs, baseline });
    });

    await then('the baseline keeps the unresolved members as null', async () => {
      expect(baseline).toEqual({ bold: null, italic: null, underline: null, suppressed: true });
    });

    await and('only the resolved bold deviation is tagged', async () => {
      expect(tagged).toBe('Unresolved majority <b>Bold</b>');
    });
  });

  test('explicit no-highlight and unresolved highlight emit no highlight tag (#752)', async ({ given, when, then }: AllureBddContext) => {
    let tagged: string;

    await given('runs with explicit none, unresolved, and a real highlight', async () => {
      // setup is inline
    });

    await when('tags are emitted in full mode', async () => {
      tagged = emitFormattingTags({
        runs: [
          annotatedRun('none ', { highlightVal: false }),
          annotatedRun('unknown ', { highlightVal: null }),
          annotatedRun('lit', { highlightVal: 'yellow' }),
        ],
        baseline: { bold: false, italic: false, underline: false, suppressed: false },
        formattingMode: 'full',
      });
    });

    await then('only the highlighted run carries the tag', async () => {
      expect(tagged).toBe('none unknown <highlight color="yellow">lit</highlight>');
    });
  });

  test('an unresolved member does not change suppression of a resolved one (#752 review)', async ({ given, when, then, and }: AllureBddContext) => {
    let unanimousBold: string;
    let partlyUnknownItalic: string;

    await given('paragraphs whose italic is unresolved in some runs', async () => {
      // setup is inline
    });

    await when('compact tags are emitted against the modal baseline', async () => {
      const boldRuns: AnnotatedRun[] = [
        annotatedRun('aaaaa', { bold: true, italic: false }),
        annotatedRun('bbbbb', { bold: true, italic: null }),
      ];
      unanimousBold = mergeAdjacentTags(emitFormattingTags({ runs: boldRuns, baseline: computeModalBaseline(boldRuns) }));
      const italicRuns: AnnotatedRun[] = [
        annotatedRun('Mostly italic text ', { italic: true }),
        annotatedRun('unknown', { italic: null }),
      ];
      partlyUnknownItalic = emitFormattingTags({ runs: italicRuns, baseline: computeModalBaseline(italicRuns) });
    });

    await then('the unanimous resolved bold stays suppressed, exactly as before #752', async () => {
      expect(unanimousBold).toBe('aaaaabbbbb');
    });

    await and('a member some run leaves unresolved has no known norm, so its resolved values are tagged (pinned tradeoff)', async () => {
      // Before #752 the unresolved run counted as non-italic and the italic
      // majority was suppressed. The norm is not known, so the resolved italic
      // is shown rather than hidden; the unresolved run is never tagged.
      expect(partlyUnknownItalic).toBe('<i>Mostly italic text </i>unknown');
    });
  });
});
