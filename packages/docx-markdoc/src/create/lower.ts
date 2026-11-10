import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import { bookmarkNameForSlug, type BlockSpec, type DocumentSpec, type HeaderFooterSpec, type InlineSpec, type NumberingSpec, type ParagraphSpec, type SectionSpec } from '@usejunior/docx-core';
import { createMarkdocxRenderer, type RenderApi } from '../markdocx/engine.js';
import {
  CREATION_STYLE,
  FIRST_SIGNER_BEFORE_PT,
  PAGE_HEIGHT_TWIPS,
  PAGE_WIDTH_TWIPS,
  creationDefaults,
  creationStyles,
  resolveCreationProfile,
  textWidthTwips,
  twipsFromIn,
  twipsFromPt,
  type CreationProfile,
} from './profile.js';
import { HEADING_CLAUSE_ILVL } from './list-numbering.js';
import { CreationTheme, creationPlugins } from './theme.js';
import {
  FIRST_PAGE_NONE,
  checkCreationSourceCharacters,
  creationError,
  lineOf,
  parseCreationFrontmatter,
  soleInlineTag,
  validateCreationAst,
  type CreationFrontmatter,
  type FooterLayout,
  type PageNumberFormat,
  type RunningTextAlignment,
} from './validate.js';

export { parseCreationFrontmatter, type CreationFrontmatter } from './validate.js';

/** Fixed core-property date when the source declares none: builds never read the clock. */
export const CREATION_EPOCH_ISO = '2006-01-01T00:00:00Z';
/** Read-back token for a PAGE field. */
export const PAGE_FIELD_TOKEN = '<PAGE>';
/** Read-back token for a NUMPAGES field (the total page count). */
export const NUMPAGES_FIELD_TOKEN = '<NUMPAGES>';

/**
 * Footer (or header) per section: its paragraph texts when the section
 * declares its own, or null when it has no reference (the first section then
 * has none; later sections inherit the previous one, as in Word).
 */
export type FooterProjection = string[] | null;

/**
 * Per section: null when the section shows its header and footer on its
 * first page too. With `header-first` or `footer-first` in effect, the
 * section has `w:titlePg`, and this holds its first-page header and footer
 * texts (null for a slot without a reference).
 */
export type FirstPageProjection = { header: FooterProjection; footer: FooterProjection } | null;

/** Where a footnote reference sits: its body paragraph (index into `paragraphs`) and character offset. */
export type FootnoteReferencePosition = { paragraph: number; offset: number };

/**
 * Plain-text projection of the lowered document, compared against read-back
 * from the DOCX bytes. A footnote reference adds no text to its paragraph;
 * `footnoteReferences` records where each one sits, in document order, and
 * `footnotes` holds the matching notes' paragraph texts, the first starting
 * with the space between the note number and its text.
 */
export type CreationProjection = {
  paragraphs: string[];
  footers: FooterProjection[];
  headers: FooterProjection[];
  firstPage: FirstPageProjection[];
  footnoteReferences: FootnoteReferencePosition[];
  footnotes: string[][];
};

/** The space docx-core writes between a note's number and its text. */
export const FOOTNOTE_MARK_SPACE = ' ';

export type CreationBlockKind =
  | 'title' | 'heading' | 'body' | 'quote' | 'centered' | 'legend' | 'signer' | 'list' | 'table';

export type CreationLowering = {
  spec: DocumentSpec;
  projection: CreationProjection;
  frontmatter: CreationFrontmatter;
  profile: CreationProfile;
  blocks: Array<{ kind: CreationBlockKind; line?: number; section: number }>;
  /**
   * Parallel to `projection.paragraphs`: the index into the parsed source's
   * top-level nodes (`Markdoc.parse(source).children`) of the block each
   * paragraph came from, or -1 for a paragraph generation adds (the empty
   * paragraph after a section-ending table). `pull` maps read-back
   * paragraphs back to the source through it. Not part of the certificate.
   */
  paragraphEntries: number[];
};

type FooterDeclaration = {
  text?: string;
  pageNumbers?: boolean;
  align?: RunningTextAlignment;
  italic?: boolean;
  numberAlign?: RunningTextAlignment;
  numberFormat?: PageNumberFormat;
  layout?: FooterLayout;
  /** The first page's footer text in place of `text`, or `none`; absent, the first page shows this footer. */
  first?: string;
};
/** A declared header: its text, or none for an empty header (`header=false`); `first` as for a footer. */
type HeaderDeclaration = { text?: string; align?: RunningTextAlignment; first?: string };
type Entry = { kind: CreationBlockKind; line?: number; blocks: BlockSpec[]; pageBreakBefore: boolean; node: number };
type SectionState = { entries: Entry[]; footer?: FooterDeclaration; header?: HeaderDeclaration };

