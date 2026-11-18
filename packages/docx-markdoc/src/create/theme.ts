import type { Node as MarkdocNode } from '@markdoc/markdoc';
import { bookmarkNameForSlug, type CrossReferenceNumber, type InlineSpec, type NumberingSpec, type ParagraphSpec, type TableSpec } from '@usejunior/docx-core';
import type { BlockTagPlugin, InlineStyle, InlineTagPlugin, RenderApi, Theme } from '../markdocx/engine.js';
import {
  CREATION_STYLE,
  SIGNATURE_LINE,
  textWidthTwips,
  twipsFromIn,
  twipsFromPt,
  type CreationProfile,
} from './profile.js';
import { runInKeepsWithNext } from './keep-next-rules.js';
import { CreationListNumbering, type HeadingNumberScheme, type RunInLevel } from './list-numbering.js';
import { RUN_IN_TOC_LEVEL, paragraphLayoutValue, type ParagraphLayoutAlignment } from './validate.js';

type TextRun = Extract<InlineSpec, { kind: 'text' }>;
type TableOfContentsEntryRun = Extract<InlineSpec, { kind: 'tableOfContentsEntry' }>;

/** The punctuation that already ends a run-in heading; any other heading takes a period after it. */
const RUN_IN_HEADING_END = /[.:;?!]$/u;

/** The generation number form of each `{% xref number="…" %}` value (`XREF_NUMBERS`). */
const XREF_NUMBER_FORMS: Readonly<Record<string, CrossReferenceNumber>> = { full: 'fullContext', paragraph: 'paragraph', relative: 'relative' };

