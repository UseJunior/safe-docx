import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';
import { extractRoundTripComparisonText } from '../../fieldComparisonSemantics.js';
import { constructTaggedTree, verifyGlobalEqualContentInvariant } from './taggedTreeConstruction.js';
import { createPreservePlan, serializeTaggedTree, verifySerializedMoveRanges } from './taggedTreeSerializer.js';
import { formatDate } from './inPlaceModifier-shared.js';
import { suppressVolatileTocPagerefCacheRevisions } from './tocPagerefCache.js';

export type TaggedTreeDivergenceClass = 'projection-inequivalent' | 'projection-equivalent';

export interface TaggedTreeShadowReport {
  fixtureIdentity: string;
  classification: TaggedTreeDivergenceClass;
  divergingProjections: Array<'accept' | 'reject' | 'formatting'>;
  fidelityScore: number;
  legacyOutputUnchanged: true;
  diagnostics: string[];
}

export interface TaggedTreeShadowInput {
  originalXml: string;
  revisedXml: string;
  legacyXml: string;
  author: string;
  date: Date;
  fixtureIdentity?: string;
  detectFormatChanges?: boolean;
  detectMoves?: boolean;
}

export function buildTaggedTreeShadowXml(input: Omit<TaggedTreeShadowInput, 'legacyXml'>): string {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  const constructed = constructTaggedTree(original, revised, {
    detectFormatChanges: input.detectFormatChanges,
    detectMoves: input.detectMoves,
  });
  const serialized = serializeTaggedTree(
    constructed.tree,
    createPreservePlan(original, revised, constructed.tree, {
      author: input.author,
      date: formatDate(input.date),
    }),
    { moves: constructed.moves },
  );
  const document = parseXml(serialized);
  for (const wrapper of Array.from(document.getElementsByTagName('*'))) {
    if (!['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'].includes(wrapper.tagName)) continue;
    if (
      wrapper.childNodes.length === 0 &&
      (wrapper.parentNode as Element | null)?.localName !== 'rPr'
    ) wrapper.parentNode?.removeChild(wrapper);
  }
  return suppressVolatileTocPagerefCacheRevisions(
    new XMLSerializer().serializeToString(document),
  );
}

/** Count the direct-property revisions represented by tagged construction. */
export function countTaggedTreePropertyDeltas(
  input: Pick<TaggedTreeShadowInput, 'originalXml' | 'revisedXml' | 'detectFormatChanges' | 'detectMoves'>,
): number {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  const { tree } = constructTaggedTree(original, revised, {
    detectFormatChanges: input.detectFormatChanges,
    detectMoves: input.detectMoves,
  });
  let count = 0;
  const visit = (node: typeof tree): void => {
    if (node.tag === 'both' && node.propertyDelta) count++;
    node.children.forEach((child) => visit(child as typeof tree));
  };
  visit(tree);
  return count;
}

function text(xml: string): string {
  // Use the same field/cache-aware observable as the authoritative safety gate.
  return extractRoundTripComparisonText(xml);
}

function textMismatch(label: string, expected: string, actual: string): string {
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index++;
  return `${label} text differs at ${index} (expected length ${expected.length}, actual length ${actual.length})`;
}

function identity(input: TaggedTreeShadowInput): string {
  return input.fixtureIdentity ?? createHash('sha256')
    .update(input.originalXml)
    .update('\0')
    .update(input.revisedXml)
    .digest('hex')
    .slice(0, 24);
}

/** Evaluate tagged construction offline against a caller-supplied legacy candidate. */
export function runTaggedTreeShadow(input: TaggedTreeShadowInput): TaggedTreeShadowReport {
  const original = parseXml(input.originalXml).documentElement;
  const revised = parseXml(input.revisedXml).documentElement;
  const constructed = constructTaggedTree(original, revised, {
    detectFormatChanges: input.detectFormatChanges,
    detectMoves: input.detectMoves,
  });
  const diagnostics = verifyGlobalEqualContentInvariant(constructed.tree, constructed.moves);
  const shadowXml = buildTaggedTreeShadowXml(input);
  diagnostics.push(...verifySerializedMoveRanges(shadowXml, constructed.moves));

  const expectedAccept = text(acceptAllChanges(input.revisedXml));
  const expectedReject = text(rejectAllChanges(input.originalXml));
  const shadowAccept = text(acceptAllChanges(shadowXml));
  const shadowReject = text(rejectAllChanges(shadowXml));
  const divergingProjections: TaggedTreeShadowReport['divergingProjections'] = [];
  if (shadowAccept !== expectedAccept) {
    divergingProjections.push('accept');
    diagnostics.push(textMismatch('accept', expectedAccept, shadowAccept));
  }
  if (shadowReject !== expectedReject) {
    divergingProjections.push('reject');
    diagnostics.push(textMismatch('reject', expectedReject, shadowReject));
  }

  const fidelity = compareSourceProjectedFormattingFidelity(input.originalXml, input.revisedXml, shadowXml);
  if (fidelity.score !== 1) {
    divergingProjections.push('formatting');
    for (const [projection, report] of [['accept', fidelity.accept], ['reject', fidelity.reject]] as const) {
      for (const divergence of report.divergences.slice(0, 10)) {
        diagnostics.push(
          `${projection} formatting ${divergence.scope}/${divergence.property}/${divergence.kind} at paragraph ${divergence.paragraphIndex}`,
        );
      }
    }
  }
  return {
    fixtureIdentity: identity(input),
    classification: diagnostics.length > 0 || divergingProjections.length > 0
      ? 'projection-inequivalent'
      : 'projection-equivalent',
    divergingProjections,
    fidelityScore: fidelity.score,
    legacyOutputUnchanged: true,
    diagnostics,
  };
}
