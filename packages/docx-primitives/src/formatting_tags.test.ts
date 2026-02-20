import { describe, expect } from 'vitest';
import { testAllure as test } from '../test/helpers/allure-test.js';

import {
  computeModalBaseline,
  emitFormattingTags,
  type AnnotatedRun,
  type FormattingBaseline,
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

  test('emitFormattingTags nests hyperlink + b/i/u/highlighting in stable order and escapes href', () => {
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
      '<a href="https://example.com/a?x=1&amp;y=&quot;2&quot;"><b><i><u><highlighting>X</highlighting></u></i></b></a>',
    );
  });

  test('emitFormattingTags interleaves <definition> and strips definition quotes', () => {
    const runs: AnnotatedRun[] = [annotatedRun('"Company" means')];
    const tagged = emitFormattingTags({
      runs,
      baseline: { bold: false, italic: false, underline: false, suppressed: false },
      definitionSpans: [{ start: 0, end: 9, term: 'Company' }],
    });

    expect(tagged).toBe('<definition>Company</definition> means');
  });

  test('emitFormattingTags keeps formatting inside definition without empty tag pairs', () => {
    const runs: AnnotatedRun[] = [
      annotatedRun('"Company"', { bold: true }),
      annotatedRun(' means', {}),
    ];
    const tagged = emitFormattingTags({
      runs,
      baseline: { bold: false, italic: false, underline: false, suppressed: false },
      definitionSpans: [{ start: 0, end: 9, term: 'Company' }],
    });

    expect(tagged).toBe('<definition><b>Company</b></definition> means');
  });
});
