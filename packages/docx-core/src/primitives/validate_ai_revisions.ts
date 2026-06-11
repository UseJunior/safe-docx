import path from 'node:path';
import { parseXml, serializeXml } from './xml.js';
import { OOXML } from './namespaces.js';
import { DocxZip } from './zip.js';
import {
  REVISION_SIDE_PART_PATHS,
  REVISION_STORY_PART_PATHS,
} from './revision-parts.js';
import {
  REVISION_RANGE_ELEMENT_NAMES,
  TRACKED_CHANGE_ELEMENT_NAMES,
} from './revision-vocabulary.js';
import {
  collectFieldStructureIssues,
  type FieldStory,
} from '../shared/field-structure.js';

export type AiRevisionSeverity = 'error' | 'warning';

export type AiRevisionDiagnostic = {
  severity: AiRevisionSeverity;
  code: string;
  message: string;
  part?: string;
  element?: string;
  id?: string;
  author?: string | null;
};

export type ValidateAiRevisionsResult = {
  valid: boolean;
  errors: AiRevisionDiagnostic[];
  warnings: AiRevisionDiagnostic[];
};

export type AiRevisionValidationTouchedContext = {
  revisionIds?: Iterable<string | number>;
  rangeIds?: Iterable<string | number>;
  relationshipParts?: Iterable<string>;
  sideParts?: Iterable<string>;
};

export type AiRevisionStoryInput = {
  part: string;
  doc: Document;
};

export type ValidateAiRevisionsOptions = {
  aiAuthor: string;
  stories: AiRevisionStoryInput[];
  packageZip?: DocxZip;
  touched?: AiRevisionValidationTouchedContext;
};

const W_NS = OOXML.W_NS;
const REL_NS = OOXML.REL_NS;
const CT_NS = OOXML.CT_NS;
const FULL_REVISION_ATTRS = ['id', 'author', 'date'] as const;
const ID_ONLY_REVISION_ATTRS = ['id'] as const;

/**
 * Range-end milestones (OOXML CT_MarkupRange / CT_Markup) carry only w:id —
 * unlike their *RangeStart counterparts (OOXML CT_TrackChange / CT_Bookmark),
 * they have no w:author or w:date attribute.
 */
const ID_ONLY_REVISION_ELEMENT_NAMES = new Set<string>(
  REVISION_RANGE_ELEMENT_NAMES.filter((name) => name.endsWith('RangeEnd')),
);

const RANGE_PAIRS: Array<{ start: string; end: string }> = [
  { start: 'moveFromRangeStart', end: 'moveFromRangeEnd' },
  { start: 'moveToRangeStart', end: 'moveToRangeEnd' },
  { start: 'commentRangeStart', end: 'commentRangeEnd' },
  { start: 'permStart', end: 'permEnd' },
  { start: 'customXmlInsRangeStart', end: 'customXmlInsRangeEnd' },
  { start: 'customXmlDelRangeStart', end: 'customXmlDelRangeEnd' },
  { start: 'customXmlMoveFromRangeStart', end: 'customXmlMoveFromRangeEnd' },
  { start: 'customXmlMoveToRangeStart', end: 'customXmlMoveToRangeEnd' },
  { start: 'bookmarkStart', end: 'bookmarkEnd' },
];

const TRACKED_CHANGE_PLACEMENTS: Record<string, readonly string[]> = {
  cellIns: ['tcPr'],
  cellDel: ['tcPr'],
  cellMerge: ['tcPr'],
  tblGridChange: ['tblGrid'],
  sectPrChange: ['sectPr'],
  numberingChange: ['pPr', 'rPr'],
};