/**
 * A soft break (an ordinary line wrap in the source) reads as one space. Turn
 * it into a text node before rendering so it flows through the theme like any
 * other text; inside a fill-in that space is highlighted too. The engine's own
 * lenient handling of soft breaks is left untouched for other consumers.
 */
function normalizeSoftBreaks(node: MarkdocNode): void {
  node.children = node.children.map((child) => (child.type === 'softbreak' ? new Markdoc.Ast.Node('text', { content: ' ' }) : child));
  node.children.forEach(normalizeSoftBreaks);
}

function kindOf(node: MarkdocNode): CreationBlockKind {
  if (node.type === 'heading') return node.attributes.level === 1 ? 'title' : 'heading';
  if (node.type === 'blockquote') return 'quote';
  if (node.type === 'list') return 'list';
  const tag = node.type === 'tag' ? node : soleInlineTag(node);
  switch (tag?.tag) {
    case 'center': return 'centered';
    case 'legend': return 'legend';
    case 'signer': return 'signer';
    case 'table': return 'table';
    default: return 'body';
  }
}

function paragraphsOf(blocks: BlockSpec[]): ParagraphSpec[] {
  return blocks.filter((block): block is ParagraphSpec => block.kind === 'paragraph');
}

/**
 * What a cross-reference to a bookmark shows: its number in each form (for a
 * numbered target) and its text (for every target). A numbered target also
 * has its list (`numId`), the value of each of its levels, and the parts of
 * its full number with the level each stands for, so a relative number can
 * drop the leading parts it shares with where the reference sits.
 */
type ReferenceText = {
  full?: string;
  paragraph?: string;
  text: string;
  numId?: string;
  values?: number[];
  parts?: Array<{ level: number; text: string }>;
};
/**
 * Every bookmark's reference texts, and for each paragraph holding a
 * relative reference the values of each list's (`numId`'s) last numbered
 * paragraph at or before it.
 */
type ReferenceTexts = { texts: ReadonlyMap<string, ReferenceText>; positions: ReadonlyMap<ParagraphSpec, ReadonlyMap<string, readonly number[]>> };
const NO_REFERENCES: ReferenceTexts = { texts: new Map(), positions: new Map() };

/**
 * A relative number as Word shows it (`\r`): the full number less the
 * leading levels the target shares with its list's last paragraph at or
 * before the reference, always keeping the target's own level; the full
 * number when its list has no paragraph there yet, and in a footnote.
 */
function relativeText(target: ReferenceText, position: ReadonlyMap<string, readonly number[]> | undefined): string | undefined {
  const at = target.numId === undefined ? undefined : position?.get(target.numId);
  if (!at || !target.values || !target.parts) return target.full;
  const own = target.values.length - 1;
  let shared = 0;
  while (shared < Math.min(at.length, own + 1) && at[shared] === target.values[shared]) shared += 1;
  return target.parts.filter((part) => part.level >= Math.min(shared, own)).map((part) => part.text).join('');
}

/** `position` is the list positions at the paragraph holding `runs`: absent in a footnote. */
function runText(runs: InlineSpec[], references: ReferenceTexts = NO_REFERENCES, position?: ReadonlyMap<string, readonly number[]>): string {
  return runs.map((run) => {
    if (run.kind === 'text') return run.text;
    if (run.kind === 'tab') return '\t';
    if (run.kind === 'break') return '\n';
    if (run.kind === 'footnote') return '';
    if (run.kind === 'crossReference') {
      const target = references.texts.get(run.bookmark);
      const shown = run.show === 'text' ? target?.text
        : run.number === 'paragraph' ? target?.paragraph
        : run.number === 'relative' ? (target ? relativeText(target, position) : undefined)
        : target?.full;
      if (shown === undefined) throw new Error(`cross-reference to '${run.bookmark}' has no ${run.show === 'text' ? 'target' : 'numbered target'} in the lowering`);
      return shown;
    }
    return run.field === 'NUMPAGES' ? NUMPAGES_FIELD_TOKEN : PAGE_FIELD_TOKEN;
  }).join('');
}

function letters(n: number): string {
  return String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) { out += symbol; n -= value; }
  }
  return out;
}

/**
 * What a cross-reference to a paragraph of the heading definition shows:
 * "ARTICLE II", "Section 2.06", and a clause in full as "Section 2.06(b)(ii)",
 * or as "ARTICLE II(b)" when no Section has been numbered under the Article
 * since it began (Word passes over a level shown at its start value). The
 * paragraph form of a heading is its whole label; of a clause, its own "(b)".
 */
