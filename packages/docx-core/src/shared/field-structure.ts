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

export interface FieldTrackerOptions {
  /**
   * If true, records structural issues on stray, duplicate, or unclosed field markers,
   * or misplaced instruction text. If false (tolerant mode), recovers gracefully without recording issues.
   */
  strict?: boolean;
  story?: string;
  onIssue?: (issue: FieldStructureIssue) => void;
}

/**
 * Shared stack machinery tracking nested complex-field state transitions across document order.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
export class FieldTracker {
  private separators: boolean[] = [];
  readonly strict: boolean;
  readonly story: string;
  private readonly onIssue?: (issue: FieldStructureIssue) => void;

  constructor(options: FieldTrackerOptions = {}) {
    this.strict = options.strict ?? false;
    this.story = options.story ?? 'document';
    this.onIssue = options.onIssue;
  }

  get depth(): number {
    return this.separators.length;
  }

  get isInsideField(): boolean {
    return this.separators.length > 0;
  }

  /**
   * Returns true when the traversal is currently inside an open field's code / instruction
   * region (i.e. at least one enclosing open field has not passed its separator).
   */
  isInsideFieldCode(): boolean {
    for (let i = 0; i < this.separators.length; i++) {
      if (!this.separators[i]) return true;
    }
    return false;
  }

  /**
   * Returns true when the traversal is inside a field result region (depth > 0 and all
   * open field levels have passed their separator).
   */
  isInsideFieldResult(): boolean {
    return this.separators.length > 0 && !this.isInsideFieldCode();
  }

  /**
   * True if run text (w:t, w:tab, w:br) at this location is visible in reading output.
   * Invisible if inside any enclosing field's instruction code.
   */
  isTextVisible(): boolean {
    return !this.isInsideFieldCode();
  }

  /**
   * Advance tracker on encountering a w:fldChar element or its fldCharType attribute.
   */
  advanceFieldChar(fldCharType: string | null | undefined, element: string = 'w:fldChar'): void {
    if (fldCharType === 'begin') {
      this.separators.push(false);
    } else if (fldCharType === 'separate') {
      if (this.separators.length === 0) {
        if (this.strict) {
          this.report(
            'FIELD_STRAY_SEPARATOR',
            `Field separator appears outside an open field in ${this.story}`,
            element,
          );
        }
      } else {
        const depthIndex = this.separators.length - 1;
        if (this.separators[depthIndex]) {
          if (this.strict) {
            this.report(
              'FIELD_DUPLICATE_SEPARATOR',
              `Field at depth ${this.separators.length} has more than one separator in ${this.story}`,
              element,
            );
          }
        } else {
          this.separators[depthIndex] = true;
        }
      }
    } else if (fldCharType === 'end') {
      if (this.separators.length === 0) {
        if (this.strict) {
          this.report(
            'FIELD_STRAY_END',
            `Field end appears outside an open field in ${this.story}`,
            element,
          );
        }
      } else {
        this.separators.pop();
      }
    } else {
      if (this.strict) {
        this.report(
          'FIELD_UNKNOWN_CHAR_TYPE',
          `w:fldChar has missing or unknown w:fldCharType '${fldCharType ?? '(missing)'}' in ${this.story}`,
          element,
        );
      }
    }
  }

  /**
   * Check w:instrText placement. In strict mode, w:instrText must appear inside an open field code region.
   */
  checkInstructionText(element: string = 'w:instrText'): void {
    if (!this.isInsideFieldCode()) {
      if (this.strict) {
        this.report(
          'INSTRUCTION_TEXT_OUTSIDE_FIELD_CODE',
          'w:instrText must appear inside an open field code region',
          element,
        );
      }
    }
  }

  /**
   * Finalize the story part. Reports any unclosed field depth in strict mode.
   */
  finishStory(): void {
    if (this.separators.length > 0 && this.strict) {
      this.report(
        'FIELD_UNCLOSED_DEPTH',
        `Field story ${this.story} ends with ${this.separators.length} unclosed field level(s)`,
        'w:fldChar',
      );
    }
  }

  /**
   * Reset the tracker stack to outside of all fields (e.g. at story boundaries).
   */
  reset(): void {
    this.separators = [];
  }

  private report(code: string, message: string, element: string): void {
    this.onIssue?.({
      code,
      message,
      story: this.story,
      element,
    });
  }
}

