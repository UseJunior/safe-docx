import { OOXML, W } from './namespaces.js';

const WORD_NS = OOXML.W_NS;

export const REVISION_ID_ELEMENT_LOCAL_NAMES = new Set<string>([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'pPrChange',
  'rPrChange',
  'tblPrChange',
  'tblGridChange',
  'trPrChange',
  'tcPrChange',
  'sectPrChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'numberingChange',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
]);

type RevisionRule = {
  requiredAttrs: readonly string[];
  requiresAuthorMatch?: boolean;
  requiresDatePolicy?: boolean;
  allowEmpty?: boolean;
  range?: 'start' | 'end';
  pairWith?: string;
};

const TRACK_CHANGE_ATTRS = ['id', 'author'] as const;
const TRACK_CHANGE_WITH_DATE_ATTRS = ['id', 'author', 'date'] as const;
const MARKUP_ATTRS = ['id'] as const;
const MOVE_BOOKMARK_ATTRS = ['id', 'author', 'date', 'name'] as const;

export const REVISION_ELEMENT_RULES: Readonly<Record<string, RevisionRule>> = {
  ins: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  del: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  moveFrom: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  moveTo: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  pPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  rPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  tblPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  trPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  tcPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  sectPrChange: { requiredAttrs: TRACK_CHANGE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  cellIns: { requiredAttrs: TRACK_CHANGE_WITH_DATE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  cellDel: { requiredAttrs: TRACK_CHANGE_WITH_DATE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  cellMerge: { requiredAttrs: TRACK_CHANGE_WITH_DATE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  numberingChange: { requiredAttrs: TRACK_CHANGE_WITH_DATE_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true },
  tblGridChange: { requiredAttrs: MARKUP_ATTRS },
  moveFromRangeStart: { requiredAttrs: MOVE_BOOKMARK_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true, range: 'start', pairWith: 'moveFromRangeEnd', allowEmpty: true },
  moveToRangeStart: { requiredAttrs: MOVE_BOOKMARK_ATTRS, requiresAuthorMatch: true, requiresDatePolicy: true, range: 'start', pairWith: 'moveToRangeEnd', allowEmpty: true },
  moveFromRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'moveFromRangeStart', allowEmpty: true },
  moveToRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'moveToRangeStart', allowEmpty: true },
  customXmlInsRangeStart: { requiredAttrs: MARKUP_ATTRS, range: 'start', pairWith: 'customXmlInsRangeEnd', allowEmpty: true },
  customXmlInsRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'customXmlInsRangeStart', allowEmpty: true },
  customXmlDelRangeStart: { requiredAttrs: MARKUP_ATTRS, range: 'start', pairWith: 'customXmlDelRangeEnd', allowEmpty: true },
  customXmlDelRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'customXmlDelRangeStart', allowEmpty: true },
  customXmlMoveFromRangeStart: { requiredAttrs: MARKUP_ATTRS, range: 'start', pairWith: 'customXmlMoveFromRangeEnd', allowEmpty: true },
  customXmlMoveFromRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'customXmlMoveFromRangeStart', allowEmpty: true },
  customXmlMoveToRangeStart: { requiredAttrs: MARKUP_ATTRS, range: 'start', pairWith: 'customXmlMoveToRangeEnd', allowEmpty: true },
  customXmlMoveToRangeEnd: { requiredAttrs: MARKUP_ATTRS, range: 'end', pairWith: 'customXmlMoveToRangeStart', allowEmpty: true },
};

const BALANCED_RANGE_RULES: ReadonlyArray<{ start: string; end: string }> = [
  { start: 'moveFromRangeStart', end: 'moveFromRangeEnd' },
  { start: 'moveToRangeStart', end: 'moveToRangeEnd' },
  { start: 'commentRangeStart', end: 'commentRangeEnd' },
  { start: 'permStart', end: 'permEnd' },
  { start: 'customXmlInsRangeStart', end: 'customXmlInsRangeEnd' },
  { start: 'customXmlDelRangeStart', end: 'customXmlDelRangeEnd' },
  { start: 'customXmlMoveFromRangeStart', end: 'customXmlMoveFromRangeEnd' },
  { start: 'customXmlMoveToRangeStart', end: 'customXmlMoveToRangeEnd' },
];