function toStringSet(values: Iterable<string | number> | undefined): Set<string> {
  const set = new Set<string>();
  if (!values) return set;
  for (const value of values) set.add(String(value));
  return set;
}

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`) ?? el.getAttribute(localName);
}

function allW(doc: Document | Element, localName: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, localName)) as Element[];
}

function parentLocalName(el: Element): string | null {
  let node = el.parentNode;
  while (node) {
    if (node.nodeType === 1) return (node as Element).localName;
    node = node.parentNode;
  }
  return null;
}

function classifyRevision(
  el: Element,
  aiAuthor: string,
  touchedRevisionIds: Set<string>,
): { severity: AiRevisionSeverity; author: string | null; id: string | null } {
  const author = getWAttr(el, 'author');
  const id = getWAttr(el, 'id');
  const isAi = author === aiAuthor || (id !== null && touchedRevisionIds.has(id));
  return { severity: isAi ? 'error' : 'warning', author, id };
}

function push(
  out: AiRevisionDiagnostic[],
  diagnostic: Omit<AiRevisionDiagnostic, 'severity'> & { severity: AiRevisionSeverity },
): void {
  out.push(diagnostic);
}

function isIntegerString(value: string | null): boolean {
  return value !== null && /^(?:0|[1-9]\d*)$/.test(value);
}

function isValidDate(value: string | null): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function checkRevisionMetadata(
  story: AiRevisionStoryInput,
  aiAuthor: string,
  touchedRevisionIds: Set<string>,
  diagnostics: AiRevisionDiagnostic[],
  aiIds: Map<string, string>,
): void {
  const names = [...TRACKED_CHANGE_ELEMENT_NAMES, ...REVISION_RANGE_ELEMENT_NAMES];
  for (const localName of names) {
    const idOnly = ID_ONLY_REVISION_ELEMENT_NAMES.has(localName);
    const requiredAttrs = idOnly ? ID_ONLY_REVISION_ATTRS : FULL_REVISION_ATTRS;
    for (const el of allW(story.doc, localName)) {
      const classified = classifyRevision(el, aiAuthor, touchedRevisionIds);
      for (const attr of requiredAttrs) {
        const value = getWAttr(el, attr);
        if (!value) {
          push(diagnostics, {
            severity: classified.severity,
            code: 'REVISION_METADATA_MISSING',
            message: `<w:${localName}> missing required w:${attr}`,
            part: story.part,
            element: `w:${localName}`,
            id: classified.id ?? undefined,
            author: classified.author,
          });
        }
      }

      const id = getWAttr(el, 'id');
      if (!isIntegerString(id)) {
        push(diagnostics, {
          severity: classified.severity,
          code: 'REVISION_ID_INVALID',
          message: `<w:${localName}> has non-integer w:id`,
          part: story.part,
          element: `w:${localName}`,
          id: id ?? undefined,
          author: classified.author,
        });
      }

      const date = getWAttr(el, 'date');
      if (!idOnly && !isValidDate(date)) {
        push(diagnostics, {
          severity: classified.severity,
          code: 'REVISION_DATE_INVALID',
          message: `<w:${localName}> has invalid w:date`,
          part: story.part,
          element: `w:${localName}`,
          id: id ?? undefined,
          author: classified.author,
        });
      }

      if (classified.severity === 'error' && id) {
        const previousPart = aiIds.get(id);
        if (previousPart && previousPart !== story.part) {
          push(diagnostics, {
            severity: 'error',
            code: 'AI_REVISION_ID_DUPLICATE',
            message: `AI revision w:id="${id}" appears in both ${previousPart} and ${story.part}`,
            part: story.part,
            element: `w:${localName}`,
            id,
            author: classified.author,
          });
        } else {
          aiIds.set(id, story.part);
        }
      }
    }
  }
}

function checkRangePairs(
  story: AiRevisionStoryInput,
  aiAuthor: string,
  touchedRangeIds: Set<string>,
  diagnostics: AiRevisionDiagnostic[],
): void {
  for (const pair of RANGE_PAIRS) {
    const starts = new Map<string, Element[]>();
    const ends = new Map<string, Element[]>();
    for (const start of allW(story.doc, pair.start)) {
      const id = getWAttr(start, 'id');
      if (!id) continue;
      const list = starts.get(id) ?? [];
      list.push(start);
      starts.set(id, list);
    }
    for (const end of allW(story.doc, pair.end)) {
      const id = getWAttr(end, 'id');
      if (!id) continue;
      const list = ends.get(id) ?? [];
      list.push(end);
      ends.set(id, list);
    }

    const ids = new Set([...starts.keys(), ...ends.keys()]);
    for (const id of ids) {
      const startCount = starts.get(id)?.length ?? 0;
      const endCount = ends.get(id)?.length ?? 0;
      if (startCount === endCount) continue;
      const representative = starts.get(id)?.[0] ?? ends.get(id)?.[0];
      const author = representative ? getWAttr(representative, 'author') : null;
      const severity: AiRevisionSeverity =
        author === aiAuthor || touchedRangeIds.has(id) ? 'error' : 'warning';
      push(diagnostics, {
        severity,
        code: 'RANGE_PAIR_UNBALANCED',
        message: `<w:${pair.start}>/<w:${pair.end}> pair id="${id}" is unbalanced`,
        part: story.part,
        element: `w:${pair.start}`,
        id,
        author,
      });
    }
  }
}

function checkFieldStructure(
  story: AiRevisionStoryInput,
  diagnostics: AiRevisionDiagnostic[],
): void {
  const fieldStory: FieldStory = { label: story.part, xml: serializeXml(story.doc) };
  for (const issue of collectFieldStructureIssues([fieldStory])) {
    push(diagnostics, {
      severity: 'error',
      code: issue.code,
      message: issue.message,
      part: story.part,
      element: issue.element,
    });
  }
}

function checkPlacement(
  story: AiRevisionStoryInput,
  aiAuthor: string,
  touchedRevisionIds: Set<string>,
  diagnostics: AiRevisionDiagnostic[],
): void {
  for (const [localName, allowedParents] of Object.entries(TRACKED_CHANGE_PLACEMENTS)) {
    for (const el of allW(story.doc, localName)) {
      const parent = parentLocalName(el);
      if (parent && allowedParents.includes(parent)) continue;
      const classified = classifyRevision(el, aiAuthor, touchedRevisionIds);
      push(diagnostics, {
        severity: classified.severity,
        code: 'REVISION_PLACEMENT_INVALID',
        message: `<w:${localName}> must appear under ${allowedParents.map((x) => `w:${x}`).join(' or ')}`,
        part: story.part,
        element: `w:${localName}`,
        id: classified.id ?? undefined,
        author: classified.author,
      });
    }
  }
}

function relsSourceBase(relsPath: string): string {
  if (relsPath === '_rels/.rels') return '';
  const marker = '/_rels/';
  const idx = relsPath.indexOf(marker);
  if (idx < 0) return path.posix.dirname(relsPath);
  return relsPath.slice(0, idx);
}

function resolveRelationshipTarget(relsPath: string, target: string): string {
  const base = relsSourceBase(relsPath);
  return path.posix.normalize(path.posix.join(base, target)).replace(/^\.\//, '');
}

async function checkPackageInvariants(
  zip: DocxZip,
  touchedRelationshipParts: Set<string>,
  touchedSideParts: Set<string>,
  diagnostics: AiRevisionDiagnostic[],
): Promise<void> {
  for (const fileName of zip.listFiles()) {
    if (!fileName.endsWith('.rels')) continue;
    if (touchedRelationshipParts.size > 0 && !touchedRelationshipParts.has(fileName)) continue;
    const relsXml = await zip.readTextOrNull(fileName);
    if (!relsXml) continue;
    const relsDoc = parseXml(relsXml);
    for (const rel of Array.from(relsDoc.getElementsByTagNameNS(REL_NS, 'Relationship')) as Element[]) {
      const target = rel.getAttribute('Target');
      if (!target) continue;
      if (rel.getAttribute('TargetMode') === 'External') continue;
      const resolved = resolveRelationshipTarget(fileName, target);
      if (!zip.hasFile(resolved)) {
        push(diagnostics, {
          severity: touchedRelationshipParts.has(fileName) ? 'error' : 'warning',
          code: 'RELATIONSHIP_TARGET_MISSING',
          message: `Relationship target '${target}' resolves to missing package part '${resolved}'`,
          part: fileName,
        });
      }
    }
  }

  const sidePartsToCheck = touchedSideParts.size > 0
    ? [...touchedSideParts]
    : REVISION_SIDE_PART_PATHS.filter((part) => zip.hasFile(part));
  if (sidePartsToCheck.length === 0) return;

  const contentTypesXml = await zip.readTextOrNull('[Content_Types].xml');
  const overrides = new Set<string>();
  if (contentTypesXml) {
    const ctDoc = parseXml(contentTypesXml);
    for (const override of Array.from(ctDoc.getElementsByTagNameNS(CT_NS, 'Override')) as Element[]) {
      const partName = override.getAttribute('PartName');
      if (partName) overrides.add(partName.replace(/^\//, ''));
    }
  }

  for (const part of sidePartsToCheck) {
    if (!zip.hasFile(part)) continue;
    if (!overrides.has(part)) {
      push(diagnostics, {
        severity: touchedSideParts.has(part) ? 'error' : 'warning',
        code: 'SIDE_PART_CONTENT_TYPE_MISSING',
        message: `Created side part '${part}' is missing a [Content_Types].xml Override`,
        part,
      });
    }
  }
}

export async function validateAiRevisions(
  options: ValidateAiRevisionsOptions,
): Promise<ValidateAiRevisionsResult> {
  const touchedRevisionIds = toStringSet(options.touched?.revisionIds);
  const touchedRangeIds = toStringSet(options.touched?.rangeIds);
  const touchedRelationshipParts = toStringSet(options.touched?.relationshipParts);
  const touchedSideParts = toStringSet(options.touched?.sideParts);
  const diagnostics: AiRevisionDiagnostic[] = [];
  const aiIds = new Map<string, string>();

  for (const story of options.stories) {
    checkRevisionMetadata(story, options.aiAuthor, touchedRevisionIds, diagnostics, aiIds);
    checkRangePairs(story, options.aiAuthor, touchedRangeIds, diagnostics);
    checkFieldStructure(story, diagnostics);
    checkPlacement(story, options.aiAuthor, touchedRevisionIds, diagnostics);

  }

  if (options.packageZip) {
    await checkPackageInvariants(
      options.packageZip,
      touchedRelationshipParts,
      touchedSideParts,
      diagnostics,
    );
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export const AI_REVISION_VALIDATION_STORY_PARTS = REVISION_STORY_PART_PATHS;
