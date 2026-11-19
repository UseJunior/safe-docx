import Markdoc from '@markdoc/markdoc';
import type { ParagraphSpec } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { itAllure as it } from '../../../docx-core/src/testing/allure-test.js';
import { defaultPreset } from './default-theme.js';
import { createMarkdocxRenderer } from './engine.js';

const kinds = (blocks: ReturnType<ReturnType<typeof createMarkdocxRenderer>['renderBlocks']>) =>
  blocks.map((block) => (block as ParagraphSpec).runs.map((run) => run.kind));

describe('markdocx hard-break option', () => {
  it('keeps hard breaks as spaces by default and renders them as line breaks with hardBreaks: line', () => {
    const source = 'One\\\nTwo\nsoft\n\n- item\\\n  next';
    const ast = Markdoc.parse(source);
    const lenient = createMarkdocxRenderer({ theme: defaultPreset.theme }).renderBlocks([ast], { listDepth: 0 });
    expect(kinds(lenient).flat()).not.toContain('break');
    const lines = createMarkdocxRenderer({ theme: defaultPreset.theme, hardBreaks: 'line' }).renderBlocks([ast], { listDepth: 0 });
    // The paragraph keeps its soft break as a space; the list item's hard break becomes a line break too.
    expect(kinds(lines)).toEqual([['text', 'break', 'text', 'text', 'text'], ['text', 'break', 'text']]);
  });
});