function headingReferenceText(values: readonly number[], ilvl: number, sectionNumbered: boolean): { full: string; paragraph: string; parts: Array<{ level: number; text: string }> } {
  const own = [
    `ARTICLE ${roman(values[0]!).toUpperCase()}`,
    `Section ${values[0]}.${String(values[1]).padStart(2, '0')}`,
    `(${letters(values[2]!)})`,
    `(${roman(values[3]!)})`,
    `(${letters(values[4]!).toUpperCase()})`,
  ];
  if (ilvl < HEADING_CLAUSE_ILVL) return { full: own[ilvl]!, paragraph: own[ilvl]!, parts: [{ level: ilvl, text: own[ilvl]! }] };
  const context = sectionNumbered ? 1 : 0;
  const parts = [{ level: context, text: own[context]! }, ...own.slice(HEADING_CLAUSE_ILVL, ilvl + 1).map((text, index) => ({ level: HEADING_CLAUSE_ILVL + index, text }))];
  return { full: parts.map((part) => part.text).join(''), paragraph: own[ilvl]!, parts };
}

/**
 * What each bookmarked paragraph's cross-references show: its text runs, and for a numbered paragraph its number, counted
 * from the lowering's own lists and numbered headings. Each ordered list
 * numbers `1.`, `(a)`, `(i)` and restarts deeper levels under a new item.
 * Word shows the full number as "2", "2(b)", "2(b)(ii)" (the period before
 * "(" dropped) and the paragraph number as "2", "(b)", "(ii)". Numbered
 * headings and the clauses under them follow {@link headingReferenceText}.
 * docx-core computes the cached result from the OOXML; read-back compares
 * the two.
 *
 * Counting follows Word's list model, as the numbering decisions in
 * `list-numbering.ts` rely on: every instance of one definition shares a
 * running count, and an instance's `startOverride` restarts it at that
 * instance's first paragraph on the level. A heading is numbered through its
 * paragraph style's link to a level (`w:pStyle`), so it counts on that level
 * although it carries no `list` of its own.
 */
function referenceTexts(sections: SectionSpec[], numbering: readonly NumberingSpec[]): ReferenceTexts {
  const instances = new Map<string, { definition: NumberingSpec; overrides: ReadonlyMap<number, number> }>();
  const styleLinks = new Map<string, { numId: string; ilvl: number }>();
  for (const definition of numbering) {
    instances.set(definition.numId, { definition, overrides: new Map() });
    for (const instance of definition.instances ?? []) {
      instances.set(instance.numId, { definition, overrides: new Map(instance.levelOverrides.map((override) => [override.ilvl, override.startOverride])) });
    }
    for (const level of definition.levels) if (level.pStyle) styleLinks.set(level.pStyle, { numId: definition.numId, ilvl: level.ilvl });
  }
  const counters = new Map<string, number[]>();
  const usedLevels = new Map<string, Set<number>>();
  // Per heading definition: whether a Section has been numbered since the current Article began.
  const sectionSinceArticle = new Map<string, boolean>();
  const texts = new Map<string, ReferenceText>();
  // Each list's (numId's) last numbered paragraph so far, and the copy each paragraph holding a relative reference sees.
  const lists = new Map<string, number[]>();
  const positions = new Map<ParagraphSpec, ReadonlyMap<string, readonly number[]>>();
  const visit = (blocks: BlockSpec[]) => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
        continue;
      }
      const relative = block.runs.some((run) => run.kind === 'crossReference' && run.number === 'relative');
      // A text reference shows the paragraph's text runs; the list label and
      // any footnote reference mark are not part of it.
      if (block.bookmark !== undefined) texts.set(block.bookmark, { text: runText(block.runs.filter((run) => run.kind === 'text')) });
      const list = block.list ?? (block.styleId === undefined ? undefined : styleLinks.get(block.styleId));
      if (!list) {
        if (relative) positions.set(block, new Map(lists));
        continue;
      }
      const { numId, ilvl } = list;
      const { definition, overrides } = instances.get(numId)!;
      const { levels } = definition;
      const values = counters.get(definition.numId) ?? [];
      const used = usedLevels.get(numId) ?? new Set<number>();
      const override = overrides.get(ilvl);
      if (override !== undefined && !used.has(ilvl)) values[ilvl] = override - 1;
      used.add(ilvl);
      usedLevels.set(numId, used);
      values[ilvl] = (values[ilvl] ?? (levels[ilvl]!.start ?? 1) - 1) + 1;
      values.length = ilvl + 1;
      counters.set(definition.numId, values);
      lists.set(numId, [...values]);
      if (relative) positions.set(block, new Map(lists));
      if (ilvl < HEADING_CLAUSE_ILVL) sectionSinceArticle.set(definition.numId, ilvl === 1);
      if (block.bookmark === undefined) continue;
      const place = { numId, values: [...values] };
      if (levels[0]!.pStyle !== undefined) {
        texts.set(block.bookmark, { ...texts.get(block.bookmark)!, ...place, ...headingReferenceText(values, ilvl, sectionSinceArticle.get(definition.numId) === true) });
        continue;
      }
      if (levels[0]!.numFmt !== 'decimal') continue;
      const own = [String(values[0]), `(${letters(values[1]!)})`, `(${roman(values[2]!)})`];
      const parts = own.slice(0, ilvl + 1).map((text, level) => ({ level, text }));
      texts.set(block.bookmark, { ...texts.get(block.bookmark)!, ...place, parts, full: own.slice(0, ilvl + 1).join(''), paragraph: own[ilvl]! });
    }
  };
  for (const section of sections) visit(section.blocks);
  return { texts, positions };
}

