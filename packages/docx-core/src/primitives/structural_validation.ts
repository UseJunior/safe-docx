import type { DocumentViewNode } from './document_view-types.js';

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
  if (context.position !== 'AFTER') return [];
  const anchorIndex = nodes.findIndex((node) => node.id === context.anchorId);
  const source = nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
  if (anchorIndex < 0 || !source) return [];
  const anchorLevel = hierarchyLevel(nodes[anchorIndex]);
  const intendedLevel = hierarchyLevel(source);
  if (anchorLevel == null || intendedLevel == null || intendedLevel > anchorLevel) return [];

  const descendants: Array<{ id: string; level: number }> = [];
  let lastDescendantId: string | undefined;
  for (let index = anchorIndex + 1; index < nodes.length; index += 1) {
    const level = hierarchyLevel(nodes[index]);
    if (level == null) {
      if (descendants.length > 0) lastDescendantId = nodes[index]!.id;
      continue;
    }
    if (level <= anchorLevel) break;
    descendants.push({ id: nodes[index]!.id, level });
    lastDescendantId = nodes[index]!.id;
  }
  if (descendants.length === 0) return [];
  const first = descendants[0]!;
  const suggestedAnchorId = lastDescendantId!;
  return [{
    code: 'PARENT_CHILD_SLICE',
    severity: 'error',
    operation_id: context.operationId,
    anchor_id: context.anchorId,
    message: `Insertion ${context.operationId} would separate ${context.anchorId} from its existing descendants; insert after ${suggestedAnchorId} instead.`,
    evidence: {
      anchor_level: anchorLevel,
      intended_level: intendedLevel,
      first_descendant_id: first.id,
      first_descendant_level: first.level,
      style_source_id: context.styleSourceId,
    },
    suggested_anchor_id: suggestedAnchorId,
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
): StructuralDiagnostic[] {
  const diagnostics = contexts.flatMap((context) => validateStructuralInsertion(nodes, context));

  // A repeated deterministic-heading → follower-style transition is document
  // evidence that the two paragraphs form one run-in structural unit. This is
  // intentionally style/position based: title casing and punctuation are not
  // reliable structural authorities.
  const transitions = new Map<string, { headingStyle: string; bodyStyle: string; count: number }>();
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const heading = nodes[index]!;
    const body = nodes[index + 1]!;
    if (hierarchyLevel(heading) == null || hierarchyLevel(body) != null) continue;
    if (Math.abs(heading.paragraph_indents_pt.left - body.paragraph_indents_pt.left) > 0.5) continue;
    const headingStyle = structuralStyle(heading);
    const bodyStyle = structuralStyle(body);
    if (!headingStyle || !bodyStyle || headingStyle === bodyStyle) continue;
    const key = `${headingStyle}\u0000${bodyStyle}`;
    const current = transitions.get(key);
    transitions.set(key, { headingStyle, bodyStyle, count: (current?.count ?? 0) + 1 });
  }
  const bonded = [...transitions.values()].filter((transition) => transition.count >= 2);
  const consumedBodyOperations = new Set<number>();
  contexts.forEach((context, headingOperationIndex) => {
    const source = nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId));
    const candidatePairs = bonded.filter((transition) => transition.headingStyle === structuralStyle(source));
    if (candidatePairs.length === 0) return;
    const availableBodies = contexts.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => {
      if (consumedBodyOperations.has(index)) return false;
      return candidate.anchorId === context.anchorId && candidate.position === context.position;
    });
    const suppliedBodyStyles = new Set(availableBodies.map(({ candidate }) => {
      const candidateSource = nodes.find((node) => node.id === (candidate.styleSourceId ?? candidate.anchorId));
      return structuralStyle(candidateSource);
    }));
    const matchingPairs = candidatePairs.filter((pair) => suppliedBodyStyles.has(pair.bodyStyle));
    if (candidatePairs.length > 1 && matchingPairs.length !== 1) {
      diagnostics.push({
        code: 'BONDED_PARAGRAPH_PAIR_AMBIGUOUS', severity: 'error', operation_id: context.operationId,
        anchor_id: context.anchorId,
        message: `Style ${structuralStyle(source)} has multiple repeated body followers (${candidatePairs.map((pair) => pair.bodyStyle).sort().join(', ')}); supply exactly one matching body peer in this insertion slot.`,
        evidence: {
          anchor_level: hierarchyLevel(nodes.find((node) => node.id === context.anchorId)),
          intended_level: hierarchyLevel(source),
          style_source_id: context.styleSourceId,
          bonded_heading_style: structuralStyle(source),
          bonded_body_style_candidates: candidatePairs.map((pair) => pair.bodyStyle).sort(),
        },
      });
      return;
    }
    const pair = matchingPairs[0] ?? candidatePairs[0]!;
    const bodyOperation = availableBodies.find(({ candidate }) => {
      const candidateSource = nodes.find((node) => node.id === (candidate.styleSourceId ?? candidate.anchorId));
      return structuralStyle(candidateSource) === pair.bodyStyle;
    });
    const bodyOperationIndex = bodyOperation?.index ?? -1;
    const evidence = {
      anchor_level: hierarchyLevel(nodes.find((node) => node.id === context.anchorId)),
      intended_level: hierarchyLevel(source),
      style_source_id: context.styleSourceId,
      bonded_heading_style: pair.headingStyle,
      bonded_body_style: pair.bodyStyle,
    };
    if (bodyOperationIndex < 0) {
      diagnostics.push({
        code: 'BONDED_PARAGRAPH_PAIR_REQUIRED', severity: 'error', operation_id: context.operationId,
        anchor_id: context.anchorId,
        message: `Style ${pair.headingStyle} is repeatedly followed by ${pair.bodyStyle}; insert both paragraphs with distinct structural peers.`,
        evidence,
      });
    } else {
      consumedBodyOperations.add(bodyOperationIndex);
    }
    const wrongOrder = bodyOperationIndex >= 0 && (
      (context.position === 'AFTER' && bodyOperationIndex > headingOperationIndex)
      || (context.position === 'BEFORE' && headingOperationIndex > bodyOperationIndex)
    );
    if (wrongOrder) {
      const requiredOrder = context.position === 'AFTER'
        ? `${pair.bodyStyle} before ${pair.headingStyle}`
        : `${pair.headingStyle} before ${pair.bodyStyle}`;
      diagnostics.push({
        code: 'RUN_IN_PAIR_ORDER', severity: 'error', operation_id: context.operationId,
        anchor_id: context.anchorId,
        message: `For repeated ${context.position} insertion, order operations ${requiredOrder} so the document yields heading then body.`,
        evidence,
      });
    }
  });
  return diagnostics;
}