function isW(el: Element, localName: string): boolean {
  return el.namespaceURI === OOXML.W_NS && el.localName === localName;
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(OOXML.W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function allW(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(OOXML.W_NS, localName)) as Element[];
}

/**
 * @deprecated `w:fldChar` inside `<w:del>` is valid, so a `true` result is not a
 * defect. Word and Aspose both emit it. Retained only so existing callers keep
 * compiling; do not gate on it. See {@link collectFieldStructureIssues}.
 */
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

/**
 * Reports structural complex-field violations without evaluating field codes.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.22
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @ooxmlSpec ooxml.ecma376.5ed.part1.fields.complex-field-characters
 * @see https://github.com/UseJunior/safe-docx/issues/645
 * @see https://github.com/UseJunior/safe-docx/issues/941
 */
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
 * the comparison engine's validation model by the differential
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

function collectStrictStackIssuesForStory(xml: string, story: string): FieldStructureIssue[] {
  const root = parseXml(xml).documentElement;
  const issues: FieldStructureIssue[] = [];
  const tracker = new FieldTracker({
    strict: true,
    story,
    onIssue: (issue) => issues.push(issue),
  });

  function scan(node: Element): void {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (isW(element, 'fldChar')) {
        const type = getWAttr(element, 'fldCharType');
        tracker.advanceFieldChar(type);
      }
      scan(element);
    }
  }

  scan(root);
  tracker.finishStory();
  return issues;
}

/**
 * Reports strict runtime field-story violations without changing the
 * pinned `validateFieldStructure` predicate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
export function collectStrictFieldStructureIssues(
  input: string | FieldStory[],
): FieldStructureIssue[] {
  const stories = typeof input === 'string'
    ? [{ label: 'document', xml: input }]
    : input;
  const issues: FieldStructureIssue[] = [];
  for (const story of stories) {
    issues.push(...collectFieldStructureIssuesForStory(story.xml, story.label));
    issues.push(...collectStrictStackIssuesForStory(story.xml, story.label));
  }
  return issues;
}

export function validateStrictFieldStructure(input: string | FieldStory[]): boolean {
  return collectStrictFieldStructureIssues(input)
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

  const tracker = new FieldTracker({ strict: false, story });
  let insideDelDepth = 0;
  // Move sources may retain ordinary w:t. Continue accepting legacy delText
  // there, but only a true deletion requires deletion text vocabulary.
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
        // `w:fldChar` inside `<w:del>` is NOT a violation. The Transitional WML
        // schema reaches it (w:del -> CT_RunTrackChange -> EG_ContentRunContent
        // -> w:r -> EG_RunInnerContent), and Word 16.112 and Aspose.Words 25.10
        // both emit whole deleted fields that way on real input, producing
        // schema-valid output. The rule this once enforced (issue #217) came
        // from a research summary rather than the standard; enforcing it left
        // deleted fields as unrenderable husks. See insertWholeDeletedField.
        const type = getWAttr(el, 'fldCharType');
        tracker.advanceFieldChar(type);
      } else if (isW(el, 'instrText')) {
        if (!tracker.isInsideFieldCode()) {
          push('INSTRUCTION_TEXT_OUTSIDE_FIELD_CODE', 'w:instrText must appear inside an open field code region', 'w:instrText');
        }
      } else if (isW(el, 'delInstrText')) {
        if (insideDelDepth === 0) {
          push('DELETED_INSTRUCTION_TEXT_OUTSIDE_DELETION', 'w:delInstrText must appear inside w:del', 'w:delInstrText');
        }
        if (!tracker.isInsideFieldCode()) {
          push('DELETED_INSTRUCTION_TEXT_OUTSIDE_FIELD_CODE', 'w:delInstrText must appear inside an open field code region', 'w:delInstrText');
        }
      } else if (isW(el, 't') && insideDelDepth > 0) {
        push('TEXT_INSIDE_DELETION', 'w:t must not appear inside w:del; use w:delText', 'w:t');
      } else if (isW(el, 'delText') && insideDelDepth === 0 && insideMoveFromDepth === 0) {
        push('DELETED_TEXT_OUTSIDE_DELETION', 'w:delText must appear inside w:del or w:moveFrom', 'w:delText');
      }

      scan(el);
    }
  }

  scan(root);
  return issues;
}