/** Drop the space a trailing `{% #id %}` annotation leaves at the end of its heading or list item text. */
function trimAnnotationSpace(node: MarkdocNode): void {
  if (node.attributes.id !== undefined && (node.type === 'heading' || node.type === 'item')) {
    const inline = node.children.find((child) => child.type === 'inline' || child.type === 'paragraph');
    const holder = inline?.type === 'paragraph' ? inline.children.find((child) => child.type === 'inline') : inline;
    const last = holder?.children.at(-1);
    if (last?.type === 'text') last.attributes.content = String(last.attributes.content ?? '').replace(/\s+$/u, '');
  }
  node.children.forEach(trimAnnotationSpace);
}

/** Every list item under `list`, depth first: the order in which its paragraphs are rendered. */
function listItems(list: MarkdocNode): MarkdocNode[] {
  return list.children.flatMap((item) => [item, ...item.children.filter((child) => child.type === 'list').flatMap(listItems)]);
}

/** Put each `{% #id %}` on the paragraph its heading or list item rendered to, as a bookmark. */
function bookmarkTargets(node: MarkdocNode, blocks: BlockSpec[]): void {
  const mark = (target: MarkdocNode, block: BlockSpec | undefined) => {
    if (target.attributes.id === undefined) return;
    if (block?.kind !== 'paragraph') throw new Error(`id '${String(target.attributes.id)}' did not render to a paragraph`);
    block.bookmark = bookmarkNameForSlug(String(target.attributes.id));
  };
  if (node.type === 'heading') mark(node, blocks[0]);
  if (node.type === 'list') {
    const items = listItems(node);
    if (items.length !== blocks.length) throw new Error('a list did not render one paragraph per item');
    items.forEach((item, index) => mark(item, blocks[index]));
  }
}

type BlockProjection = Pick<CreationProjection, 'paragraphs' | 'footnoteReferences' | 'footnotes'>;

/**
 * Body paragraphs in document order, table cells included, as read-back must
 * find them, with each footnote reference's position and its note's text.
 */
function projectBlocks(blocks: BlockSpec[], out: BlockProjection = { paragraphs: [], footnoteReferences: [], footnotes: [] }, references: ReferenceTexts = NO_REFERENCES): BlockProjection {
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) for (const cell of row.cells) projectBlocks(cell.blocks, out, references);
      continue;
    }
    const position = references.positions.get(block);
    let offset = 0;
    for (const run of block.runs) {
      if (run.kind === 'footnote') {
        out.footnoteReferences.push({ paragraph: out.paragraphs.length, offset });
        // A footnote has no list position: a relative reference in it shows the full number.
        out.footnotes.push(run.blocks.map((paragraph, index) => (index === 0 ? FOOTNOTE_MARK_SPACE : '') + runText(paragraph.runs, references)));
      }
      offset += runText([run], references, position).length;
    }
    out.paragraphs.push(runText(block.runs, references, position));
  }
  return out;
}

/** The runs of a page number in `format`: "1", "- 1 -" or "Page 1 of 3". */
function pageNumberRuns(format: PageNumberFormat = 'plain'): InlineSpec[] {
  const page: InlineSpec = { kind: 'field', field: 'PAGE', cachedResult: '1' };
  if (format === 'dashed') return [{ kind: 'text', text: '- ' }, page, { kind: 'text', text: ' -' }];
  if (format === 'page-of-total') return [{ kind: 'text', text: 'Page ' }, page, { kind: 'text', text: ' of ' }, { kind: 'field', field: 'NUMPAGES', cachedResult: '1' }];
  return [page];
}

