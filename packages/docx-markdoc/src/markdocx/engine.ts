import {type Node} from '@markdoc/markdoc';
import type {BlockSpec, InlineSpec, ParagraphSpec} from '@usejunior/docx-core';

import {throwUnhandledBlock, throwUnhandledTag} from './ast.js';

export type InlineStyle = {bold?: boolean; italic?: boolean; breakLines?: boolean};

/**
 * Generic per-render block context threaded through recursion. `listDepth` is the
 * current list-nesting depth; `paragraphIndentTwips`, when set, left-indents body
 * paragraphs (a consumer sets it to render an indented context — e.g. a clause
 * body — without the engine knowing what that context means). No domain concepts.
 */
export type BlockState = {listDepth: number; paragraphIndentTwips?: number};

/** Per-render closures + recursion the engine exposes back to tag plugins. */
export interface RenderApi {
  theme: Theme;
  resolveField(name: string): {text: string; filled: boolean};
  renderBlocks(nodes: Node[], state: BlockState): BlockSpec[];
  renderInlineChildren(node: Node, style: InlineStyle): InlineSpec[];
}

export interface BlockTagPlugin {
  tag: string;
  renderBlock(node: Node, api: RenderApi, state: BlockState): BlockSpec[];
}

export interface InlineTagPlugin {
  tag: string;
  renderInline(node: Node, api: RenderApi, style: InlineStyle): InlineSpec[];
}

/** All styling the GENERIC mapper reads. */
export interface Theme {
  bodyParagraph(runs: InlineSpec[], overrides?: Partial<Omit<ParagraphSpec, 'kind' | 'runs'>>): ParagraphSpec;
  titleHeadingParagraph?(runs: InlineSpec[]): ParagraphSpec;
  sectionHeadingParagraph(runs: InlineSpec[]): ParagraphSpec;
  subHeadingParagraph(runs: InlineSpec[]): ParagraphSpec;
  horizontalRule(): BlockSpec[];
  renderText(text: string, style: InlineStyle): InlineSpec[];
  fieldRuns(text: string, filled: boolean, style: InlineStyle): InlineSpec[];
  listLevel(level: number, ordered: boolean): {
    numId: string;
    ilvl: number;
    continuationIndentTwips: number;
    itemAfterTwips: number;
  };
}

export interface RenderOptions {
  theme: Theme;
  blockTags?: BlockTagPlugin[];
  inlineTags?: InlineTagPlugin[];
  /**
   * Resolve a `{% field %}` placeholder to its display text + whether it carries a
   * real value. Optional: a document with no fields needs no resolver; a `{% field
   * %}` encountered without one throws.
   */
  resolveField?: (name: string) => {text: string; filled: boolean};
  /**
   * Optional pre-dispatch hook, called for every block node the engine is about to
   * map (exactly the set normal dispatch handles — NOT list/parent-handled
   * paragraph children). Return replacement blocks to short-circuit, or null to
   * fall through to normal mapping. Lets a consumer substitute a sentinel node
   * without patching the engine.
   */
  transformBlock?: (node: Node, state: BlockState) => BlockSpec[] | null;
}

type TransformBlock = (node: Node, state: BlockState) => BlockSpec[] | null;

/** Factory returns a RenderApi the consumer drives + passes to plugins. */
export function createMarkdocxRenderer(options: RenderOptions): RenderApi {
  const blockTags = new Map((options.blockTags ?? []).map((plugin) => [plugin.tag, plugin]));
  const inlineTags = new Map((options.inlineTags ?? []).map((plugin) => [plugin.tag, plugin]));
  const transformBlock = options.transformBlock;
  const resolveField =
    options.resolveField ??
    ((name: string): {text: string; filled: boolean} => {
      throw new Error(`markdocx: encountered {% field name="${name}" %} but no resolveField was provided.`);
    });

  const api: RenderApi = {
    theme: options.theme,
    resolveField,
    renderBlocks(nodes, state) {
      return nodes.flatMap((node) => renderBlock(node, api, blockTags, transformBlock, state));
    },
    renderInlineChildren(node, style) {
      return (node.children ?? []).flatMap((child) => renderInline(child as Node, api, inlineTags, style));
    },
  };

  return api;
}

