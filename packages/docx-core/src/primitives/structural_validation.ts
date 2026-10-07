import type { DocumentViewNode } from './document_view-types.js';
import { getParagraphBookmarkId } from './bookmarks.js';
import { getDirectChildrenByName } from './dom-helpers.js';

export type StructuralDiagnosticSeverity = 'warning' | 'error';

export type StructuralDiagnosticEvidence = {
  anchor_level: number | null;
  intended_level: number | null;
  first_descendant_id?: string;
  first_descendant_level?: number;
  style_source_id?: string;
  anchor_num_id?: string;
  style_source_num_id?: string;
  bonded_heading_style?: string;
  bonded_body_style?: string;
  bonded_body_style_candidates?: string[];
};

export type StructuralDiagnostic = {
  code: 'PARENT_CHILD_SLICE' | 'LIST_LEVEL_MISMATCH' | 'MID_LIST_RENUMBERING'
    | 'BONDED_PARAGRAPH_PAIR_REQUIRED' | 'RUN_IN_PAIR_ORDER'
    | 'BONDED_PARAGRAPH_PAIR_AMBIGUOUS';
  severity: StructuralDiagnosticSeverity;
  operation_id: string;
  anchor_id: string;
  message: string;
  evidence: StructuralDiagnosticEvidence;
  suggested_anchor_id?: string;
  /** Position to use with `suggested_anchor_id`; omitted when it matches the original position. */
  suggested_position?: 'BEFORE' | 'AFTER';
};

/**
 * Source evidence the node view does not carry. `runInHeadingIds` names
 * paragraphs whose paragraph mark is a Word style separator (`w:specVanish`),
 * so the heading renders run-in with the following paragraph. Only those
 * paragraphs can anchor a bonded heading/body pair; a repeated
 * `Heading1 → Normal` transition by itself is ordinary section structure.
 */
export type StructuralValidationOptions = {
  runInHeadingIds?: ReadonlySet<string>;
};

export type ResolvedInsertionContext = {
  operationId: string;
  position: 'BEFORE' | 'AFTER';
  anchorId: string;
  styleSourceId?: string;
};

export type StructuralValidator = (
  nodes: readonly DocumentViewNode[],
  context: ResolvedInsertionContext,
) => StructuralDiagnostic[];

function hierarchyLevel(node: DocumentViewNode | undefined): number | null {
  if (!node) return null;
  if (node.heading?.level != null && (
    node.heading.source === 'word_style'
    || node.heading.source === 'list_metadata'
    || node.heading.source === 'outline_level'
  )) return node.heading.level;
  if (node.numbering.is_auto_numbered && node.numbering.ilvl != null) return node.numbering.ilvl + 1;
  return null;
}

function structuralStyle(node: DocumentViewNode | undefined): string {
  return node?.paragraph_style_id ?? node?.style ?? '';
}

const parentChildSlicing: StructuralValidator = (nodes, context) => {
  const anchorIndex = nodes.findIndex((node) => node.id === context.anchorId);
  const source = nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
  if (anchorIndex < 0 || !source) return [];
  const intendedLevel = hierarchyLevel(source);
  if (intendedLevel == null) return [];

  // The insertion lands in the gap between `gapIndex` and `gapIndex + 1`.
  const gapIndex = context.position === 'AFTER' ? anchorIndex : anchorIndex - 1;
  // The run the new paragraph would capture: every following paragraph until
  // one at or above the intended level.
  let firstCaptured: { id: string; level: number } | undefined;
  let lastCapturedId: string | undefined;
  for (let index = gapIndex + 1; index < nodes.length; index += 1) {
    const level = hierarchyLevel(nodes[index]);
    if (level != null && level <= intendedLevel) break;
    if (level != null && !firstCaptured) firstCaptured = { id: nodes[index]!.id, level };
    lastCapturedId = nodes[index]!.id;
  }
  if (!firstCaptured) return [];
  // Slicing only happens when the captured paragraph already has a parent
  // before the gap: the insertion would steal it from that parent.
  let hasExistingParent = false;
  for (let index = gapIndex; index >= 0; index -= 1) {
    const level = hierarchyLevel(nodes[index]);
    if (level != null && level < firstCaptured.level) { hasExistingParent = true; break; }
  }
  if (!hasExistingParent) return [];
  const suggestedAnchorId = lastCapturedId!;
  return [{
    code: 'PARENT_CHILD_SLICE',
    severity: 'error',
    operation_id: context.operationId,
    anchor_id: context.anchorId,
    message: `Insertion ${context.operationId} would separate ${firstCaptured.id} from its existing parent; insert after ${suggestedAnchorId} instead.`,
    evidence: {
      anchor_level: hierarchyLevel(nodes[anchorIndex]),
      intended_level: intendedLevel,
      first_descendant_id: firstCaptured.id,
      first_descendant_level: firstCaptured.level,
      style_source_id: context.styleSourceId,
    },
    suggested_anchor_id: suggestedAnchorId,
    suggested_position: 'AFTER',
  }];
};