/** A page number in `format` as read back: its fields as tokens. */
function pageNumberText(format: PageNumberFormat = 'plain'): string {
  if (format === 'dashed') return `- ${PAGE_FIELD_TOKEN} -`;
  if (format === 'page-of-total') return `Page ${PAGE_FIELD_TOKEN} of ${NUMPAGES_FIELD_TOKEN}`;
  return PAGE_FIELD_TOKEN;
}

function footerSpec(footer: FooterDeclaration, profile: CreationProfile): HeaderFooterSpec {
  // A declared footer with neither text nor page numbers is an unlinked, empty footer.
  if (!footer.text && !footer.pageNumbers) return { blocks: [{ kind: 'paragraph', styleId: CREATION_STYLE.footer, runs: [] }] };
  const text: InlineSpec[] = footer.text ? [{ kind: 'text', text: footer.text, ...(footer.italic === false ? {} : { italic: true }) }] : [];
  if (footer.layout === 'one-line') {
    // The text at the left margin, then a right tab stop at the right margin for the number.
    return {
      blocks: [{
        kind: 'paragraph',
        styleId: CREATION_STYLE.footer,
        alignment: 'left',
        tabs: [{ posTwips: textWidthTwips(profile), align: 'right' }],
        runs: [...text, { kind: 'tab' }, ...pageNumberRuns(footer.numberFormat)],
      }],
    };
  }
  const blocks: ParagraphSpec[] = [];
  if (footer.text) blocks.push({ kind: 'paragraph', styleId: CREATION_STYLE.footer, ...(footer.align ? { alignment: footer.align } : {}), runs: text });
  if (footer.pageNumbers) blocks.push({ kind: 'paragraph', styleId: CREATION_STYLE.footer, ...(footer.numberAlign ? { alignment: footer.numberAlign } : {}), runs: pageNumberRuns(footer.numberFormat) });
  return { blocks };
}

/** A footer's paragraphs as read back. */
function footerLines(footer: FooterDeclaration): string[] {
  if (!footer.text && !footer.pageNumbers) return [''];
  if (footer.layout === 'one-line') return [`${footer.text}\t${pageNumberText(footer.numberFormat)}`];
  return [...(footer.text ? [footer.text] : []), ...(footer.pageNumbers ? [pageNumberText(footer.numberFormat)] : [])];
}

/** One header paragraph, aligned as declared (centred by default); an empty header has no text. */
function headerSpec(header: HeaderDeclaration): HeaderFooterSpec {
  return {
    blocks: [{
      kind: 'paragraph',
      styleId: CREATION_STYLE.header,
      ...(header.text ? { alignment: header.align ?? 'center' } : {}),
      runs: header.text ? [{ kind: 'text', text: header.text }] : [],
    }],
  };
}

/**
 * The footer a section's first page shows: its `first` text in place of its
 * own (laid out the same, with the page number when it has one), an empty
 * footer for `none`, or the footer itself.
 */
function firstPageFooter(footer: FooterDeclaration): FooterDeclaration {
  if (footer.first === undefined) return footer;
  if (footer.first === FIRST_PAGE_NONE) return {};
  return { ...footer, text: footer.first };
}

/** The header a section's first page shows: its `first` text, aligned like the header, none, or the header itself. */
function firstPageHeader(header: HeaderDeclaration): HeaderDeclaration {
  if (header.first === undefined) return header;
  if (header.first === FIRST_PAGE_NONE) return {};
  return { ...header, text: header.first };
}

/** The footer declared by the frontmatter, for the first section. */
function frontmatterFooter(frontmatter: CreationFrontmatter): FooterDeclaration | undefined {
  // First-page text alone declares a footer that is empty on the other pages.
  if (!frontmatter.footer && !frontmatter.pageNumbers && !frontmatter.footerFirst) return undefined;
  return {
    ...(frontmatter.footer ? { text: frontmatter.footer } : {}),
    ...(frontmatter.pageNumbers ? { pageNumbers: true } : {}),
    ...(frontmatter.footerAlign ? { align: frontmatter.footerAlign } : {}),
    ...(frontmatter.footerItalic === undefined ? {} : { italic: frontmatter.footerItalic }),
    ...(frontmatter.pageNumberAlign ? { numberAlign: frontmatter.pageNumberAlign } : {}),
    ...(frontmatter.pageNumberFormat ? { numberFormat: frontmatter.pageNumberFormat } : {}),
    ...(frontmatter.footerLayout ? { layout: frontmatter.footerLayout } : {}),
    ...(frontmatter.footerFirst ? { first: frontmatter.footerFirst } : {}),
  };
}