const RANGE_END_LOCAL_NAMES = new Set(
  Object.entries(REVISION_ELEMENT_RULES)
    .filter(([, rule]) => rule.range === 'end')
    .map(([localName]) => localName),
);

export type RevisionValidationIssue = {
  code: string;
  message: string;
  fingerprint: string;
  context?: {
    partName?: string;
    element?: string;
    id?: number;
    markerId?: string;
    localName?: string;
  };
};

export type AiRevisionScope = {
  sessionStartId: number;
  sessionEndId?: number;
  expectedAuthor?: string | null;
};

export type RevisionValidationBaseline = {
  issueFingerprints: Set<string>;
  taintedMarkerIds: Set<string>;
};

export type RevisionValidationSeverity = {
  errors: RevisionValidationIssue[];
  warnings: RevisionValidationIssue[];
};

export class RevisionValidationError extends Error {
  readonly issues: RevisionValidationIssue[];

  constructor(issues: RevisionValidationIssue[]) {
    super(`AI-emitted revision validation failed with ${issues.length} error(s)`);
    this.name = 'RevisionValidationError';
    this.issues = issues;
  }
}

export type RevisionValidationPart = {
  partName: string;
  doc: Document;
};

function getWAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(WORD_NS, localName)
    ?? element.getAttribute(`w:${localName}`)
    ?? element.getAttribute(localName)
  );
}

function parseWId(element: Element): number | null {
  const raw = getWAttr(element, 'id');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasChildElement(element: Element): boolean {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) return true;
  }
  return false;
}

function hasAncestor(element: Element, localName: string): boolean {
  let current = element.parentNode;
  while (current && current.nodeType === 1) {
    const el = current as Element;
    if (el.namespaceURI === WORD_NS && el.localName === localName) return true;
    current = el.parentNode;
  }
  return false;
}

function isRevisionPropertyMark(element: Element): boolean {
  if (element.localName !== 'ins' && element.localName !== 'del' && element.localName !== 'moveFrom' && element.localName !== 'moveTo') {
    return false;
  }
  const parent = element.parentNode;
  if (!parent || parent.nodeType !== 1) return false;
  const parentElement = parent as Element;
  return parentElement.namespaceURI === WORD_NS && parentElement.localName === W.rPr;
}

function issue(
  code: string,
  message: string,
  context: NonNullable<RevisionValidationIssue['context']>,
): RevisionValidationIssue {
  const subject = context.id !== undefined
    ? `id=${context.id}`
    : context.markerId !== undefined
      ? `marker=${context.markerId}`
      : context.element ?? context.localName ?? 'document';
  return {
    code,
    message,
    fingerprint: `${context.partName ?? '?'}:${code}:${subject}`,
    context,
  };
}

function getElements(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagName('*'));
}

