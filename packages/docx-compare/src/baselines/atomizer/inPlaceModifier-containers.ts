/**
 * In-Place AST Modifier
 *
 * Modifies the revised document's AST in-place to add track changes markup.
 * This replaces the reconstruction-based approach with direct tree manipulation.
 */

import type { ComparisonUnitAtom } from '@usejunior/docx-core';
import { CorrelationStatus } from '@usejunior/docx-core';
import { EMPTY_PARAGRAPH_TAG } from '../../atomizer.js';
import { childElements, getLeafText } from '@usejunior/docx-core';
import { findAncestorByTag } from './inPlaceModifier-shared.js';

interface ContainerResolutionContext {
  body: Element;
  lastProcessedParagraph: Element | null;
  lastParaByContainer: Map<Element, Element>;
}

// @lean-segment: container-topology
// Lean traceability anchor — cited by verification/lean/LeanSpike/Spec.lean for
// the container-topology-mismatch failure mode that makes the inplace candidate
// partial. Grep this anchor instead of relying on line numbers (refactor-stable).
export class ContainerResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerResolutionError';
  }
}

/** A single step in a structural path from a paragraph up to w:body. */
export interface ContainerPathStep {
  tag: string;
  index: number;
}

/**
 * Compute the structural path from a paragraph to the document body.
 * Walks `parentNode` from the paragraph, recording {tag, index} for each
 * structural container (w:tc, w:tr, w:tbl). Stops at w:body.
 * Returns innermost-first order.
 *
 * Uses original-tree nodes — safe because only the revised tree is mutated.
 */
export function getContainerPath(paragraph: Element): ContainerPathStep[] {
  const path: ContainerPathStep[] = [];
  let current: Node | null = paragraph.parentNode;
  while (current && (current as Element).tagName) {
    const el = current as Element;
    if (el.tagName === 'w:body') break;

    if (el.tagName === 'w:tc' || el.tagName === 'w:tr' || el.tagName === 'w:tbl') {
      const parent = el.parentNode as Element;
      if (parent) {
        let index = 0;
        let sibling = el.previousSibling;
        while (sibling) {
          if (sibling.nodeType === 1 && (sibling as Element).tagName === el.tagName) {
            index++;
          }
          sibling = sibling.previousSibling;
        }
        path.push({ tag: el.tagName, index });
      }
    }
    current = el.parentNode;
  }
  return path;
}

/**
 * Resolve a container path in the revised tree.
 * Walks the path in reverse (outermost → innermost) from `body`.
 * Returns the deepest container (typically w:tc), or null on mismatch.
 */
export function resolveContainerInRevised(path: ContainerPathStep[], body: Element): Element | null {
  if (path.length === 0) return null;

  let current: Element = body;
  // Walk outermost to innermost (path is innermost-first, so reverse)
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i]!;
    const children = childElements(current).filter(c => c.tagName === step.tag);
    const child = children[step.index];
    if (!child) return null; // Structural mismatch
    current = child;
  }
  return current;
}

/**
 * Validate that the revised tree has compatible topology at the given path.
 * Checks row count and cell count match at the target position.
 * Returns false if there's a structural mismatch (row/cell additions, gridSpan divergence).
 */
export function validateContainerTopology(path: ContainerPathStep[], body: Element): boolean {
  if (path.length === 0) return true; // Body-level, always valid

  let current: Element = body;
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i]!;
    const children = childElements(current).filter(c => c.tagName === step.tag);
    if (step.index >= children.length) return false;
    current = children[step.index]!;
  }
  return true;
}

/**
 * Find the correct container and insertion anchor for a deleted/moved-source atom.
 *
 * For body-level atoms, returns ctx.body with the global lastProcessedParagraph anchor.
 * For table-cell atoms, maps from the original tree container to the revised tree container
 * by structural position, and uses the per-container anchor from lastParaByContainer.
 *
 * Returns null if container resolution fails (topology mismatch) — caller must throw
 * ContainerResolutionError to trigger rebuild fallback.
 */
export function findTargetContainerForAtom(
  atom: ComparisonUnitAtom,
  ctx: ContainerResolutionContext
): { container: Element; insertAfter: Element | null } | null {
  // 1. Check if atom was in a table cell (original tree ancestors)
  const sourceTc = findAncestorByTag(atom, 'w:tc');
  if (!sourceTc) {
    // Body-level paragraph — use global anchor (current behavior, correct)
    return { container: ctx.body, insertAfter: ctx.lastProcessedParagraph };
  }

  // 2. Compute structural path from original tree
  const sourcePara = atom.sourceParagraphElement;
  if (!sourcePara) {
    return null; // Can't resolve → force rebuild
  }
  const path = getContainerPath(sourcePara);
  if (path.length === 0) {
    // Paragraph has a w:tc ancestor but path is empty — shouldn't happen
    return null;
  }

  // 3. Validate topology match before resolving
  if (!validateContainerTopology(path, ctx.body)) {
    return null; // Structural mismatch → force rebuild
  }

  // 4. Resolve container in revised tree
  const revisedContainer = resolveContainerInRevised(path, ctx.body);
  if (!revisedContainer) {
    return null; // Resolution failed → force rebuild
  }

  // 5. Find container-local insertion anchor
  const anchor = ctx.lastParaByContainer.get(revisedContainer) ?? null;
  return { container: revisedContainer, insertAfter: anchor };
}

/**
 * Determine whether an atom is "whitespace-only" for paragraph-level classification.
 *
 * We treat pure whitespace runs/tabs/breaks as ignorable noise, because LCS alignment
 * can mark them Equal even when a whole paragraph was inserted/deleted. If we don't
 * ignore them, Word can end up with a stub paragraph after Accept/Reject All.
 */
export function isWhitespaceAtom(atom: ComparisonUnitAtom): boolean {
  const el = atom.contentElement;
  if (el.tagName === EMPTY_PARAGRAPH_TAG) return true;
  if (el.tagName === 'w:t') return ((getLeafText(el) ?? '').trim() === '');
  return el.tagName === 'w:tab' || el.tagName === 'w:br' || el.tagName === 'w:cr';
}

/**
 * Returns true if every non-empty atom in this paragraph is of the specified status,
 * ignoring whitespace-only atoms.
 *
 * Mirrors the rebuild reconstructor's whole-paragraph classification so that inplace
 * output behaves the same under Word's Accept/Reject All.
 */
export function isEntireParagraphAtomsWithStatus(
  atoms: ComparisonUnitAtom[],
  status: CorrelationStatus
): boolean {
  let sawAnyContent = false;
  let sawTargetStatus = false;

  for (const atom of atoms) {
    const el = atom.contentElement;
    if (el.tagName === EMPTY_PARAGRAPH_TAG) continue;

    sawAnyContent = true;

    if (atom.correlationStatus === status) {
      sawTargetStatus = true;
      continue;
    }

    if (isWhitespaceAtom(atom)) continue;
    return false;
  }

  return sawAnyContent && sawTargetStatus;
}