/** True only for the explicit two-operation form of a source-proven bonded pair. */
export function isRecognizedBondedInsertionPair(
  nodes: readonly DocumentViewNode[],
  contexts: readonly ResolvedInsertionContext[],
): boolean {
  if (contexts.length !== 2) return false;
  const [first, second] = contexts;
  if (!first || !second || first.anchorId !== second.anchorId || first.position !== second.position) return false;
  const sources = contexts.map((context) => nodes.find((node) => node.id === (context.styleSourceId ?? context.anchorId)));
  if (!sources[0] || !sources[1] || structuralStyle(sources[0]) === structuralStyle(sources[1])) return false;
  const headingIndex = sources.findIndex((source) => hierarchyLevel(source) != null);
  const bodyIndex = sources.findIndex((source) => hierarchyLevel(source) == null);
  if (headingIndex < 0 || bodyIndex < 0) return false;
  const headingStyle = structuralStyle(sources[headingIndex]);
  const bodyStyle = structuralStyle(sources[bodyIndex]);
  let transitionCount = 0;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const heading = nodes[index]!;
    const body = nodes[index + 1]!;
    if (structuralStyle(heading) === headingStyle && structuralStyle(body) === bodyStyle
      && hierarchyLevel(heading) != null && hierarchyLevel(body) == null
      && Math.abs(heading.paragraph_indents_pt.left - body.paragraph_indents_pt.left) <= 0.5) transitionCount += 1;
  }
  if (transitionCount < 2) return false;
  return !validateStructuralInsertions(nodes, contexts).some((diagnostic) =>
    diagnostic.code === 'BONDED_PARAGRAPH_PAIR_REQUIRED'
    || diagnostic.code === 'BONDED_PARAGRAPH_PAIR_AMBIGUOUS'
    || diagnostic.code === 'RUN_IN_PAIR_ORDER');
}