/** The footer a `{% section %}` declares, or undefined when it declares none (it then inherits). */
function sectionFooter(attributes: Record<string, unknown>): FooterDeclaration | undefined {
  const footer = attributes.footer as string | undefined;
  const pageNumbers = attributes['page-numbers'] as boolean | undefined;
  // Any footer attribute, including an explicit page-numbers=false, unlinks the footer; none inherits.
  // The attributes that shape the footer need footer text or page numbers beside them (validation).
  // First-page text alone declares a footer that is empty on the other pages.
  if (footer === undefined && pageNumbers === undefined && attributes['footer-first'] === undefined) return undefined;
  const word = <T>(key: string) => attributes[key] as T | undefined;
  return {
    ...(footer ? { text: footer } : {}),
    ...(pageNumbers ? { pageNumbers: true } : {}),
    ...(word<RunningTextAlignment>('footer-align') ? { align: word<RunningTextAlignment>('footer-align')! } : {}),
    ...(word<boolean>('footer-italic') === undefined ? {} : { italic: word<boolean>('footer-italic')! }),
    ...(word<RunningTextAlignment>('page-number-align') ? { numberAlign: word<RunningTextAlignment>('page-number-align')! } : {}),
    ...(word<PageNumberFormat>('page-number-format') ? { numberFormat: word<PageNumberFormat>('page-number-format')! } : {}),
    ...(word<FooterLayout>('footer-layout') ? { layout: word<FooterLayout>('footer-layout')! } : {}),
    ...(word<string>('footer-first') ? { first: word<string>('footer-first')! } : {}),
  };
}

/** The header a `{% section %}` declares: header="…" or header=false; undefined inherits. */
function sectionHeader(attributes: Record<string, unknown>): HeaderDeclaration | undefined {
  const header = attributes.header as string | false | undefined;
  // First-page text alone declares a header that is empty on the other pages.
  if (header === undefined && attributes['header-first'] === undefined) return undefined;
  const align = attributes['header-align'] as RunningTextAlignment | undefined;
  const first = attributes['header-first'] as string | undefined;
  return { ...(typeof header === 'string' ? { text: header } : {}), ...(align ? { align } : {}), ...(first ? { first } : {}) };
}

/** Signer, legend, table and page-break rules that relate a block to its neighbours. */
function applyNeighbourRules(section: SectionState, profile: CreationProfile): void {
  section.entries.forEach((entry, index) => {
    const previous = section.entries[index - 1];
    const previousLast = previous ? paragraphsOf(previous.blocks).at(-1) : undefined;
    const first = entry.blocks[0];
    if (entry.pageBreakBefore) {
      if (first?.kind !== 'paragraph') creationError('PAGE_BREAK_BEFORE_TABLE', '{% page-break /%} cannot precede a table; put a paragraph first.', undefined, entry.line);
      first.pageBreakBefore = true;
    }
    if (entry.kind === 'signer' && previous?.kind !== 'signer') {
      if (first?.kind === 'paragraph') first.spacing = { ...first.spacing, beforeTwips: twipsFromPt(FIRST_SIGNER_BEFORE_PT) };
      if (previousLast && previous?.blocks.at(-1) === previousLast) previousLast.keepNext = true;
    }
    if (entry.kind === 'legend' && previousLast && previous?.blocks.at(-1) === previousLast) previousLast.keepNext = true;
    // A table ends without paragraph spacing; the next paragraph takes the house after-spacing above it.
    if (previous?.blocks.at(-1)?.kind === 'table' && first?.kind === 'paragraph' && first.spacing?.beforeTwips === undefined) {
      first.spacing = { ...first.spacing, beforeTwips: twipsFromPt(profile.spacingAfterPt) };
    }
  });
}

/**
 * Lower creation Markdoc to a docx-core DocumentSpec through the generic
 * markdocx engine: the closed grammar is validated first, the creation theme
 * and tag plugins render each top-level block, and this driver adds what the
 * engine leaves to its consumers (sections, page breaks and neighbour rules).
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1162
 */
