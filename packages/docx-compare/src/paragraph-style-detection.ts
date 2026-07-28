import type {
  ComparisonUnitAtom,
  ParagraphStyleChangeInfo,
} from '@usejunior/docx-core';
import {
  CorrelationStatus,
  childElements,
  findChildByTagName,
} from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphOf(atom: ComparisonUnitAtom): Element | null {
  if (atom.sourceParagraphElement) return atom.sourceParagraphElement;
  for (let index = atom.ancestorElements.length - 1; index >= 0; index--) {
    const ancestor = atom.ancestorElements[index]!;
    if (ancestor.tagName === 'w:p') return ancestor;
  }
  return null;
}

function paragraphAtoms(
  atoms: readonly ComparisonUnitAtom[],
): Map<Element, ComparisonUnitAtom[]> {
  const result = new Map<Element, ComparisonUnitAtom[]>();
  for (const atom of atoms) {
    const paragraph = paragraphOf(atom);
    if (!paragraph) continue;
    const group = result.get(paragraph) ?? [];
    group.push(atom);
    result.set(paragraph, group);
  }
  return result;
}

function directStyleValue(pPr: Element | null): string | null {
  if (!pPr) return null;
  const style = childElements(pPr).find(
    (child) => child.namespaceURI === W_NS && child.localName === 'pStyle',
  );
  if (!style) return null;
  return style.getAttributeNS(W_NS, 'val') ?? style.getAttribute('w:val');
}

/**
 * Detect direct `w:pStyle` changes once per fully aligned paragraph.
 *
 * Detection deliberately leaves atom correlation statuses unchanged. A
 * paragraph property revision is one revision even when its text spans many
 * atoms, and empty paragraphs use the same inventory as non-empty paragraphs.
 */
export function detectParagraphStyleChanges(
  originalAtoms: readonly ComparisonUnitAtom[],
  revisedAtoms: readonly ComparisonUnitAtom[],
  tracked: boolean,
): ParagraphStyleChangeInfo[] {
  const originalByParagraph = paragraphAtoms(originalAtoms);
  const revisedByParagraph = paragraphAtoms(revisedAtoms);
  const changes: ParagraphStyleChangeInfo[] = [];

  for (const revisedGroup of revisedByParagraph.values()) {
    if (
      revisedGroup.length === 0 ||
      revisedGroup.some(
        (atom) =>
          atom.correlationStatus !== CorrelationStatus.Equal ||
          !atom.comparisonUnitAtomBefore,
      )
    ) {
      continue;
    }

    const originalParagraphs = new Set(
      revisedGroup.map((atom) => paragraphOf(atom.comparisonUnitAtomBefore!)),
    );
    if (originalParagraphs.size !== 1) continue;
    const originalParagraph = [...originalParagraphs][0];
    if (!originalParagraph) continue;

    const originalGroup = originalByParagraph.get(originalParagraph);
    if (
      !originalGroup ||
      originalGroup.length !== revisedGroup.length ||
      originalGroup.some((atom) => atom.correlationStatus !== CorrelationStatus.Equal)
    ) {
      continue;
    }

    const matchedOriginalAtoms = new Set(
      revisedGroup.map((atom) => atom.comparisonUnitAtomBefore!),
    );
    if (matchedOriginalAtoms.size !== originalGroup.length) continue;

    const revisedParagraph = paragraphOf(revisedGroup[0]!);
    if (!revisedParagraph) continue;
    const oldPPr = findChildByTagName(originalParagraph, 'w:pPr');
    const newPPr = findChildByTagName(revisedParagraph, 'w:pPr');
    if (directStyleValue(oldPPr) === directStyleValue(newPPr)) continue;

    const change: ParagraphStyleChangeInfo = {
      oldParagraphProperties: oldPPr,
      newParagraphProperties: newPPr,
      tracked,
    };
    for (const atom of originalGroup) atom.paragraphStyleChange = change;
    for (const atom of revisedGroup) atom.paragraphStyleChange = change;
    changes.push(change);
  }

  return changes;
}