function renderBlock(
  node: Node,
  api: RenderApi,
  blockTags: Map<string, BlockTagPlugin>,
  transformBlock: TransformBlock | undefined,
  state: BlockState,
): BlockSpec[] {
  if (transformBlock) {
    const replacement = transformBlock(node, state);
    if (replacement) return replacement;
  }
  if (node.type === 'paragraph') {
    const runs = api.renderInlineChildren(node, {});
    if (runs.length === 0) return [];
    if (state.paragraphIndentTwips !== undefined) {
      return [api.theme.bodyParagraph(runs, {indent: {leftTwips: state.paragraphIndentTwips}})];
    }
    return [api.theme.bodyParagraph(runs)];
  }
  if (node.type === 'heading') {
    const level = typeof node.attributes.level === 'number' ? node.attributes.level : 2;
    const runs = api.renderInlineChildren(node, {});
    if (level === 1) return api.theme.titleHeadingParagraph ? [api.theme.titleHeadingParagraph(runs)] : [];
    return [level === 2 ? api.theme.sectionHeadingParagraph(runs) : api.theme.subHeadingParagraph(runs)];
  }
  if (node.type === 'list') return renderList(node, api, blockTags, transformBlock, state);
  if (node.type === 'hr') return api.theme.horizontalRule();
  if (node.type === 'tag') {
    const plugin = blockTags.get(String(node.tag ?? ''));
    if (plugin) return plugin.renderBlock(node, api, state);
    throwUnhandledTag(node);
  }
  if (node.type === 'inline') {
    const runs = api.renderInlineChildren(node, {});
    return runs.length ? [api.theme.bodyParagraph(runs)] : [];
  }
  if (node.type === 'document') {
    return api.renderBlocks((node.children ?? []) as Node[], state);
  }
  throwUnhandledBlock(node);
}

function renderList(
  node: Node,
  api: RenderApi,
  blockTags: Map<string, BlockTagPlugin>,
  transformBlock: TransformBlock | undefined,
  state: BlockState,
): BlockSpec[] {
  const out: BlockSpec[] = [];
  const level = Math.min(state.listDepth, 3);
  const ordered = node.attributes.ordered === true;
  const listLevel = api.theme.listLevel(level, ordered);
  for (const item of (node.children ?? []) as Node[]) {
    if (item.type !== 'item') throwUnhandledBlock(item);
    let firstParagraphDone = false;
    for (const child of (item.children ?? []) as Node[]) {
      if (!firstParagraphDone && (child.type === 'paragraph' || child.type === 'inline')) {
        const runs = api.renderInlineChildren(child, {});
        out.push(
          api.theme.bodyParagraph(runs, {
            list: {numId: listLevel.numId, ilvl: listLevel.ilvl},
            spacing: {afterTwips: listLevel.itemAfterTwips},
          }),
        );
        firstParagraphDone = true;
      } else if (child.type === 'list') {
        out.push(...renderList(child, api, blockTags, transformBlock, {...state, listDepth: level + 1}));
      } else if (child.type === 'paragraph' || child.type === 'inline') {
        const runs = api.renderInlineChildren(child, {});
        if (runs.length > 0) {
          out.push(
            api.theme.bodyParagraph(runs, {
              indent: {leftTwips: listLevel.continuationIndentTwips},
              spacing: {afterTwips: listLevel.itemAfterTwips},
            }),
          );
        }
      } else {
        out.push(...renderBlock(child, api, blockTags, transformBlock, state));
      }
    }
  }
  return out;
}

function renderInline(
  node: Node,
  api: RenderApi,
  inlineTags: Map<string, InlineTagPlugin>,
  style: InlineStyle,
): InlineSpec[] {
  if (node.type === 'text') {
    const text = typeof node.attributes.content === 'string' ? node.attributes.content : '';
    return api.theme.renderText(text, style);
  }
  if (node.type === 'softbreak' || node.type === 'hardbreak') {
    if (style.breakLines) return [{kind: 'break', breakType: 'line'}];
    return [{kind: 'text', text: ' ', bold: style.bold, italic: style.italic}];
  }
  if (node.type === 'strong') return api.renderInlineChildren(node, {...style, bold: true});
  if (node.type === 'em') return api.renderInlineChildren(node, {...style, italic: true});
  if (node.type === 'code') {
    const text = typeof node.attributes.content === 'string' ? node.attributes.content : '';
    return text ? [{kind: 'text', text, bold: style.bold, italic: style.italic}] : [];
  }
  if (node.type === 'link') return api.renderInlineChildren(node, style);
  if (node.type === 'inline' || node.type === 'heading' || node.type === 'paragraph') {
    return api.renderInlineChildren(node, style);
  }
  if (node.type === 'tag') {
    if (node.tag === 'field') {
      const name = String(node.attributes.name ?? '');
      const {text, filled} = api.resolveField(name);
      return api.theme.fieldRuns(text, filled, style);
    }
    const plugin = inlineTags.get(String(node.tag ?? ''));
    if (plugin) return plugin.renderInline(node, api, style);
    throwUnhandledTag(node);
  }
  throwUnhandledBlock(node);
}