function validateRevisionElements(part: RevisionValidationPart, scope?: AiRevisionScope): RevisionValidationIssue[] {
  const issues: RevisionValidationIssue[] = [];
  const seenUniqueIds = new Map<number, string>();

  for (const element of getElements(part.doc)) {
    if (element.namespaceURI && element.namespaceURI !== WORD_NS) continue;
    const localName = element.localName ?? '';
    const rule = REVISION_ELEMENT_RULES[localName];
    if (!rule) continue;

    const id = parseWId(element);
    for (const attr of rule.requiredAttrs) {
      if (!getWAttr(element, attr)) {
        issues.push(issue('MISSING_REVISION_ATTR', `<w:${localName}> missing w:${attr}`, {
          partName: part.partName,
          element: `w:${localName}`,
          id: id ?? undefined,
          localName,
        }));
      }
    }

    if (scope && id !== null && id >= scope.sessionStartId) {
      if (rule.requiresAuthorMatch && scope.expectedAuthor && getWAttr(element, 'author') !== scope.expectedAuthor) {
        issues.push(issue('REVISION_AUTHOR_MISMATCH', `<w:${localName}> author does not match AI author`, {
          partName: part.partName,
          element: `w:${localName}`,
          id,
          localName,
        }));
      }
      if (rule.requiresDatePolicy && !getWAttr(element, 'date')) {
        issues.push(issue('MISSING_AI_REVISION_DATE', `<w:${localName}> missing required AI emission w:date`, {
          partName: part.partName,
          element: `w:${localName}`,
          id,
          localName,
        }));
      }
    }

    if (!rule.allowEmpty && !isRevisionPropertyMark(element) && !hasChildElement(element)) {
      issues.push(issue('EMPTY_TRACKED_CHANGE', `<w:${localName}> has no child elements`, {
        partName: part.partName,
        element: `w:${localName}`,
        id: id ?? undefined,
        localName,
      }));
    }

    if (id !== null && !RANGE_END_LOCAL_NAMES.has(localName)) {
      const previous = seenUniqueIds.get(id);
      if (previous) {
        issues.push(issue('DUPLICATE_REVISION_ID', `w:id ${id} is reused by ${previous} and w:${localName}`, {
          partName: part.partName,
          element: `w:${localName}`,
          id,
          localName,
        }));
      } else {
        seenUniqueIds.set(id, `w:${localName}`);
      }
    }
  }

  return issues;
}

function validateBalancedRanges(part: RevisionValidationPart): RevisionValidationIssue[] {
  const issues: RevisionValidationIssue[] = [];

  for (const rule of BALANCED_RANGE_RULES) {
    const starts = new Set<string>();
    const ends = new Set<string>();

    for (const element of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, rule.start))) {
      const id = getWAttr(element, 'id');
      if (id) starts.add(id);
    }
    for (const element of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, rule.end))) {
      const id = getWAttr(element, 'id');
      if (id) ends.add(id);
    }

    for (const id of starts) {
      if (!ends.has(id)) {
        issues.push(issue('UNMATCHED_RANGE_START', `<w:${rule.start}> id ${id} has no matching <w:${rule.end}>`, {
          partName: part.partName,
          element: `w:${rule.start}`,
          markerId: id,
          localName: rule.start,
        }));
      }
    }
    for (const id of ends) {
      if (!starts.has(id)) {
        issues.push(issue('UNMATCHED_RANGE_END', `<w:${rule.end}> id ${id} has no matching <w:${rule.start}>`, {
          partName: part.partName,
          element: `w:${rule.end}`,
          markerId: id,
          localName: rule.end,
        }));
      }
    }
  }

  return issues;
}

function validateFieldStructure(part: RevisionValidationPart): RevisionValidationIssue[] {
  const issues: RevisionValidationIssue[] = [];
  let depth = 0;

  for (const fldChar of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, W.fldChar))) {
    const type = getWAttr(fldChar, 'fldCharType');
    if (type === 'begin') {
      depth++;
    } else if (type === 'end') {
      depth--;
      if (depth < 0) {
        issues.push(issue('UNMATCHED_FIELD_END', 'fldChar end appears before a matching begin', {
          partName: part.partName,
          element: 'w:fldChar',
          markerId: 'field',
          localName: W.fldChar,
        }));
        depth = 0;
      }
    }
  }

  if (depth > 0) {
    issues.push(issue('UNMATCHED_FIELD_BEGIN', `${depth} fldChar begin marker(s) have no matching end`, {
      partName: part.partName,
      element: 'w:fldChar',
      markerId: 'field',
      localName: W.fldChar,
    }));
  }

  return issues;
}

