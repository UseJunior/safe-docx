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
  twipsFromIn,
  twipsFromPt,
  type CreationProfile,
} from './profile.js';
import { CreationTheme, creationPlugins } from './theme.js';
import {
  checkCreationSourceCharacters,
  creationError,
  lineOf,
  parseCreationFrontmatter,
  soleInlineTag,
  validateCreationAst,
  type CreationFrontmatter,
} from './validate.js';

export { parseCreationFrontmatter, type CreationFrontmatter } from './validate.js';

/** Fixed core-property date when the source declares none: builds never read the clock. */
export const CREATION_EPOCH_ISO = '2006-01-01T00:00:00Z';
/** Read-back token for a PAGE field. */
export const PAGE_FIELD_TOKEN = '<PAGE>';

/**
 * Footer per section: its paragraph texts when the section declares its own
 * footer, or null when it has no footer reference (the first section then has
 * no footer; later sections inherit the previous one, as in Word).
 */
export type FooterProjection = string[] | null;

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
};

type FooterDeclaration = { text?: string; pageNumbers?: boolean };
type Entry = { kind: CreationBlockKind; line?: number; blocks: BlockSpec[]; pageBreakBefore: boolean };
type SectionState = { entries: Entry[]; footer?: FooterDeclaration };

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

/** The text a cross-reference to a bookmark shows, by number form. */
type ReferenceTexts = ReadonlyMap<string, { full: string; paragraph: string }>;

function runText(runs: InlineSpec[], references: ReferenceTexts = new Map()): string {
  return runs.map((run) => {
    if (run.kind === 'text') return run.text;
    if (run.kind === 'tab') return '\t';
    if (run.kind === 'break') return '\n';
    if (run.kind === 'footnote') return '';
    if (run.kind === 'crossReference') {
      const text = references.get(run.bookmark);
      if (!text) throw new Error(`cross-reference to '${run.bookmark}' has no numbered target in the lowering`);
      return run.number === 'paragraph' ? text.paragraph : text.full;
    }
    return PAGE_FIELD_TOKEN;
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
 * What each bookmarked list item's cross-references show, counted from the
 * lowering's own lists: each ordered list numbers `1.`, `(a)`, `(i)` and
 * restarts deeper levels under a new item. Word shows the full number as
 * "2", "2(b)", "2(b)(ii)" (the period before "(" dropped) and the paragraph
 * number as "2", "(b)", "(ii)". docx-core computes the cached result from the
 * OOXML; read-back compares the two.
 *
 * Counting follows Word's list model, as the numbering decisions in
 * `list-numbering.ts` rely on: every instance of one definition shares a
 * running count, and an instance's `startOverride` restarts it at that
 * instance's first paragraph on the level.
 */
function referenceTexts(sections: SectionSpec[], numbering: readonly NumberingSpec[]): Map<string, { full: string; paragraph: string }> {
  const instances = new Map<string, { definition: NumberingSpec; overrides: ReadonlyMap<number, number> }>();
  for (const definition of numbering) {
    instances.set(definition.numId, { definition, overrides: new Map() });
    for (const instance of definition.instances ?? []) {
      instances.set(instance.numId, { definition, overrides: new Map(instance.levelOverrides.map((override) => [override.ilvl, override.startOverride])) });
    }
  }
  const counters = new Map<string, number[]>();
  const usedLevels = new Map<string, Set<number>>();
  const texts = new Map<string, { full: string; paragraph: string }>();
  const visit = (blocks: BlockSpec[]) => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
        continue;
      }
      if (!block.list) continue;
      const { numId, ilvl } = block.list;
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
      if (block.bookmark === undefined || levels[0]!.numFmt !== 'decimal') continue;
      const own = [String(values[0]), `(${letters(values[1]!)})`, `(${roman(values[2]!)})`];
      texts.set(block.bookmark, { full: own.slice(0, ilvl + 1).join(''), paragraph: own[ilvl]! });
    }
  };
  for (const section of sections) visit(section.blocks);
  return texts;
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
function projectBlocks(blocks: BlockSpec[], out: BlockProjection = { paragraphs: [], footnoteReferences: [], footnotes: [] }, references: ReferenceTexts = new Map()): BlockProjection {
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) for (const cell of row.cells) projectBlocks(cell.blocks, out, references);
      continue;
    }
    let offset = 0;
    for (const run of block.runs) {
      if (run.kind === 'footnote') {
        out.footnoteReferences.push({ paragraph: out.paragraphs.length, offset });
        out.footnotes.push(run.blocks.map((paragraph, index) => (index === 0 ? FOOTNOTE_MARK_SPACE : '') + runText(paragraph.runs, references)));
      }
      offset += runText([run], references).length;
    }
    out.paragraphs.push(runText(block.runs, references));
  }
  return out;
}

