// Shared block-boundary iterator across document serializers (HTML, Markdown, PlainText, ODF).
//
// In docx-core's document view, `DocumentViewNode[]` is a flat sequence of nodes where tables
// are flattened into individual cell nodes and list items are individual paragraphs.
//
// This module provides a single, centralized document-order iterator that groups contiguous
// table cells by `table_id` and delineates list boundaries, while preserving format-specific
// headings, empty paragraphs, and format-specific nesting rules.

import type { DocumentViewNode } from './document_view.js';

/**
 * Default structural heading check: a node is a structural heading when its source is
 * `word_style` and its level is a number.
 */
export function defaultIsStructuralHeading(node: DocumentViewNode): boolean {
  return node.heading?.source === 'word_style' && typeof node.heading.level === 'number';
}

/**
 * Contiguous table run: nodes that share the exact same `table_context.table_id`.
 * Noncontiguous runs with the same `table_id` remain separate groups.
 */
export interface SerializerTableBlock {
  readonly kind: 'table';
  readonly tableId: string;
  readonly nodes: DocumentViewNode[];
}

/**
 * Heading block: a single node classified as a structural heading.
 */
export interface SerializerHeadingBlock {
  readonly kind: 'heading';
  readonly node: DocumentViewNode;
  readonly level: number;
}

/**
 * List run: contiguous run of list item nodes representing an active list boundary.
 */
export interface SerializerListBlock {
  readonly kind: 'list';
  readonly nodes: DocumentViewNode[];
}

/**
 * Normal paragraph block: a single paragraph node (not a table cell, heading, or list item).
 */
export interface SerializerParagraphBlock {
  readonly kind: 'paragraph';
  readonly node: DocumentViewNode;
}

/**
 * Discriminated union of serializer block representations yielded in document order.
 */
export type SerializerBlock =
  | SerializerTableBlock
  | SerializerHeadingBlock
  | SerializerListBlock
  | SerializerParagraphBlock;

export interface SerializerBlockOptions {
  /**
   * Custom predicate to determine whether a node should be treated as a structural heading.
   * If omitted, `defaultIsStructuralHeading` is used.
   * Returning `false` leaves the node to be evaluated as a list item or normal paragraph.
   */
  readonly isHeading?: (node: DocumentViewNode) => boolean;

  /**
   * Custom level resolver for heading nodes.
   * If omitted, `node.heading.level` (clamped to 1..6) is used.
   */
  readonly headingLevel?: (node: DocumentViewNode) => number;

  /**
   * Custom predicate to determine whether a node should be treated as a list item.
   * Defaults to `node.list_metadata.list_level >= 0`.
   */
  readonly isListItem?: (node: DocumentViewNode) => boolean;

  /**
   * Optional predicate to decide if a contiguous sequence of list items should be split into
   * separate list blocks (for example, if a format-specific boundary or spacing intervenes).
   */
  readonly shouldBreakList?: (currentNode: DocumentViewNode, prevNode: DocumentViewNode) => boolean;
}

/**
 * Iterate over document view nodes in document order, grouping contiguous table cells
 * and list runs into discrete blocks while preserving format-specific headings and paragraphs.
 *
 * Invariants:
 * - Repeated noncontiguous table IDs remain separate groups.
 * - Contiguous table cells with different `table_id` values remain separate groups.
 * - Format-specific headings take precedence over list classification when `isHeading` returns true.
 * - List items are grouped into contiguous list blocks, defining the list boundaries.
 */
export function* iterateSerializerBlocks(
  nodes: readonly DocumentViewNode[],
  options: SerializerBlockOptions = {},
): Generator<SerializerBlock, void, undefined> {
  const isHeading = options.isHeading ?? defaultIsStructuralHeading;
  const headingLevel =
    options.headingLevel ??
    ((n: DocumentViewNode) => {
      const lvl = n.heading?.level;
      return typeof lvl === 'number' ? Math.min(6, Math.max(1, lvl)) : 1;
    });
  const isListItem =
    options.isListItem ?? ((n: DocumentViewNode) => n.list_metadata.list_level >= 0);

  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i]!;

    // 1. Tables: consume the entire contiguous run of same-table_id nodes
    if (node.table_context) {
      const tableId = node.table_context.table_id;
      const group: DocumentViewNode[] = [];
      while (i < nodes.length && nodes[i]!.table_context?.table_id === tableId) {
        group.push(nodes[i]!);
        i++;
      }
      yield { kind: 'table', tableId, nodes: group };
      continue;
    }

    // 2. Structural headings (format-specific)
    if (isHeading(node)) {
      yield { kind: 'heading', node, level: headingLevel(node) };
      i++;
      continue;
    }

    // 3. List items: consume contiguous list items defining a list run
    if (isListItem(node)) {
      const group: DocumentViewNode[] = [node];
      i++;
      while (
        i < nodes.length &&
        !nodes[i]!.table_context &&
        !isHeading(nodes[i]!) &&
        isListItem(nodes[i]!)
      ) {
        if (options.shouldBreakList?.(nodes[i]!, nodes[i - 1]!)) {
          break;
        }
        group.push(nodes[i]!);
        i++;
      }
      yield { kind: 'list', nodes: group };
      continue;
    }

    // 4. Normal paragraph
    yield { kind: 'paragraph', node };
    i++;
  }
}

/**
 * Convenience helper to collect all serializer blocks into an array.
 */
export function collectSerializerBlocks(
  nodes: readonly DocumentViewNode[],
  options: SerializerBlockOptions = {},
): SerializerBlock[] {
  return Array.from(iterateSerializerBlocks(nodes, options));
}
