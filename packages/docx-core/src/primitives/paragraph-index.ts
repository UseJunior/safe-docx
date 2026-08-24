import { OOXML, W } from './namespaces.js';
import { getAttributeSafe } from './xml-helpers.js';

export type ParagraphNodeKind =
  | 'run'
  | 'text'
  | 'tab'
  | 'break'
  | 'comment-range-start'
  | 'comment-range-end'
  | 'comment-reference'
  | 'footnote-reference'
  | 'field-code'
  | 'bookmark'
  | 'other';

export type IndexedParagraphNode = {
  element: Element;
  structuralIndex: number;
  runIndex: number | null;
  runVisibleOffset: number;
  visibleStart: number;
  visibleEnd: number;
  kind: ParagraphNodeKind;
  visibleText: string;
  isFieldResult: boolean;
  fieldResultId: number | null;
  fieldInstruction: string | null;
};

export type ParagraphIndex = {
  paragraph: Element;
  text: string;
  nodes: IndexedParagraphNode[];
  runs: IndexedParagraphNode[];
};

type FieldFrame = { id: number; phase: 'instruction' | 'result'; instruction: string };

function wordAttr(element: Element, localName: string): string | null {
  return getAttributeSafe(element, OOXML.W_NS, localName, 'w');
}

function kindOf(element: Element): ParagraphNodeKind {
  if (element.namespaceURI !== OOXML.W_NS) return 'other';
  switch (element.localName) {
    case W.r: return 'run';
    case W.t: return 'text';
    case W.tab: return 'tab';
    case W.br: return 'break';
    case W.commentRangeStart: return 'comment-range-start';
    case W.commentRangeEnd: return 'comment-range-end';
    case W.commentReference: return 'comment-reference';
    case W.footnoteReference: return 'footnote-reference';
    case W.fldChar:
    case W.instrText:
    case 'delInstrText': return 'field-code';
    case 'bookmarkStart':
    case 'bookmarkEnd': return 'bookmark';
    default: return 'other';
  }
}

/**
 * Build the canonical structural and visible-coordinate index for one
 * WordprocessingML paragraph. Every descendant run and marker receives a
 * structural coordinate; field instruction text remains zero-width while
 * cached field results participate in visible coordinates.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @see https://github.com/UseJunior/safe-docx/issues/904
 */
export function buildParagraphIndex(paragraph: Element): ParagraphIndex {
  const nodes: IndexedParagraphNode[] = [];
  const runs: IndexedParagraphNode[] = [];
  const fieldStack: FieldFrame[] = [];
  const instructions = new Map<number, string>();
  let nextFieldId = 1;
  let structuralIndex = 0;
  let visibleOffset = 0;
  let runIndex = -1;

  const currentResultId = (): number | null => {
    if (fieldStack.length === 0 || fieldStack.some((frame) => frame.phase === 'instruction')) return null;
    return fieldStack.at(-1)!.id;
  };

  const visit = (element: Element, containingRun: IndexedParagraphNode | null): void => {
    if (element !== paragraph && element.namespaceURI === OOXML.W_NS && element.localName === W.p) return;
    const isRun = element.namespaceURI === OOXML.W_NS && element.localName === W.r;
    let activeRun = containingRun;
    if (isRun) {
      runIndex += 1;
      activeRun = {
        element,
        structuralIndex: structuralIndex++,
        runIndex,
        runVisibleOffset: 0,
        visibleStart: visibleOffset,
        visibleEnd: visibleOffset,
        kind: 'run',
        visibleText: '',
        isFieldResult: false,
        fieldResultId: null,
        fieldInstruction: null,
      };
      nodes.push(activeRun);
      runs.push(activeRun);
    } else if (element !== paragraph) {
      const node: IndexedParagraphNode = {
        element,
        structuralIndex: structuralIndex++,
        runIndex: activeRun?.runIndex ?? null,
        runVisibleOffset: activeRun ? visibleOffset - activeRun.visibleStart : 0,
        visibleStart: visibleOffset,
        visibleEnd: visibleOffset,
        kind: kindOf(element),
        visibleText: '',
        isFieldResult: false,
        fieldResultId: null,
        fieldInstruction: null,
      };
      nodes.push(node);

      if (node.kind === 'field-code' && element.localName === W.fldChar) {
        const type = wordAttr(element, 'fldCharType') ?? '';
        if (type === 'begin') fieldStack.push({ id: nextFieldId++, phase: 'instruction', instruction: '' });
        else if (type === 'separate') {
          const frame = fieldStack.at(-1);
          if (frame) {
            frame.phase = 'result';
            instructions.set(frame.id, frame.instruction.trim());
          }
        } else if (type === 'end') fieldStack.pop();
      } else {
        const instructionFrame = [...fieldStack].reverse().find((frame) => frame.phase === 'instruction');
        if (instructionFrame && (element.localName === W.instrText || element.localName === 'delInstrText')) {
          instructionFrame.instruction += element.textContent ?? '';
        } else if (activeRun && !instructionFrame && (node.kind === 'text' || node.kind === 'tab' || node.kind === 'break')) {
          const text = node.kind === 'text' ? (element.textContent ?? '') : node.kind === 'tab' ? '\t' : '\n';
          const resultId = currentResultId();
          node.visibleText = text;
          node.visibleEnd += text.length;
          node.isFieldResult = resultId !== null;
          node.fieldResultId = resultId;
          visibleOffset += text.length;
          if (activeRun) {
            activeRun.visibleText += text;
            activeRun.visibleEnd = visibleOffset;
            activeRun.isFieldResult ||= resultId !== null;
            if (activeRun.visibleText.length === text.length) activeRun.fieldResultId = resultId;
            else if (activeRun.fieldResultId !== resultId) activeRun.fieldResultId = null;
          }
        }
      }
    }

    if (!isRun || activeRun) {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1) visit(child as Element, activeRun);
      }
    }
  };

  visit(paragraph, null);
  for (const node of nodes) {
    if (node.fieldResultId !== null) node.fieldInstruction = instructions.get(node.fieldResultId) ?? null;
  }
  return { paragraph, text: runs.map((run) => run.visibleText).join(''), nodes, runs };
}