function footerSpec(footer: FooterDeclaration): HeaderFooterSpec {
  // A declared footer with neither text nor page numbers is an unlinked, empty footer.
  if (!footer.text && !footer.pageNumbers) return { blocks: [{ kind: 'paragraph', styleId: CREATION_STYLE.footer, runs: [] }] };
  const blocks: ParagraphSpec[] = [];
  if (footer.text) blocks.push({ kind: 'paragraph', styleId: CREATION_STYLE.footer, runs: [{ kind: 'text', text: footer.text, italic: true }] });
  if (footer.pageNumbers) blocks.push({ kind: 'paragraph', styleId: CREATION_STYLE.footer, runs: [{ kind: 'field', field: 'PAGE', cachedResult: '1' }] });
  return { blocks };
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
  validateCreationAst(ast.children, { fillIns: frontmatter.fillIns ?? 'markup' });
  normalizeSoftBreaks(ast);
  trimAnnotationSpace(ast);

  // Footnote bodies render where their {% fnref /%} sits; the blocks
  // themselves add nothing to the body. Validation paired every id.
  const footnoteBodies = new Map<string, MarkdocNode>();
  for (const node of ast.children) {
    const tag = node.type === 'tag' ? node : soleInlineTag(node);
    if (tag?.tag === 'footnote') footnoteBodies.set(String(tag.attributes.id), tag);
  }

  const theme = new CreationTheme(profile, frontmatter.fillIns ?? 'markup');
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

  const firstFooter = frontmatter.footer || frontmatter.pageNumbers
    ? { ...(frontmatter.footer ? { text: frontmatter.footer } : {}), ...(frontmatter.pageNumbers ? { pageNumbers: true } : {}) }
    : undefined;
  const sections: SectionState[] = [{ entries: [], ...(firstFooter ? { footer: firstFooter } : {}) }];
  let pendingPageBreak: MarkdocNode | null = null;
  let titleBlocks: BlockSpec[] | undefined;
  for (const node of ast.children) {
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
      const footer = tag.attributes.footer as string | undefined;
      const pageNumbersAttribute = tag.attributes['page-numbers'] as boolean | undefined;
      // Any footer attribute, including an explicit page-numbers=false, unlinks the footer; none inherits.
      const declared = footer !== undefined || pageNumbersAttribute !== undefined;
      sections.push({ entries: [], ...(declared ? { footer: { ...(footer ? { text: footer } : {}), ...(pageNumbersAttribute ? { pageNumbers: true } : {}) } } : {}) });
      continue;
    }
    const blocks = api.renderBlocks([node], { listDepth: 0 });
    bookmarkTargets(node, blocks);
    const kind = kindOf(node);
    if (kind === 'title' && titleBlocks === undefined) titleBlocks = blocks;
    current.entries.push({ kind, ...(lineOf(node) === undefined ? {} : { line: lineOf(node)! }), blocks, pageBreakBefore: pendingPageBreak !== null });
    pendingPageBreak = null;
  }
  if (pendingPageBreak) creationError('DANGLING_PAGE_BREAK', '{% page-break /%} must be followed by a block.', pendingPageBreak);
  if (sections.every((section) => section.entries.length === 0)) creationError('EMPTY_CREATION_DOCUMENT', 'The source contains no blocks.');
  if (sections.at(-1)!.entries.length === 0) creationError('EMPTY_CREATION_SECTION', 'The last {% section /%} is followed by no blocks.');
  for (const section of sections) applyNeighbourRules(section, profile);

  const margin = twipsFromIn(profile.marginsIn);
  const specSections: SectionSpec[] = sections.map((section, index) => {
    const blocks = section.entries.flatMap((entry) => entry.blocks);
    const isFinal = index === sections.length - 1;
    const endsWithTable = blocks.at(-1)?.kind === 'table';
    return {
      page: {
        sizeTwips: { w: PAGE_WIDTH_TWIPS, h: PAGE_HEIGHT_TWIPS },
        marginsTwips: { top: margin, right: margin, bottom: margin, left: margin, header: 720, footer: 720, gutter: 0 },
      },
      ...(isFinal ? {} : { breakType: 'nextPage' as const, breakPlacement: endsWithTable ? 'ownParagraph' as const : 'lastParagraph' as const }),
      ...(section.footer ? { footers: { default: footerSpec(section.footer) } } : {}),
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
  const title = frontmatter.title ?? titleText;
  const spec: DocumentSpec = {
    meta: {
      ...(title ? { title } : {}),
      ...(frontmatter.author ? { author: frontmatter.author } : {}),
      createdIso: frontmatter.date ? (frontmatter.date.includes('T') ? frontmatter.date : `${frontmatter.date}T00:00:00Z`) : CREATION_EPOCH_ISO,
    },
    defaults: creationDefaults(profile),
    styles: creationStyles(profile),
    ...(theme.numbering.length > 0 ? { numbering: [...theme.numbering] } : {}),
    sections: specSections,
  };
  return {
    spec,
    projection: {
      paragraphs,
      footnoteReferences: projected.footnoteReferences,
      footnotes: projected.footnotes,
      footers: sections.map((section) => (section.footer
        ? (section.footer.text || section.footer.pageNumbers
          ? [...(section.footer.text ? [section.footer.text] : []), ...(section.footer.pageNumbers ? [PAGE_FIELD_TOKEN] : [])]
          : [''])
        : null)),
    },
    frontmatter,
    profile,
    blocks: sections.flatMap((section, index) => section.entries.map((entry) => ({ kind: entry.kind, ...(entry.line === undefined ? {} : { line: entry.line }), section: index }))),
  };
}