/** Merge adjacent text runs with identical formatting. */
function coalesce(runs: InlineSpec[]): InlineSpec[] {
  const out: InlineSpec[] = [];
  for (const run of runs) {
    const previous = out.at(-1);
    if (run.kind === 'text' && previous?.kind === 'text'
      && Boolean(previous.bold) === Boolean(run.bold)
      && Boolean(previous.italic) === Boolean(run.italic)
      && previous.underline === run.underline
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
    ...(style.underline ? { underline: style.underline } : {}),
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
  private readonly lists: CreationListNumbering;
  /** Numbering definitions the rendered lists and numbered headings use, for `DocumentSpec.numbering`. */
  get numbering(): readonly NumberingSpec[] {
    return this.lists.definitions;
  }
  /** Numbering instance for the top-level list being rendered, and the level its top items take. */
  private currentList: { numId: string; ilvl: number } | null = null;
  private depth = 0;
  private literalDepth = 0;
  private highlightOff = 0;
  private fillDepth = 0;

  /**
   * @param fillIns 'markup' (default): only {% fill %} content is highlighted
   * and bare brackets are literal. 'brackets': the v0.24 behaviour, where every
   * […] is highlighted.
   * @param headingNumbers frontmatter `heading-numbers`: how `##` and `###`
   * headings are numbered, or undefined for unnumbered headings.
   */
  constructor(readonly profile: CreationProfile, readonly fillIns: 'markup' | 'brackets' = 'markup', headingNumbers?: HeadingNumberScheme) {
    this.lists = new CreationListNumbering(headingNumbers);
  }

  /**
   * Whether the document has a table of contents: headings and run-in
   * articles and sections then carry a TC entry each. Set before rendering.
   */
  tableOfContents = false;
  /**
   * TC entries whose text the lowering prefixes with their paragraph's
   * number once every paragraph is placed ("Section 2.04 Remedies", "2.01
   * Engagement"): the entries of numbered headings and run-in paragraphs.
   */
  readonly numberedEntries = new Set<TableOfContentsEntryRun>();

  private paragraph(styleId: string, runs: InlineSpec[], overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {}): ParagraphSpec {
    this.depth = 0;
    // TC entries trail every other run of their paragraph (docx-core writes them after its bookmark).
    const merged = coalesce(runs);
    const ordered = [...merged.filter((run) => run.kind !== 'tableOfContentsEntry'), ...merged.filter((run) => run.kind === 'tableOfContentsEntry')];
    return { kind: 'paragraph', styleId, runs: ordered, ...overrides };
  }

  /** A TC entry for a heading's text at `level`, when the document has a table of contents; `numbered` entries get their paragraph's number. */
  private headingEntry(runs: InlineSpec[], level: number, numbered: boolean): InlineSpec[] {
    if (!this.tableOfContents) return [];
    const text = runs.map((run) => (run.kind === 'text' ? run.text : '')).join('').trim();
    const entry: TableOfContentsEntryRun = { kind: 'tableOfContentsEntry', text, level };
    if (numbered) this.numberedEntries.add(entry);
    return [entry];
  }

  /**
   * A `{% run-in-paragraph %}`: a body paragraph numbered at its level of
   * the run-in definition, its heading run in after the number (bold for an
   * article, underlined below it) and ended with a period unless it ends in
   * punctuation, then a space and the body text. An article keeps with the
   * next paragraph. Run-in articles and sections list in a table of
   * contents as their number and heading ("2.01 Engagement").
   */
  runInParagraph(level: RunInLevel, headingRuns: InlineSpec[], bodyRuns: InlineSpec[]): ParagraphSpec {
    const list = this.lists.placeRunIn(level);
    const headingText = headingRuns.map((run) => (run.kind === 'text' ? run.text : '')).join('');
    const style = level === 'article' ? { bold: true as const } : { underline: 'single' as const };
    const styled = headingRuns.map((run) => (run.kind === 'text' ? { ...run, ...style } : run));
    const close = headingRuns.length > 0 && !RUN_IN_HEADING_END.test(headingText.trimEnd()) ? [textRun('.', {}, false)] : [];
    const tocLevel = RUN_IN_TOC_LEVEL[level];
    const entry = tocLevel === undefined ? [] : this.headingEntry(headingRuns, tocLevel, true);
    const space = headingRuns.length > 0 && bodyRuns.length > 0 ? [textRun(' ', {}, false)] : [];
    return this.paragraph(CREATION_STYLE.body, [...styled, ...close, ...space, ...bodyRuns, ...entry], { list, ...(runInKeepsWithNext(level) ? { keepNext: true } : {}) });
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

  /** A `##` heading; with heading numbering, its style numbers it ("ARTICLE I"). */
  sectionHeadingParagraph(runs: InlineSpec[]): ParagraphSpec {
    this.lists.placeHeading();
    return this.paragraph(CREATION_STYLE.heading1, [...runs, ...this.headingEntry(runs, 1, this.lists.headingNumId !== undefined)]);
  }

  /** A `###` heading; with heading numbering, its style numbers it ("Section 1.01"). */
  subHeadingParagraph(runs: InlineSpec[]): ParagraphSpec {
    this.lists.placeHeading();
    return this.paragraph(CREATION_STYLE.heading2, [...runs, ...this.headingEntry(runs, 2, this.lists.headingNumId !== undefined)]);
  }

  /**
   * Where a `{% toc /%}` sits: one placeholder paragraph that the lowering
   * replaces with the table of contents once every entry is known.
   */
  tableOfContentsPlaceholder(): ParagraphSpec {
    return this.paragraph(CREATION_STYLE.body, [], { tableOfContents: { opens: { levels: { from: 1, to: 3 } }, closes: true } });
  }

  styledParagraph(styleId: string, runs: InlineSpec[], overrides: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>> = {}): ParagraphSpec {
    return this.paragraph(styleId, runs, overrides);
  }

  horizontalRule(): never {
    // The validator rejects thematic breaks before rendering.
    throw new Error('creation grammar has no horizontal rule');
  }

  renderText(text: string, style: InlineStyle): InlineSpec[] {
    if (!text) return [];
    const countBrackets = this.fillIns === 'brackets' && this.literalDepth === 0 && this.highlightOff === 0;
    if (this.fillDepth > 0) {
      // Raw brackets inside an explicit fill still open and close bracket
      // fill-ins (the validator counts them too), so a bracket fill that
      // crosses the tag boundary ends where its ']' is. The brackets fill()
      // adds are not text and are never counted.
      if (countBrackets) {
        for (const char of text) {
          if (char === '[') this.depth += 1;
          if (char === ']' && this.depth > 0) this.depth -= 1;
        }
      }
      return [textRun(text, style, true)];
    }
    if (!countBrackets) return [textRun(text, style, false)];
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
    return { numId: this.currentList.numId, ilvl: this.currentList.ilvl + Math.min(level, 2), continuationIndentTwips: 720 * (level + 1), itemAfterTwips: twipsFromPt(this.profile.spacingAfterPt) };
  }

  /**
   * Bind a top-level list to its numbering instance: legal 1./(a)/(i),
   * bullets, or the clause levels of the heading definition under a
   * numbered heading. Whether an ordered list continues the previous one or
   * restarts is decided by {@link CreationListNumbering}.
   */
  beginList(list: MarkdocNode): void {
    const ordered = list.attributes.ordered === true;
    const start = ordered && Number.isInteger(list.attributes.start) ? Number(list.attributes.start) : 1;
    const decision = this.lists.placeTopLevelList(ordered, start, list.children.length);
    this.currentList = { numId: decision.numId, ilvl: decision.kind === 'heading-level' ? decision.ilvl : 0 };
  }

  withoutHighlight<T>(render: () => T): T {
    this.highlightOff += 1;
    try {
      return render();
    } finally {
      this.highlightOff -= 1;
    }
  }

  /** Render explicit fill-in markup: the content and the brackets the renderer adds are all highlighted. */
  fill(style: InlineStyle, render: () => InlineSpec[]): InlineSpec[] {
    this.fillDepth += 1;
    try {
      return [textRun('[', style, true), ...render(), textRun(']', style, true)];
    } finally {
      this.fillDepth -= 1;
    }
  }

  /**
   * Render a footnote body as its own story: fill-in, literal and highlight
   * state start fresh inside the note and the surrounding paragraph's state is
   * restored afterwards, so a note never changes how the text around its mark
   * is highlighted.
   */
  footnote<T>(render: () => T): T {
    const saved = { depth: this.depth, literalDepth: this.literalDepth, highlightOff: this.highlightOff, fillDepth: this.fillDepth };
    this.depth = 0;
    this.literalDepth = 0;
    this.highlightOff = 0;
    this.fillDepth = 0;
    try {
      return render();
    } finally {
      ({ depth: this.depth, literalDepth: this.literalDepth, highlightOff: this.highlightOff, fillDepth: this.fillDepth } = saved);
    }
  }

  /** A footnote paragraph: no styleId, so docx-core applies FootnoteText. */
  footnoteParagraph(runs: InlineSpec[]): ParagraphSpec {
    this.depth = 0;
    return { kind: 'paragraph', runs: coalesce(runs) };
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

/**
 * The direct paragraph properties of a `{% paragraph-layout %}`: its alignment, its
 * left and hanging indents in twips, and its keep-with-next and keep-lines flags. Validation has already held each value
 * to its closed list.
 */
export function paragraphLayoutOf(attributes: Record<string, unknown>): Pick<ParagraphSpec, 'alignment' | 'indent' | 'keepNext' | 'keepLines'> {
  const align = paragraphLayoutValue(attributes.align) as ParagraphLayoutAlignment | undefined;
  const left = paragraphLayoutValue(attributes['indent-left']);
  const hanging = paragraphLayoutValue(attributes['indent-hanging']);
  const indent = {
    ...(left === undefined ? {} : { leftTwips: twipsFromIn(Number(left)) }),
    ...(hanging === undefined ? {} : { hangingTwips: twipsFromIn(Number(hanging)) }),
  };
  return {
    ...(align ? { alignment: align } : {}),
    ...(Object.keys(indent).length > 0 ? { indent } : {}),
    ...(attributes['keep-with-next'] === true ? { keepNext: true } : {}),
    ...(attributes['keep-lines'] === true ? { keepLines: true } : {}),
  };
}

function columnWidths(raw: unknown, columns: number, total: number): number[] {
  const parts = typeof raw === 'string' ? raw.split(',').map((part) => Number(part.trim())) : Array.from({ length: columns }, () => 1);
  const sum = parts.reduce((a, b) => a + b, 0);
  const widths = parts.map((part) => Math.floor((part / sum) * total));
  widths[widths.length - 1]! += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/**
 * Block and inline tag plugins for the creation grammar, closed over one theme
 * instance. `footnotes` maps each `{% footnote %}` id to its block, for the
 * `{% fnref /%}` plugin; validation has already paired every id.
 */
export function creationPlugins(
  theme: CreationTheme,
  footnotes: ReadonlyMap<string, MarkdocNode> = new Map(),
): { blockTags: BlockTagPlugin[]; inlineTags: InlineTagPlugin[] } {
  const signerSegment = (api: RenderApi, value: string): InlineSpec[] =>
    api.renderInlineChildren({ type: 'inline', attributes: {}, children: [{ type: 'text', attributes: { content: value }, children: [] }] } as unknown as MarkdocNode, {});
  const blockTags: BlockTagPlugin[] = [
    {
      tag: 'center',
      renderBlock: (node, api) => contentParagraphs(node).map((paragraph) =>
        theme.styledParagraph(CREATION_STYLE.centered, api.renderInlineChildren(paragraph, {}))),
    },
    {
      // A body paragraph with its own alignment and indents (#1424): one
      // paragraph per content paragraph, each with the same layout.
      tag: 'paragraph-layout',
      renderBlock: (node, api) => contentParagraphs(node).map((paragraph) =>
        theme.bodyParagraph(api.renderInlineChildren(paragraph, {}), paragraphLayoutOf(node.attributes))),
    },
    {
      tag: 'legend',
      renderBlock: (node, api) => theme.withoutHighlight(() => contentParagraphs(node).map((paragraph) =>
        theme.styledParagraph(CREATION_STYLE.legend, api.renderInlineChildren(paragraph, {})))),
    },
    {
      tag: 'signer',
      renderBlock: (node, api) => {
        const date = node.attributes.date === undefined ? undefined : String(node.attributes.date);
        // The name is name="…" or the tag's inline content (which may hold {% fill %}).
        const nameRuns = node.attributes.name !== undefined
          ? signerSegment(api, String(node.attributes.name))
          : contentParagraphs(node).flatMap((paragraph) => api.renderInlineChildren(paragraph, {}));
        const runs: InlineSpec[] = [
          { kind: 'text', text: SIGNATURE_LINE },
          { kind: 'break', breakType: 'line' },
          ...nameRuns,
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
  blockTags.push(
    {
      tag: 'run-in-paragraph',
      renderBlock: (node, api) => {
        const heading = node.attributes.heading === undefined ? [] : signerSegment(api, String(node.attributes.heading));
        const body = node.children.length === 0 ? [] : contentParagraphs(node).flatMap((paragraph) => api.renderInlineChildren(paragraph, {}));
        return [theme.runInParagraph(node.attributes.level as RunInLevel, heading, body)];
      },
    },
    { tag: 'toc', renderBlock: () => [theme.tableOfContentsPlaceholder()] },
  );
  const inlineTags: InlineTagPlugin[] = [
    {
      // The content shows where it sits; a TC entry with its text trails the paragraph.
      tag: 'tc',
      renderInline: (node, api, style) => {
        const runs = api.renderInlineChildren(node, style);
        const text = runs.map((run) => (run.kind === 'text' ? run.text : '')).join('').trim();
        return [...runs, { kind: 'tableOfContentsEntry', text, level: Number(node.attributes.level) }];
      },
    },
    { tag: 'literal', renderInline: (node, api, style) => theme.withLiteral(() => api.renderInlineChildren(node, style)) },
    { tag: 'fill', renderInline: (node, api, style) => theme.fill(style, () => api.renderInlineChildren(node, style)) },
    {
      // The mark carries no run formatting of its own: it takes the
      // FootnoteReference style whatever bold or underline surrounds it.
      tag: 'fnref',
      renderInline: (node, api) => {
        const body = footnotes.get(String(node.attributes.id));
        if (!body) throw new Error(`footnote id="${String(node.attributes.id)}" reached rendering without a body`);
        const blocks = theme.footnote(() => contentParagraphs(body).map((paragraph) =>
          theme.footnoteParagraph(api.renderInlineChildren(paragraph, {}))));
        return [{ kind: 'footnote', blocks }];
      },
    },
    {
      // A REF field to the target's bookmark; docx-core sets its cached
      // result: the target's number (with number="relative", relative to
      // where the field sits), or with show="text" its text runs.
      // "Section " is plain text before the field, so updating the field
      // never removes it. A text reference carries no formatting of its own:
      // Word writes its result with the target's formatting (validation
      // refuses emphasis around one; a bold table header row does not bold it).
      tag: 'xref',
      renderInline: (node, _api, style) => {
        const bookmark = bookmarkNameForSlug(String(node.attributes.to));
        if (node.attributes.show === 'text') return [{ kind: 'crossReference', bookmark, show: 'text' }];
        const formatting = {
          ...(style.bold ? { bold: true } : {}),
          ...(style.italic ? { italic: true } : {}),
          ...(style.underline ? { underline: style.underline } : {}),
        };
        return [
          ...(node.attributes.format === 'section' ? theme.renderText('Section ', style) : []),
          { kind: 'crossReference', bookmark, number: XREF_NUMBER_FORMS[String(node.attributes.number ?? 'full')] ?? 'fullContext', ...formatting },
        ];
      },
    },
  ];
  return { blockTags, inlineTags };
}