const listLevelMismatch: StructuralValidator = (nodes, context) => {
  const anchor = nodes.find((node) => node.id === context.anchorId);
  const source = nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
  if (!anchor?.numbering.is_auto_numbered || !source?.numbering.is_auto_numbered) return [];
  if (anchor.numbering.ilvl == null || source.numbering.ilvl == null || anchor.numbering.ilvl === source.numbering.ilvl) return [];
  return [{
    code: 'LIST_LEVEL_MISMATCH',
    severity: 'warning',
    operation_id: context.operationId,
    anchor_id: context.anchorId,
    message: `Insertion ${context.operationId} uses list level ${source.numbering.ilvl} beside level ${anchor.numbering.ilvl}; confirm that nesting is intentional.`,
    evidence: {
      anchor_level: anchor.numbering.ilvl + 1,
      intended_level: source.numbering.ilvl + 1,
      style_source_id: context.styleSourceId,
      anchor_num_id: anchor.numbering.num_id ?? undefined,
      style_source_num_id: source.numbering.num_id ?? undefined,
    },
  }];
};

const midListRenumbering: StructuralValidator = (nodes, context) => {
  const anchorIndex = nodes.findIndex((node) => node.id === context.anchorId);
  const source = nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
  if (anchorIndex < 0 || !source?.numbering.is_auto_numbered) return [];
  const anchor = nodes[anchorIndex]!;
  const neighbor = context.position === 'AFTER' ? nodes[anchorIndex + 1] : nodes[anchorIndex - 1];
  if (!anchor.numbering.is_auto_numbered || !neighbor?.numbering.is_auto_numbered) return [];
  const sameListWindow = anchor.numbering.num_id != null
    && anchor.numbering.num_id === neighbor.numbering.num_id
    && anchor.numbering.ilvl === neighbor.numbering.ilvl;
  if (!sameListWindow || source.numbering.num_id == null || source.numbering.num_id === anchor.numbering.num_id) return [];
  return [{
    code: 'MID_LIST_RENUMBERING',
    severity: 'error',
    operation_id: context.operationId,
    anchor_id: context.anchorId,
    message: `Insertion ${context.operationId} would introduce numbering ${source.numbering.num_id} inside list ${anchor.numbering.num_id}; use a peer from the surrounding list.`,
    evidence: {
      anchor_level: hierarchyLevel(anchor),
      intended_level: hierarchyLevel(source),
      style_source_id: context.styleSourceId,
      anchor_num_id: anchor.numbering.num_id ?? undefined,
      style_source_num_id: source.numbering.num_id ?? undefined,
    },
    suggested_anchor_id: anchor.id,
  }];
};

export const structuralValidators: readonly StructuralValidator[] = [
  parentChildSlicing,
  listLevelMismatch,
  midListRenumbering,
];

export function validateStructuralInsertion(
  nodes: readonly DocumentViewNode[],
  context: ResolvedInsertionContext,
): StructuralDiagnostic[] {
  return structuralValidators.flatMap((validator) => validator(nodes, context));
}

export function validateStructuralInsertions(
  nodes: readonly DocumentViewNode[],
  contexts: readonly ResolvedInsertionContext[],
  options: StructuralValidationOptions = {},
): StructuralDiagnostic[] {
  const diagnostics = contexts.flatMap((context) => validateStructuralInsertion(nodes, context));
  diagnostics.push(...validateBondedPairs(nodes, contexts, options));
  return diagnostics;
}

function sourceNode(nodes: readonly DocumentViewNode[], context: ResolvedInsertionContext): DocumentViewNode | undefined {
  return nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
}

