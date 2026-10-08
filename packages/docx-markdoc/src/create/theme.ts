import type { Node as MarkdocNode } from '@markdoc/markdoc';
import type { InlineSpec, NumberingSpec, ParagraphSpec, TableSpec } from '@usejunior/docx-core';
import type { BlockTagPlugin, InlineStyle, InlineTagPlugin, RenderApi, Theme } from '../markdocx/engine.js';
import {
  CREATION_STYLE,
  SIGNATURE_LINE,
  textWidthTwips,
  twipsFromPt,
  type CreationProfile,
} from './profile.js';

type TextRun = Extract<InlineSpec, { kind: 'text' }>;

/** Merge adjacent text runs with identical formatting. */
function coalesce(runs: InlineSpec[]): InlineSpec[] {
  const out: InlineSpec[] = [];
  for (const run of runs) {
    const previous = out.at(-1);
    if (run.kind === 'text' && previous?.kind === 'text'
      && Boolean(previous.bold) === Boolean(run.bold)
      && Boolean(previous.italic) === Boolean(run.italic)
      && previous.highlight === run.highlight) {
      previous.text += run.text;
      continue;
    }
    out.push(run.kind === 'text' ? { ...run } : run);
  }
  return out;
}

function textRun(text: string, style: InlineStyle, highlighted: boolean): TextRun {
  return {
    kind: 'text',
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(highlighted ? { highlight: 'yellow' as const } : {}),
  };
}

/**
 * The house theme for created documents, implementing the engine's Theme seam.
 *
 * Fill-ins: every character from a '[' to its matching ']' is highlighted,
 * nesting allowed and depth carried across bold/italic text nodes within one
 * paragraph. The validator has already proved every paragraph balanced, so
 * the depth simply resets when a paragraph is built. `{% literal %}` and
 * legends switch highlighting off.
 */
export class CreationTheme implements Theme {
  readonly numbering: NumberingSpec[] = [];
  /** Numbering instance for the top-level list being rendered (one per list, so each list restarts). */
  private currentList: { numId: string } | null = null;
  private depth = 0;
  private literalDepth = 0;
  private highlightOff = 0;

  constructor(readonly profile: CreationProfile) {}

  private paragraph(styleId: string, runs: InlineSpec[], overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {}): ParagraphSpec {
    this.depth = 0;
    return { kind: 'paragraph', styleId, runs: coalesce(runs), ...overrides };
  }

  bodyParagraph(runs: InlineSpec[], overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {}): ParagraphSpec {
    if (overrides.list) {
      // List items: the numbering level carries the indent; keep the house spacing (no direct override).
      const { spacing: _spacing, ...rest } = overrides;
      void _spacing;
      return this.paragraph(CREATION_STYLE.list, runs, rest);
    }
    return this.paragraph(CREATION_STYLE.body, runs, overrides);
  }

  titleHeadingParagraph(runs: InlineSpec[]): ParagraphSpec {
    return this.paragraph(CREATION_STYLE.title, runs);
  }

  sectionHeadingParagraph(runs: InlineSpec[]): ParagraphSpec {
    return this.paragraph(CREATION_STYLE.heading1, runs);
  }

  subHeadingParagraph(runs: InlineSpec[]): ParagraphSpec {
    return this.paragraph(CREATION_STYLE.heading2, runs);
  }

  styledParagraph(styleId: string, runs: InlineSpec[], overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {}): ParagraphSpec {
    return this.paragraph(styleId, runs, overrides);
  }

  horizontalRule(): never {
    // The validator rejects thematic breaks before rendering.
    throw new Error('creation grammar has no horizontal rule');
  }

  renderText(text: string, style: InlineStyle): InlineSpec[] {
    if (this.literalDepth > 0 || this.highlightOff > 0) return text ? [textRun(text, style, false)] : [];
    const runs: TextRun[] = [];
    let buffer = '';
    let marked = this.depth > 0;
    for (const char of text) {
      if (char === '[') this.depth += 1;
      const now = this.depth > 0;
      if (now !== marked && buffer) {
        runs.push(textRun(buffer, style, marked));
        buffer = '';
      }
      marked = now;
      buffer += char;
      if (char === ']' && this.depth > 0) this.depth -= 1;
    }
    if (buffer) runs.push(textRun(buffer, style, marked));
    return runs;
  }

  fieldRuns(): never {
    // The validator rejects {% field %}; created documents use bracketed fill-ins.
    throw new Error('creation grammar has no {% field %} tag');
  }

  listLevel(level: number, _ordered: boolean): { numId: string; ilvl: number; continuationIndentTwips: number; itemAfterTwips: number } {
    if (!this.currentList) throw new Error('list rendered outside a top-level list');
    return { numId: this.currentList.numId, ilvl: Math.min(level, 2), continuationIndentTwips: 720 * (level + 1), itemAfterTwips: twipsFromPt(this.profile.spacingAfterPt) };
  }

