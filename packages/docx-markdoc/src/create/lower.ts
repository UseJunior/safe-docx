import Markdoc, { type Node as MarkdocNode } from '@markdoc/markdoc';
import type { BlockSpec, DocumentSpec, HeaderFooterSpec, InlineSpec, ParagraphSpec, SectionSpec } from '@usejunior/docx-core';
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

/** Plain-text projection of the lowered document, compared against read-back from the DOCX bytes. */
export type CreationProjection = { paragraphs: string[]; footers: FooterProjection[] };

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

function runText(runs: InlineSpec[]): string {
  return runs.map((run) => {
    if (run.kind === 'text') return run.text;
    if (run.kind === 'tab') return '\t';
    if (run.kind === 'break') return '\n';
    return PAGE_FIELD_TOKEN;
  }).join('');
}

/** Body paragraphs in document order, table cells included, as read-back must find them. */
function projectBlocks(blocks: BlockSpec[]): string[] {
  return blocks.flatMap((block) => (block.kind === 'paragraph'
    ? [runText(block.runs)]
    : block.rows.flatMap((row) => row.cells.flatMap((cell) => projectBlocks(cell.blocks)))));
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
  const ast = Markdoc.parse(source);
  const frontmatter = parseCreationFrontmatter(ast.attributes.frontmatter as string | undefined);
  validateCreationAst(ast.children);
  normalizeSoftBreaks(ast);

  const theme = new CreationTheme(profile);
  const plugins = creationPlugins(theme);
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
  let titleText: string | undefined;
  for (const node of ast.children) {
    const tag = node.type === 'tag' ? node : soleInlineTag(node);
    const current = sections.at(-1)!;
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
    const kind = kindOf(node);
    if (kind === 'title' && titleText === undefined) titleText = projectBlocks(blocks)[0];
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
  const paragraphs = specSections.flatMap((section) => [...projectBlocks(section.blocks), ...(section.blocks.at(-1)?.kind === 'table' ? [''] : [])]);
  const title = frontmatter.title ?? titleText;
  const spec: DocumentSpec = {
    meta: {
      ...(title ? { title } : {}),
      ...(frontmatter.author ? { author: frontmatter.author } : {}),
      createdIso: frontmatter.date ? (frontmatter.date.includes('T') ? frontmatter.date : `${frontmatter.date}T00:00:00Z`) : CREATION_EPOCH_ISO,
    },
    defaults: creationDefaults(profile),
    styles: creationStyles(profile),
    ...(theme.numbering.length > 0 ? { numbering: theme.numbering } : {}),
    sections: specSections,
  };
  return {
    spec,
    projection: {
      paragraphs,
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