type BondedTransition = { headingStyle: string; bodyStyle: string; count: number };

/**
 * A heading style is bonded to a follower style only when the source shows the
 * Word run-in construction (a style-separator paragraph mark on the heading)
 * followed by the same follower style at the same indent, at least twice.
 * Title casing and punctuation are not structural authorities.
 */
function bondedTransitions(nodes: readonly DocumentViewNode[], options: StructuralValidationOptions): BondedTransition[] {
  const runInHeadingIds = options.runInHeadingIds;
  if (!runInHeadingIds || runInHeadingIds.size === 0) return [];
  const transitions = new Map<string, BondedTransition>();
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const heading = nodes[index]!;
    const body = nodes[index + 1]!;
    if (!runInHeadingIds.has(heading.id)) continue;
    if (hierarchyLevel(heading) == null || hierarchyLevel(body) != null) continue;
    if (Math.abs(heading.paragraph_indents_pt.left - body.paragraph_indents_pt.left) > 0.5) continue;
    const headingStyle = structuralStyle(heading);
    const bodyStyle = structuralStyle(body);
    if (!headingStyle || !bodyStyle || headingStyle === bodyStyle) continue;
    const key = `${headingStyle}\u0000${bodyStyle}`;
    const current = transitions.get(key);
    transitions.set(key, { headingStyle, bodyStyle, count: (current?.count ?? 0) + 1 });
  }
  return [...transitions.values()].filter((transition) => transition.count >= 2);
}

function validateBondedPairs(
  nodes: readonly DocumentViewNode[],
  contexts: readonly ResolvedInsertionContext[],
  options: StructuralValidationOptions,
): StructuralDiagnostic[] {
  const bonded = bondedTransitions(nodes, options);
  if (bonded.length === 0) return [];
  const diagnostics: StructuralDiagnostic[] = [];

  // Group operations by insertion slot. Repeated AFTER insertion lands each
  // new paragraph directly after the anchor, so the slot's document order is
  // the reverse of operation order; repeated BEFORE preserves operation order.
  const slots = new Map<string, number[]>();
  contexts.forEach((context, index) => {
    const key = `${context.anchorId}\u0000${context.position}`;
    slots.set(key, [...(slots.get(key) ?? []), index]);
  });

  for (const operationIndexes of slots.values()) {
    const position = contexts[operationIndexes[0]!]!.position;
    const documentOrder = position === 'AFTER' ? [...operationIndexes].reverse() : operationIndexes;
    const styleOf = (operationIndex: number) => structuralStyle(sourceNode(nodes, contexts[operationIndex]!));
    const consumedBodies = new Set<number>();
    const unpaired: Array<{ operationIndex: number; candidatePairs: BondedTransition[] }> = [];

    documentOrder.forEach((operationIndex, slotIndex) => {
      // Only a run-in heading source binds a body; an ordinary paragraph that
      // happens to share the run-in style (e.g. a Heading2 with Heading3
      // children) does not.
      const headingSource = sourceNode(nodes, contexts[operationIndex]!);
      if (!headingSource || !options.runInHeadingIds?.has(headingSource.id)) return;
      const candidatePairs = bonded.filter((transition) => transition.headingStyle === styleOf(operationIndex));
      if (candidatePairs.length === 0) return;
      const next = documentOrder[slotIndex + 1];
      const nextStyle = next == null ? undefined : styleOf(next);
      const adjacentPair = candidatePairs.find((pair) => pair.bodyStyle === nextStyle);
      if (next != null && adjacentPair && !consumedBodies.has(next)) {
        consumedBodies.add(next);
        return;
      }
      unpaired.push({ operationIndex, candidatePairs });
    });

    for (const { operationIndex, candidatePairs } of unpaired) {
      const context = contexts[operationIndex]!;
      const source = sourceNode(nodes, context);
      const availableBodyStyles = new Set(operationIndexes
        .filter((index) => !consumedBodies.has(index))
        .map(styleOf));
      const matchingPairs = candidatePairs.filter((pair) => availableBodyStyles.has(pair.bodyStyle));
      const baseEvidence = {
        anchor_level: hierarchyLevel(nodes.find((node) => node.id === context.anchorId)),
        intended_level: hierarchyLevel(source),
        style_source_id: context.styleSourceId,
      };
      if (candidatePairs.length > 1 && matchingPairs.length !== 1) {
        const candidates = candidatePairs.map((pair) => pair.bodyStyle).sort();
        diagnostics.push({
          code: 'BONDED_PARAGRAPH_PAIR_AMBIGUOUS', severity: 'error', operation_id: context.operationId,
          anchor_id: context.anchorId,
          message: `Style ${structuralStyle(source)} has multiple repeated run-in body followers (${candidates.join(', ')}); supply exactly one matching body peer immediately after the heading in this insertion slot.`,
          evidence: { ...baseEvidence, bonded_heading_style: structuralStyle(source), bonded_body_style_candidates: candidates },
        });
        continue;
      }
      const pair = matchingPairs[0] ?? candidatePairs[0]!;
      const evidence = { ...baseEvidence, bonded_heading_style: pair.headingStyle, bonded_body_style: pair.bodyStyle };
      if (matchingPairs.length === 0) {
        diagnostics.push({
          code: 'BONDED_PARAGRAPH_PAIR_REQUIRED', severity: 'error', operation_id: context.operationId,
          anchor_id: context.anchorId,
          message: `Style ${pair.headingStyle} is a run-in heading repeatedly followed by ${pair.bodyStyle}; insert both paragraphs with distinct structural peers.`,
          evidence,
        });
        continue;
      }
      const requiredOrder = position === 'AFTER'
        ? `${pair.bodyStyle} immediately before ${pair.headingStyle}`
        : `${pair.headingStyle} immediately before ${pair.bodyStyle}`;
      diagnostics.push({
        code: 'RUN_IN_PAIR_ORDER', severity: 'error', operation_id: context.operationId,
        anchor_id: context.anchorId,
        message: `For repeated ${position} insertion, order operations ${requiredOrder} so the document yields each heading directly followed by its body.`,
        evidence,
      });
    }
  }
  return diagnostics;
}