  /** Allocate the numbering instance for a top-level list: legal 1./(a)/(i) or bullets, starting at its first marker. */
  beginList(list: MarkdocNode): void {
    const ordered = list.attributes.ordered === true;
    const numId = `${ordered ? 'ol' : 'ul'}-${this.numbering.length + 1}`;
    const start = ordered && Number.isInteger(list.attributes.start) ? Number(list.attributes.start) : 1;
    const formats = ordered
      ? ([['decimal', '%1.'], ['lowerLetter', '(%2)'], ['lowerRoman', '(%3)']] as const)
      : ([['bullet', '•'], ['bullet', '◦'], ['bullet', '▪']] as const);
    this.numbering.push({
      numId,
      levels: formats.map(([numFmt, lvlText], ilvl) => ({
        ilvl,
        start: ilvl === 0 ? start : 1,
        numFmt,
        lvlText,
        suff: 'tab' as const,
        indentTwips: { left: 720 * (ilvl + 1), hanging: ordered ? 720 : 360 },
      })),
    });
    this.currentList = { numId };
  }

  withoutHighlight<T>(render: () => T): T {
    this.highlightOff += 1;
    try {
      return render();
    } finally {
      this.highlightOff -= 1;
    }
  }

  withLiteral<T>(render: () => T): T {
    this.literalDepth += 1;
    try {
      return render();
    } finally {
      this.literalDepth -= 1;
    }
  }
}

/** Inline content of a block tag: its paragraphs (block form) or itself (one-line form). */
function contentParagraphs(node: MarkdocNode): MarkdocNode[] {
  return node.children.some((child) => child.type === 'paragraph') ? node.children.filter((child) => child.type === 'paragraph') : [node];
}

function columnWidths(raw: unknown, columns: number, total: number): number[] {
  const parts = typeof raw === 'string' ? raw.split(',').map((part) => Number(part.trim())) : Array.from({ length: columns }, () => 1);
  const sum = parts.reduce((a, b) => a + b, 0);
  const widths = parts.map((part) => Math.floor((part / sum) * total));
  widths[widths.length - 1]! += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/** Block and inline tag plugins for the creation grammar, closed over one theme instance. */
export function creationPlugins(theme: CreationTheme): { blockTags: BlockTagPlugin[]; inlineTags: InlineTagPlugin[] } {
  const signerSegment = (api: RenderApi, value: string): InlineSpec[] =>
    api.renderInlineChildren({ type: 'inline', attributes: {}, children: [{ type: 'text', attributes: { content: value }, children: [] }] } as unknown as MarkdocNode, {});
  const blockTags: BlockTagPlugin[] = [
    {
      tag: 'center',
      renderBlock: (node, api) => contentParagraphs(node).map((paragraph) =>
        theme.styledParagraph(CREATION_STYLE.centered, api.renderInlineChildren(paragraph, {}))),
    },
    {
      tag: 'legend',
      renderBlock: (node, api) => theme.withoutHighlight(() => contentParagraphs(node).map((paragraph) =>
        theme.styledParagraph(CREATION_STYLE.legend, api.renderInlineChildren(paragraph, {})))),
    },
    {
      tag: 'signer',
      renderBlock: (node, api) => {
        const name = String(node.attributes.name);
        const date = node.attributes.date === undefined ? undefined : String(node.attributes.date);
        const runs: InlineSpec[] = [
          { kind: 'text', text: SIGNATURE_LINE },
          { kind: 'break', breakType: 'line' },
          ...signerSegment(api, name),
          ...(date === undefined ? [] : [{ kind: 'tab' } as InlineSpec, ...signerSegment(api, date)]),
        ];
        return [theme.styledParagraph(CREATION_STYLE.signature, runs)];
      },
    },
    {
      tag: 'table',
      renderBlock: (node, api) => {
        const grid = node.children.find((child) => child.type === 'table')!;
        const rows = grid.children.flatMap((group) => group.children.map((row) => ({ header: group.type === 'thead', cells: row.children })));
        const border = { style: 'single' as const, sizeEighthPt: 4, colorHex: '000000' };
        const table: TableSpec = {
          kind: 'table',
          layout: 'fixed',
          columnWidthsTwips: columnWidths(node.attributes.widths, rows[0]!.cells.length, textWidthTwips(theme.profile)),
          borders: { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border },
          rows: rows.map((row) => ({
            ...(row.header ? { header: true } : {}),
            cells: row.cells.map((cell) => {
              const content = cell.children.some((child) => child.type === 'paragraph') ? cell.children.filter((child) => child.type === 'paragraph') : [cell];
              const runs = content.flatMap((paragraph) => api.renderInlineChildren(paragraph, row.header ? { bold: true } : {}));
              return { blocks: [theme.styledParagraph(CREATION_STYLE.table, runs)] };
            }),
          })),
        };
        return [table];
      },
    },
  ];
  const inlineTags: InlineTagPlugin[] = [
    { tag: 'literal', renderInline: (node, api, style) => theme.withLiteral(() => api.renderInlineChildren(node, style)) },
  ];
  return { blockTags, inlineTags };
}