function validateElementTypeRules(part: RevisionValidationPart): RevisionValidationIssue[] {
  const issues: RevisionValidationIssue[] = [];

  for (const text of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, W.t))) {
    if (hasAncestor(text, 'del')) {
      issues.push(issue('TEXT_IN_DELETION', '<w:t> is not valid inside <w:del>; use <w:delText>', {
        partName: part.partName,
        element: 'w:t',
        localName: W.t,
      }));
    }
  }

  for (const localName of ['delText', 'delInstrText']) {
    for (const text of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, localName))) {
      if (!hasAncestor(text, 'del')) {
        issues.push(issue('DELETION_TEXT_OUTSIDE_DELETION', `<w:${localName}> appears outside <w:del>`, {
          partName: part.partName,
          element: `w:${localName}`,
          localName,
        }));
      }
    }
  }

  for (const instr of Array.from(part.doc.getElementsByTagNameNS(WORD_NS, 'instrText'))) {
    if (hasAncestor(instr, 'del')) {
      issues.push(issue('INSTRUCTION_TEXT_IN_DELETION', '<w:instrText> is not valid inside <w:del>; use <w:delInstrText>', {
        partName: part.partName,
        element: 'w:instrText',
        localName: 'instrText',
      }));
    }
  }

  return issues;
}

export function validateRevisions(
  parts: RevisionValidationPart[],
  scope?: AiRevisionScope,
): RevisionValidationIssue[] {
  const issues: RevisionValidationIssue[] = [];
  for (const part of parts) {
    issues.push(
      ...validateRevisionElements(part, scope),
      ...validateBalancedRanges(part),
      ...validateFieldStructure(part),
      ...validateElementTypeRules(part),
    );
  }
  return issues;
}

export function createRevisionValidationBaseline(issues: RevisionValidationIssue[]): RevisionValidationBaseline {
  const issueFingerprints = new Set<string>();
  const taintedMarkerIds = new Set<string>();
  for (const validationIssue of issues) {
    issueFingerprints.add(validationIssue.fingerprint);
    const marker = validationIssue.context?.markerId ?? (
      validationIssue.context?.id !== undefined ? String(validationIssue.context.id) : undefined
    );
    if (marker) taintedMarkerIds.add(marker);
  }
  return { issueFingerprints, taintedMarkerIds };
}

export function partitionRevisionValidationIssues(
  issues: RevisionValidationIssue[],
  scope?: AiRevisionScope,
  baseline?: RevisionValidationBaseline | null,
): RevisionValidationSeverity {
  const errors: RevisionValidationIssue[] = [];
  const warnings: RevisionValidationIssue[] = [];

  for (const validationIssue of issues) {
    const id = validationIssue.context?.id;
    if (scope && id !== undefined) {
      if (id >= scope.sessionStartId && (scope.sessionEndId === undefined || id < scope.sessionEndId)) {
        errors.push(validationIssue);
      } else {
        warnings.push(validationIssue);
      }
      continue;
    }

    const markerId = validationIssue.context?.markerId;
    if (scope && markerId && /^\d+$/.test(markerId)) {
      const numericMarkerId = Number.parseInt(markerId, 10);
      if (numericMarkerId >= scope.sessionStartId && (scope.sessionEndId === undefined || numericMarkerId < scope.sessionEndId)) {
        errors.push(validationIssue);
        continue;
      }
    }

    if (baseline) {
      const tainted = markerId ? baseline.taintedMarkerIds.has(markerId) : false;
      if (!tainted && !baseline.issueFingerprints.has(validationIssue.fingerprint)) {
        errors.push(validationIssue);
      } else {
        warnings.push(validationIssue);
      }
      continue;
    }

    warnings.push(validationIssue);
  }

  return { errors, warnings };
}

export function assertValidAiRevisions(
  parts: RevisionValidationPart[],
  scope: AiRevisionScope,
  baseline?: RevisionValidationBaseline | null,
): void {
  const severity = partitionRevisionValidationIssues(validateRevisions(parts, scope), scope, baseline);
  if (severity.errors.length > 0) {
    throw new RevisionValidationError(severity.errors);
  }
}