/**
 * Paragraph ids whose paragraph mark carries `w:specVanish` (Word's style
 * separator), i.e. headings that render run-in with the next paragraph.
 */
export function collectRunInHeadingIds(paragraphs: Iterable<Element>): Set<string> {
  const ids = new Set<string>();
  for (const paragraph of paragraphs) {
    if (!isRunInHeadingParagraph(paragraph)) continue;
    const id = getParagraphBookmarkId(paragraph);
    if (id) ids.add(id);
  }
  return ids;
}

export function isRunInHeadingParagraph(paragraph: Element): boolean {
  const pPr = getDirectChildrenByName(paragraph, 'pPr')[0];
  const markRPr = pPr ? getDirectChildrenByName(pPr, 'rPr')[0] : undefined;
  const specVanish = markRPr ? getDirectChildrenByName(markRPr, 'specVanish')[0] : undefined;
  if (!specVanish) return false;
  const value = (specVanish.getAttribute('w:val') ?? '').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

/** True only for the explicit two-operation form of a source-proven bonded pair. */
export function isRecognizedBondedInsertionPair(
  nodes: readonly DocumentViewNode[],
  contexts: readonly ResolvedInsertionContext[],
  options: StructuralValidationOptions = {},
): boolean {
  if (contexts.length !== 2) return false;
  const [first, second] = contexts;
  if (!first || !second || first.anchorId !== second.anchorId || first.position !== second.position) return false;
  const sources = contexts.map((context) => sourceNode(nodes, context));
  if (!sources[0] || !sources[1] || structuralStyle(sources[0]) === structuralStyle(sources[1])) return false;
  const headingIndex = sources.findIndex((source) => hierarchyLevel(source) != null);
  const bodyIndex = sources.findIndex((source) => hierarchyLevel(source) == null);
  if (headingIndex < 0 || bodyIndex < 0) return false;
  if (!options.runInHeadingIds?.has(sources[headingIndex]!.id)) return false;
  const headingStyle = structuralStyle(sources[headingIndex]);
  const bodyStyle = structuralStyle(sources[bodyIndex]);
  const proven = bondedTransitions(nodes, options)
    .some((transition) => transition.headingStyle === headingStyle && transition.bodyStyle === bodyStyle);
  if (!proven) return false;
  return !validateBondedPairs(nodes, contexts, options).length;
}