export function lowerCreationMarkdoc(source: string, profileInput?: unknown): CreationLowering {
  const profile = resolveCreationProfile(profileInput);
  checkCreationSourceCharacters(source);
  const ast = Markdoc.parse(source);
  const frontmatter = parseCreationFrontmatter(ast.attributes.frontmatter as string | undefined);
  validateCreationAst(ast.children, { fillIns: frontmatter.fillIns ?? 'markup', ...(frontmatter.headingNumbers ? { headingNumbers: frontmatter.headingNumbers } : {}) });
  normalizeSoftBreaks(ast);
  trimAnnotationSpace(ast);

  // Footnote bodies render where their {% fnref /%} sits; the blocks
  // themselves add nothing to the body. Validation paired every id.
  const footnoteBodies = new Map<string, MarkdocNode>();
  for (const node of ast.children) {
    const tag = node.type === 'tag' ? node : soleInlineTag(node);
    if (tag?.tag === 'footnote') footnoteBodies.set(String(tag.attributes.id), tag);
  }

  const theme = new CreationTheme(profile, frontmatter.fillIns ?? 'markup', frontmatter.headingNumbers);
  const plugins = creationPlugins(theme, footnoteBodies);
  let api!: RenderApi;
  api = createMarkdocxRenderer({
    theme,
    ...plugins,
    hardBreaks: 'line',
    transformBlock: (node, state) => {
      if (node.type === 'list') theme.beginList(node);
      if (node.type === 'blockquote') {
        return node.children.map((child) => theme.styledParagraph(CREATION_STYLE.quote, api.renderInlineChildren(child, {})));
      }
      const tag = soleInlineTag(node);
      if (tag) return plugins.blockTags.find((plugin) => plugin.tag === tag.tag)!.renderBlock(tag, api, state);
      return null;
    },
  });

  const firstFooter = frontmatterFooter(frontmatter);
  const firstHeader: HeaderDeclaration | undefined = frontmatter.header || frontmatter.headerFirst
    ? { ...(frontmatter.header ? { text: frontmatter.header } : {}), ...(frontmatter.headerAlign ? { align: frontmatter.headerAlign } : {}), ...(frontmatter.headerFirst ? { first: frontmatter.headerFirst } : {}) }
    : undefined;
  const sections: SectionState[] = [{ entries: [], ...(firstFooter ? { footer: firstFooter } : {}), ...(firstHeader ? { header: firstHeader } : {}) }];
  let pendingPageBreak: MarkdocNode | null = null;
  let titleBlocks: BlockSpec[] | undefined;
  for (const [nodeIndex, node] of ast.children.entries()) {
    const tag = node.type === 'tag' ? node : soleInlineTag(node);
    const current = sections.at(-1)!;
    // A footnote body is not a block of the body: a pending page break
    // carries over it to the next block.
    if (tag?.tag === 'footnote') continue;
    if (tag?.tag === 'page-break') {
      if (pendingPageBreak) creationError('DUPLICATE_PAGE_BREAK', 'Two consecutive {% page-break /%} tags.', node);
      pendingPageBreak = node;
      continue;
    }
    if (tag?.tag === 'section') {
      if (pendingPageBreak) creationError('PAGE_BREAK_BEFORE_SECTION', '{% page-break /%} directly before {% section /%} is redundant; a section starts a new page.', node);
      if (current.entries.length === 0) creationError('EMPTY_CREATION_SECTION', '{% section /%} must follow at least one block.', node);
      const footer = sectionFooter(tag.attributes);
      const header = sectionHeader(tag.attributes);
      sections.push({ entries: [], ...(footer ? { footer } : {}), ...(header ? { header } : {}) });
      continue;
    }
    const blocks = api.renderBlocks([node], { listDepth: 0 });
    bookmarkTargets(node, blocks);
    const kind = kindOf(node);
    if (kind === 'title' && titleBlocks === undefined) titleBlocks = blocks;
    current.entries.push({ kind, ...(lineOf(node) === undefined ? {} : { line: lineOf(node)! }), blocks, pageBreakBefore: pendingPageBreak !== null, node: nodeIndex });
    pendingPageBreak = null;
  }
  if (pendingPageBreak) creationError('DANGLING_PAGE_BREAK', '{% page-break /%} must be followed by a block.', pendingPageBreak);
  if (sections.every((section) => section.entries.length === 0)) creationError('EMPTY_CREATION_DOCUMENT', 'The source contains no blocks.');
  if (sections.at(-1)!.entries.length === 0) creationError('EMPTY_CREATION_SECTION', 'The last {% section /%} is followed by no blocks.');
  for (const section of sections) applyNeighbourRules(section, profile);

  const margin = twipsFromIn(profile.marginsIn);
  // A section that declares no header or footer inherits the one before it, as in Word, first-page
  // variants included. With `header-first` or `footer-first` in effect the section has w:titlePg, and Word
  // and LibreOffice then show only the first-page slots on its first page, never falling back to the
  // default ones. So both slots are written for each such section: the variant where there is one, and a
  // copy of the section's header or footer otherwise, so the first page never silently loses either.
  const effective: Array<{ header?: HeaderDeclaration; footer?: FooterDeclaration }> = [];
  for (const [index, section] of sections.entries()) {
    const header = section.header ?? effective[index - 1]?.header;
    const footer = section.footer ?? effective[index - 1]?.footer;
    effective.push({ ...(header ? { header } : {}), ...(footer ? { footer } : {}) });
  }
  const firstPageOff = (index: number) => effective[index]!.header?.first !== undefined || effective[index]!.footer?.first !== undefined;
  const specSections: SectionSpec[] = sections.map((section, index) => {
    const blocks = section.entries.flatMap((entry) => entry.blocks);
    const isFinal = index === sections.length - 1;
    const endsWithTable = blocks.at(-1)?.kind === 'table';
    const titlePage = firstPageOff(index);
    const { header: runningHeader, footer: runningFooter } = effective[index]!;
    const headers = {
      ...(section.header ? { default: headerSpec(section.header) } : {}),
      ...(titlePage && runningHeader ? { first: headerSpec(firstPageHeader(runningHeader)) } : {}),
    };
    const footers = {
      ...(section.footer ? { default: footerSpec(section.footer, profile) } : {}),
      ...(titlePage && runningFooter ? { first: footerSpec(firstPageFooter(runningFooter), profile) } : {}),
    };
    return {
      page: {
        sizeTwips: { w: PAGE_WIDTH_TWIPS, h: PAGE_HEIGHT_TWIPS },
        marginsTwips: { top: margin, right: margin, bottom: margin, left: margin, header: 720, footer: 720, gutter: 0 },
      },
      ...(isFinal ? {} : { breakType: 'nextPage' as const, breakPlacement: endsWithTable ? 'ownParagraph' as const : 'lastParagraph' as const }),
      ...(titlePage ? { titlePg: true } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(footers).length > 0 ? { footers } : {}),
      blocks,
    };
  });
  // A section ending in a table gets one empty paragraph after it from docx-core
  // (the dedicated break paragraph, or the closing paragraph of the body).
  const references = referenceTexts(specSections, theme.numbering);
  const titleText = titleBlocks ? projectBlocks(titleBlocks, undefined, references).paragraphs[0] : undefined;
  const projected: BlockProjection = { paragraphs: [], footnoteReferences: [], footnotes: [] };
  for (const section of specSections) {
    projectBlocks(section.blocks, projected, references);
    if (section.blocks.at(-1)?.kind === 'table') projected.paragraphs.push('');
  }
  const { paragraphs } = projected;
  const paragraphEntries: number[] = [];
  const countParagraphs = (blocks: readonly BlockSpec[]): number => blocks.reduce((sum, block) => sum
    + (block.kind === 'table' ? block.rows.reduce((cells, row) => cells + row.cells.reduce((total, cell) => total + countParagraphs(cell.blocks), 0), 0) : 1), 0);
  for (const section of sections) {
    for (const entry of section.entries) paragraphEntries.push(...Array.from({ length: countParagraphs(entry.blocks) }, () => entry.node));
    if (section.entries.at(-1)?.blocks.at(-1)?.kind === 'table') paragraphEntries.push(-1);
  }
  if (paragraphEntries.length !== paragraphs.length) throw new Error('the lowering lost track of which block a paragraph came from');
  const title = frontmatter.title ?? titleText;
  const spec: DocumentSpec = {
    meta: {
      ...(title ? { title } : {}),
      ...(frontmatter.author ? { author: frontmatter.author } : {}),
      createdIso: frontmatter.date ? (frontmatter.date.includes('T') ? frontmatter.date : `${frontmatter.date}T00:00:00Z`) : CREATION_EPOCH_ISO,
    },
    defaults: creationDefaults(profile),
    styles: creationStyles(profile, { header: sections.some((section) => section.header !== undefined) }),
    ...(theme.numbering.length > 0 ? { numbering: [...theme.numbering] } : {}),
    sections: specSections,
  };
  return {
    spec,
    projection: {
      paragraphs,
      footnoteReferences: projected.footnoteReferences,
      footnotes: projected.footnotes,
      footers: sections.map((section) => (section.footer ? footerLines(section.footer) : null)),
      headers: sections.map((section) => (section.header ? [section.header.text ?? ''] : null)),
      firstPage: sections.map((_, index) => {
        if (!firstPageOff(index)) return null;
        const { header, footer } = effective[index]!;
        return { header: header ? [firstPageHeader(header).text ?? ''] : null, footer: footer ? footerLines(firstPageFooter(footer)) : null };
      }),
    },
    frontmatter,
    profile,
    blocks: sections.flatMap((section, index) => section.entries.map((entry) => ({ kind: entry.kind, ...(entry.line === undefined ? {} : { line: entry.line }), section: index }))),
    paragraphEntries,
  };
}
