import { parseXml } from '../primitives/xml.js';
import { OOXML } from '../primitives/namespaces.js';

export interface FieldStory {
  label: string;
  xml: string;
}

export type FieldStructureIssue = {
  code: string;
  message: string;
  story?: string;
  element?: string;
};

function isW(el: Element, localName: string): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function allW(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(OOXML.W_NS, localName)) as Element[];
}

export function hasFldCharInsideDel(documentXml: string): boolean {
  const root = parseXml(documentXml).documentElement;
  let insideDelDepth = 0;
  let violation = false;

  function scan(node: Element): void {
    if (violation) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (isW(el, 'del')) {
        insideDelDepth++;
        scan(el);
        insideDelDepth--;
        if (violation) return;
        continue;
      }
      if (isW(el, 'fldChar') && insideDelDepth > 0) {
        violation = true;
        return;
      }
      scan(el);
    }
  }

  scan(root);
  return violation;
}

export function collectFieldStructureIssues(input: string | FieldStory[]): FieldStructureIssue[] {
  if (typeof input === 'string') {
    return collectFieldStructureIssuesForStory(input, 'document');
  }

  const issues: FieldStructureIssue[] = [];
  for (const story of input) {
    issues.push(...collectFieldStructureIssuesForStory(story.xml, story.label));
  }
  return issues;
}

/**
 * Text-placement rules added for the AI revision validator. They are NOT part
 * of `validateFieldStructure`: that boolean is pinned extensionally against
 * the Lean model (`Tier2.FieldStructure.validateFieldStructure`) by the Lean
 * differential harness, so its rule set must not grow.
 */
const TEXT_PLACEMENT_ISSUE_CODES = new Set([
  'TEXT_INSIDE_DELETION',
  'DELETED_TEXT_OUTSIDE_DELETION',
]);

export function validateFieldStructure(input: string | FieldStory[]): boolean {
  return collectFieldStructureIssues(input)
    .filter((issue) => !TEXT_PLACEMENT_ISSUE_CODES.has(issue.code))
    .length === 0;
}

function collectFieldStructureIssuesForStory(documentXml: string, story: string): FieldStructureIssue[] {
  const issues: FieldStructureIssue[] = [];
  const root = parseXml(documentXml).documentElement;

  const allFldChars = allW(root, 'fldChar');
  const allInstrTexts = allW(root, 'instrText');
  const allDelInstrTexts = allW(root, 'delInstrText');
  const allText = allW(root, 't');

  let begins = 0;
  let ends = 0;
  for (const fc of allFldChars) {
    const type = getWAttr(fc, 'fldCharType');
    if (type === 'begin') begins++;
    else if (type === 'end') ends++;
  }
  if (begins !== ends) {
    issues.push({
      code: 'FIELD_BEGIN_END_MISMATCH',
      message: `Field begin/end count mismatch in ${story}: begin=${begins}, end=${ends}`,
      story,
      element: 'w:fldChar',
    });
  }

  if (
    allFldChars.length === 0 &&
    allInstrTexts.length === 0 &&
    allDelInstrTexts.length === 0 &&
    allText.length === 0
  ) {
    return issues;
  }

  let depth = 0;
  const pastSeparatorAtDepth: number[] = [];
  let insideDelDepth = 0;
  // Move-sources (w:moveFrom) carry deletion-flavored content (w:delText)
  // per the OOXML revision model; the text-placement rules treat them as
  // deletion contexts. The Lean-pinned field rules above use only w:del.
  let insideMoveFromDepth = 0;

  function push(code: string, message: string, element: string): void {
    issues.push({ code, message, story, element });
  }

  function scan(node: Element): void {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;

      if (isW(el, 'del')) {
        insideDelDepth++;
        scan(el);
        insideDelDepth--;
        continue;
      }

      if (isW(el, 'moveFrom')) {
        insideMoveFromDepth++;
        scan(el);
        insideMoveFromDepth--;
        continue;
      }

      if (isW(el, 'fldChar')) {
        if (insideDelDepth > 0) {
          push('FIELD_CHAR_INSIDE_DELETION', 'w:fldChar must not appear inside w:del', 'w:fldChar');
        }
        const type = getWAttr(el, 'fldCharType');
        if (type === 'begin') {
          depth++;
          pastSeparatorAtDepth[depth] = 0;
        } else if (type === 'separate') {
          if (depth > 0) pastSeparatorAtDepth[depth] = 1;
        } else if (type === 'end') {
          if (depth > 0) depth--;
        }
      } else if (isW(el, 'instrText')) {
        if (depth === 0 || pastSeparatorAtDepth[depth]) {
          push('INSTRUCTION_TEXT_OUTSIDE_FIELD_CODE', 'w:instrText must appear inside an open field code region', 'w:instrText');
        }
      } else if (isW(el, 'delInstrText')) {
        if (insideDelDepth === 0) {
          push('DELETED_INSTRUCTION_TEXT_OUTSIDE_DELETION', 'w:delInstrText must appear inside w:del', 'w:delInstrText');
        }
        if (depth === 0 || pastSeparatorAtDepth[depth]) {
          push('DELETED_INSTRUCTION_TEXT_OUTSIDE_FIELD_CODE', 'w:delInstrText must appear inside an open field code region', 'w:delInstrText');
        }
      } else if (isW(el, 't') && (insideDelDepth > 0 || insideMoveFromDepth > 0)) {
        push('TEXT_INSIDE_DELETION', 'w:t must not appear inside w:del or w:moveFrom; use w:delText', 'w:t');
      } else if (isW(el, 'delText') && insideDelDepth === 0 && insideMoveFromDepth === 0) {
        push('DELETED_TEXT_OUTSIDE_DELETION', 'w:delText must appear inside w:del or w:moveFrom', 'w:delText');
      }

      scan(el);
    }
  }

  scan(root);
  return issues;
}
