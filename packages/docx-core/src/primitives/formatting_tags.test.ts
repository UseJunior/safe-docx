import { describe, expect } from 'vitest';
import { testAllure, itAllure } from './testing/allure-test.js';

const test = testAllure;

import {
  computeModalBaseline,
  computeParagraphFontBaseline,
  emitFormattingTags,
  type AnnotatedRun,
  type FormattingBaseline,
  type FontBaseline,
} from './formatting_tags.js';
import type { RunFormatting } from './styles.js';

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
  test('computeModalBaseline chooses char-weighted modal tuple and enables suppression at >= 60%', () => {
    const baseline = computeModalBaseline([
      annotatedRun('Plain text body', {}),
      annotatedRun('Bold', { bold: true }),
    ]);

    expect(baseline).toEqual({
      bold: false,
      italic: false,
      underline: false,
      suppressed: true,
    });
  });

  test('computeModalBaseline tie-breaks by earliest run order', () => {
    const baseline = computeModalBaseline([
      annotatedRun('AA', {}),
      annotatedRun('BB', { bold: true }),
    ]);

    // Equal char weight (2 vs 2) should resolve to the earliest tuple.
    expect(baseline.bold).toBe(false);
    expect(baseline.italic).toBe(false);
    expect(baseline.underline).toBe(false);
  });

  test('emitFormattingTags suppresses baseline b/i/u tags but keeps deviations', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Body ', {}),
      annotatedRun('Bold', { bold: true }),
      annotatedRun(' Tail', {}),
    ];
    const baseline = computeModalBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline });
    expect(tagged).toBe('Body <b>Bold</b> Tail');
  });

  test('emitFormattingTags uses absolute tags when suppression is disabled', () => {
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

    const tagged = emitFormattingTags({ runs, baseline: absoluteBaseline });
    expect(tagged).toContain('<b>AA</b>');
    expect(tagged).toContain('<i>CC</i>');
  });

  test('emitFormattingTags nests hyperlink + b/i/u/highlight in stable order and escapes href', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun(
        'X',
        { bold: true, italic: true, underline: true, highlightVal: 'yellow' },
        { hyperlinkUrl: 'https://example.com/a?x=1&y="2"' },
      ),
    ];

    const tagged = emitFormattingTags({
      runs,
      baseline: { bold: false, italic: false, underline: false, suppressed: false },
    });

    expect(tagged).toBe(
      '<a href="https://example.com/a?x=1&amp;y=&quot;2&quot;"><b><i><u><highlight>X</highlight></u></i></b></a>',
    );
  });

  // ─── Paragraph-local font baselines ────────────────────────────

  test('computeParagraphFontBaseline suppresses uniform color', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Hello ', { colorHex: 'FF0000' }),
      annotatedRun('world', { colorHex: 'FF0000' }),
    ];
    const fb = computeParagraphFontBaseline(runs);
    expect(fb.modalColor).toBe('FF0000');
    expect(fb.colorSuppressed).toBe(true);
  });

  test('computeParagraphFontBaseline detects mixed colors', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Red text. ', { colorHex: 'FF0000' }),
      annotatedRun('BL', { colorHex: '0000FF' }),
    ];
    const fb = computeParagraphFontBaseline(runs);
    expect(fb.modalColor).toBe('FF0000');
    expect(fb.colorSuppressed).toBe(true);
  });

  test('emitFormattingTags emits <font color> for deviating run with fontBaseline', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Normal ', { colorHex: '000000' }),
      annotatedRun('Red', { colorHex: 'FF0000' }),
      annotatedRun(' Normal', { colorHex: '000000' }),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    expect(tagged).toContain('<font color="FF0000">Red</font>');
    expect(tagged).not.toContain('<font color="000000">');
  });

  test('emitFormattingTags emits no <font> tags for uniform paragraph', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('All same color ', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Arial' }),
      annotatedRun('more text', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Arial' }),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    expect(tagged).not.toContain('<font');
    expect(tagged).toBe('All same color more text');
  });

  test('emitFormattingTags emits <font size> for deviating font size', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Normal text ', { fontSizePt: 12 }),
      annotatedRun('Big', { fontSizePt: 18 }),
      annotatedRun(' Normal', { fontSizePt: 12 }),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    expect(tagged).toContain('<font size="18">Big</font>');
  });

  test('emitFormattingTags emits <font face> for deviating font name', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Default text ', { fontName: 'Calibri' }),
      annotatedRun('Serif', { fontName: 'Times New Roman' }),
      annotatedRun(' Default', { fontName: 'Calibri' }),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    expect(tagged).toContain('<font face="Times New Roman">Serif</font>');
  });

  test('emitFormattingTags combines font and BIU tags', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Normal ', {}),
      annotatedRun('Bold Red', { bold: true, colorHex: 'FF0000' }),
      annotatedRun(' Normal', {}),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    // Font tag should be outside of bold per nesting order: <a> → <font> → <b> → <i> → <u> → <highlight>
    expect(tagged).toContain('<font color="FF0000"><b>Bold Red</b></font>');
  });

  test('emitFormattingTags with mixed colors but uniform font emits only color tags', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('Black text. ', { colorHex: '000000', fontSizePt: 12, fontName: 'Calibri' }),
      annotatedRun('Red', { colorHex: 'FF0000', fontSizePt: 12, fontName: 'Calibri' }),
      annotatedRun(' black again.', { colorHex: '000000', fontSizePt: 12, fontName: 'Calibri' }),
    ];
    const baseline: FormattingBaseline = { bold: false, italic: false, underline: false, suppressed: true };
    const fontBaseline = computeParagraphFontBaseline(runs);

    const tagged = emitFormattingTags({ runs, baseline, fontBaseline });
    expect(tagged).toContain('<font color="FF0000">Red</font>');
    expect(tagged).not.toContain('size=');
    expect(tagged).not.toContain('face=');
  });
});

const TEST_FEATURE = 'add-run-level-formatting-visibility';

const humanReadableTest = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE }).allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

describe('formatting_tags — OpenSpec traceability', () => {
  humanReadableTest.openspec('char-weighted modal baseline selects dominant formatting tuple')(
    'char-weighted modal baseline selects dominant formatting tuple',
    () => {
      const runs: AnnotatedRun[] = [
        {
          text: 'AAAAAAAAAA',
          formatting: { bold: true, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
          hyperlinkUrl: null,
          charCount: 10,
          isHeaderRun: false,
        },
        {
          text: 'BBBB',
          formatting: { bold: false, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
          hyperlinkUrl: null,
          charCount: 4,
          isHeaderRun: false,
        },
      ];

      const baseline = computeModalBaseline(runs);

      expect(baseline.bold).toBe(true);
      expect(baseline.italic).toBe(false);
      expect(baseline.underline).toBe(false);
      expect(baseline.suppressed).toBe(true);
    },
  );

  humanReadableTest.openspec('tie-break by earliest run when modal weights are equal')(
    'tie-break by earliest run when modal weights are equal',
    () => {
      const runs: AnnotatedRun[] = [
        {
          text: 'AAAAAA',
          formatting: { bold: true, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
          hyperlinkUrl: null,
          charCount: 6,
          isHeaderRun: false,
        },
        {
          text: 'BBBBBB',
          formatting: { bold: false, italic: false, underline: false, highlightVal: null, fontName: 'Arial', fontSizePt: 12, colorHex: null },
          hyperlinkUrl: null,
          charCount: 6,
          isHeaderRun: false,
        },
      ];

      const baseline = computeModalBaseline(runs);

      expect(baseline.bold).toBe(true);
      expect(baseline.suppressed).toBe(false);
    },
  );
});
