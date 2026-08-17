import { XMLSerializer } from '@xmldom/xmldom';
import {
  DocxArchive,
  OOXML,
  auditSectPr,
  collectStrictFieldStructureIssues,
  parseXml,
  type FieldStructureIssue,
  type SectPrAuditIssue,
  type SectPrBinding,
} from '@usejunior/docx-core';
import type {
  AncillaryBindingLocator,
  AncillaryFieldEvidence,
  AncillaryFieldInstructionKind,
  AncillaryFieldLocator,
  AncillaryFieldRangeEvidence,
  AncillarySelectedBindingSummary,
  AncillaryStorySafetyIssue,
  AncillaryStorySummary,
  ReconstructionMode,
} from '../../compare-types.js';
import {
  canonicalNode,
  classifyFieldInstruction,
  type SupportedComplexField,
} from './opaquePassthrough.js';

const serializer = new XMLSerializer();
const NOTE_PARTS = [
  {
    path: 'word/footnotes.xml' as const,
    root: 'footnotes',
    entry: 'footnote',
    storyKind: 'footnote' as const,
  },
  {
    path: 'word/endnotes.xml' as const,
    root: 'endnotes',
    entry: 'endnote',
    storyKind: 'endnote' as const,
  },
] as const;
const IGNORED_STRICT_ISSUES = new Set([
  'TEXT_INSIDE_DELETION',
  'DELETED_TEXT_OUTSIDE_DELETION',
]);

export interface AncillaryStorySafetyAttempt {
  reconstructionMode: ReconstructionMode;
  issues: AncillaryStorySafetyIssue[];
}

export class AncillaryStorySafetyError extends Error {
  readonly issues: AncillaryStorySafetyIssue[];
  readonly attempts?: AncillaryStorySafetyAttempt[];

  constructor(
    issues: AncillaryStorySafetyIssue[],
    attempts?: AncillaryStorySafetyAttempt[],
  ) {
    super(
      attempts
        ? `Ancillary story safety check failed in ${attempts.length} reconstruction attempt(s)`
        : `Ancillary story safety check failed with ${issues.length} issue(s)`,
    );
    this.name = 'AncillaryStorySafetyError';
    this.issues = issues;
    this.attempts = attempts;
  }
}

export interface AncillaryNoteMergeResult {
  mergedIds: ReadonlySet<string>;
  createdPart: boolean;
}

export interface AncillaryFieldSafetyInput {
  resultArchive: DocxArchive;
  baseArchive: DocxArchive;
  mergeSourceArchive: DocxArchive;
  reconstructionMode: ReconstructionMode;
  baseSide: 'original' | 'revised';
  mergeSourceSide: 'original' | 'revised';
  noteMergeResults: ReadonlyMap<'footnote' | 'endnote', AncillaryNoteMergeResult>;
}

interface InternalFieldRange {
  locator: AncillaryFieldLocator;
  instructionKind: AncillaryFieldInstructionKind;
  canonical: string;
}

interface NoteEntry {
  id: string;
  element: Element;
}

interface NotePartInspection {
  entries: NoteEntry[];
  issues: AncillaryStorySafetyIssue[];
}

function packageLocator(path: string): AncillaryStorySafetyIssue['locator'] {
  return { locatorType: 'package_part', normalizedPartPath: path };
}

function bindingLocator(issue: SectPrAuditIssue): AncillaryStorySafetyIssue['locator'] {
  if (issue.sectionOrdinal === undefined || !issue.kind || !issue.role) {
    return packageLocator(
      issue.type === 'sectpr_duplicate_relationship_id'
        ? 'word/_rels/document.xml.rels'
        : 'word/document.xml',
    );
  }
  return {
    locatorType: 'section_binding',
    sectionOrdinal: issue.sectionOrdinal,
    kind: issue.kind,
    role: issue.role,
    normalizedPartPath: issue.targetPath,
  };
}

function bindingSummary(binding: SectPrBinding): AncillarySelectedBindingSummary {
  return {
    sectionOrdinal: binding.sectionOrdinal,
    kind: binding.kind,
    role: binding.role,
    relationshipId: binding.rid,
    normalizedPartPath: binding.targetPath,
  };
}

function publicBindingLocator(binding: SectPrBinding): AncillaryBindingLocator {
  return {
    locatorType: 'section_binding',
    sectionOrdinal: binding.sectionOrdinal,
    kind: binding.kind,
    role: binding.role,
    normalizedPartPath: binding.targetPath,
  };
}

function canonicalNoteId(value: string): string | undefined {
  const collapsed = value
    .replace(/[ \t\r\n]+/gu, ' ')
    .replace(/^ | $/gu, '');
  if (!/^[+-]?\d+$/u.test(collapsed)) return undefined;
  try {
    return BigInt(collapsed).toString();
  } catch {
    return undefined;
  }
}

function inspectNotePart(
  xml: string,
  path: typeof NOTE_PARTS[number]['path'],
  rootName: string,
  entryName: string,
  sourceSide?: 'original' | 'revised',
): NotePartInspection {
  const root = parseXml(xml).documentElement;
  if (root.namespaceURI !== OOXML.W_NS || root.localName !== rootName) {
    throw new Error(`Expected WordprocessingML ${rootName} root`);
  }
  const entries: NoteEntry[] = [];
  const issues: AncillaryStorySafetyIssue[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (element.namespaceURI !== OOXML.W_NS || element.localName !== entryName) continue;
    const lexicalId = element.getAttributeNS(OOXML.W_NS, 'id') ??
      element.getAttribute('w:id') ??
      '';
    const id = canonicalNoteId(lexicalId);
    if (id === undefined) {
      issues.push({
        category: 'canonical_evidence',
        code: 'INVALID_NOTE_ENTRY_ID',
        detail: `${path} contains invalid direct entry id '${lexicalId || '(missing)'}'`,
        locator: {
          locatorType: 'note_entry',
          normalizedPartPath: path,
          entryId: lexicalId,
          sourceSide,
        },
      });
      continue;
    }
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
    entries.push({ id, element });
  }
  issues.push(...[...duplicates].sort((a, b) => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }).map((entryId): AncillaryStorySafetyIssue => ({
      category: 'canonical_evidence',
      code: 'DUPLICATE_NOTE_ENTRY_ID',
      detail: `${path} contains numerically duplicate direct entry id '${entryId}'`,
      locator: {
        locatorType: 'note_entry',
        normalizedPartPath: path,
        entryId,
        sourceSide,
      },
    })));
  return { entries, issues };
}

function strictIssues(
  xml: string,
  label: string,
  locator: AncillaryStorySafetyIssue['locator'],
): AncillaryStorySafetyIssue[] {
  try {
    return collectStrictFieldStructureIssues([{ label, xml }])
      .filter((issue) => !IGNORED_STRICT_ISSUES.has(issue.code))
      .map((issue: FieldStructureIssue) => ({
        category: 'strict_field_structure',
        code: issue.code,
        detail: issue.message,
        locator,
      }));
  } catch (error) {
    return [{
      category: 'strict_field_structure',
      code: 'STORY_XML_INVALID',
      detail: error instanceof Error ? error.message : String(error),
      locator,
    }];
  }
}

function directParagraphChild(paragraph: Element, element: Element): Element | null {
  let current: Element | null = element;
  while (current && current.parentNode !== paragraph) {
    const parent: Node | null = current.parentNode;
    current = parent?.nodeType === 1 ? parent as Element : null;
  }
  return current;
}

function fieldCharType(element: Element): string | null {
  return element.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
    element.getAttribute('w:fldCharType');
}

function inventoryEligibleFields(
  xml: string,
  normalizedPartPath: string,
  entryId: string | undefined,
  allowedKinds: ReadonlySet<SupportedComplexField>,
): InternalFieldRange[] {
  const document = parseXml(xml);
  const paragraphs = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'p'));
  const inventory: InternalFieldRange[] = [];

  for (const [paragraphOrdinal, paragraph] of paragraphs.entries()) {
    const stack: Array<{
      beginChild: Element | null;
      instruction: string[];
      separated: boolean;
      nestedInParent: boolean;
      containsNested: boolean;
    }> = [];
    const completed: Array<{
      beginChild: Element;
      endChild: Element;
      instruction: string;
    }> = [];

    const scan = (node: Element): void => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        if (element.namespaceURI === OOXML.W_NS && element.localName === 'fldChar') {
          const type = fieldCharType(element);
          if (type === 'begin') {
            if (stack.length > 0) stack[stack.length - 1]!.containsNested = true;
            stack.push({
              beginChild: directParagraphChild(paragraph, element),
              instruction: [],
              separated: false,
              nestedInParent: stack.length > 0,
              containsNested: false,
            });
          } else if (type === 'separate' && stack.length > 0) {
            stack[stack.length - 1]!.separated = true;
          } else if (type === 'end' && stack.length > 0) {
            const field = stack.pop()!;
            const endChild = directParagraphChild(paragraph, element);
            if (
              field.beginChild &&
              endChild &&
              !field.nestedInParent &&
              !field.containsNested
            ) {
              completed.push({
                beginChild: field.beginChild,
                endChild,
                instruction: field.instruction.join(''),
              });
            }
          }
        } else if (
          element.namespaceURI === OOXML.W_NS &&
          (element.localName === 'instrText' || element.localName === 'delInstrText') &&
          stack.length > 0 &&
          !stack[stack.length - 1]!.separated
        ) {
          stack[stack.length - 1]!.instruction.push(element.textContent ?? '');
        }
        scan(element);
      }
    };
    scan(paragraph);

    const paragraphChildren = Array.from(paragraph.childNodes)
      .filter((node): node is Element => node.nodeType === 1);
    let eligibleFieldOrdinal = 0;
    for (const field of completed) {
      const instructionKind = classifyFieldInstruction(field.instruction);
      if (!instructionKind || !allowedKinds.has(instructionKind)) continue;
      const start = paragraphChildren.indexOf(field.beginChild);
      const end = paragraphChildren.indexOf(field.endChild);
      if (start < 0 || end < start) continue;
      const canonical = paragraphChildren
        .slice(start, end + 1)
        .map(canonicalNode)
        .join('');
      inventory.push({
        locator: {
          locatorType: 'field_range',
          normalizedPartPath,
          entryId,
          paragraphOrdinal,
          eligibleFieldOrdinal,
          instructionKind,
        },
        instructionKind,
        canonical,
      });
      eligibleFieldOrdinal++;
    }
  }
  return inventory;
}

function locatorKey(locator: AncillaryFieldLocator): string {
  return JSON.stringify([
    locator.normalizedPartPath,
    locator.entryId ?? null,
    locator.paragraphOrdinal,
    locator.eligibleFieldOrdinal,
  ]);
}

function compareInventories(
  source: InternalFieldRange[],
  final: InternalFieldRange[],
  sourceSide: 'original' | 'revised',
  provenance: 'base' | 'imported',
): { issues: AncillaryStorySafetyIssue[]; ranges: AncillaryFieldRangeEvidence[] } {
  const issues: AncillaryStorySafetyIssue[] = [];
  const ranges: AncillaryFieldRangeEvidence[] = [];
  const sourceKeys = new Set(source.map((item) => locatorKey(item.locator)));

  for (const item of source) {
    const key = locatorKey(item.locator);
    const counterpart = final.find((candidate) => locatorKey(candidate.locator) === key);
    if (!counterpart) {
      issues.push({
        category: 'canonical_evidence',
        code: 'FIELD_RANGE_MISSING',
        detail: 'Eligible source field range is missing from the final package',
        locator: item.locator,
      });
      continue;
    }
    if (counterpart.instructionKind !== item.instructionKind) {
      issues.push({
        category: 'canonical_evidence',
        code: 'FIELD_RANGE_KIND_MISMATCH',
        detail: `Eligible field instruction changed from ${item.instructionKind} to ${counterpart.instructionKind}`,
        locator: item.locator,
      });
      continue;
    }
    if (counterpart.canonical !== item.canonical) {
      issues.push({
        category: 'canonical_evidence',
        code: 'FIELD_RANGE_CANONICAL_MISMATCH',
        detail: 'Final field range differs from its source canonical subtree range',
        locator: item.locator,
      });
      continue;
    }
    ranges.push({
      locator: item.locator,
      instructionKind: item.instructionKind,
      sourceSide,
      provenance,
      canonicalMatch: true,
    });
  }

  for (const item of final) {
    if (sourceKeys.has(locatorKey(item.locator))) continue;
    issues.push({
      category: 'canonical_evidence',
      code: 'FIELD_RANGE_EXTRA',
      detail: 'Final package contains an eligible field range absent from its source story',
      locator: item.locator,
    });
  }

  return { issues, ranges: issues.length === 0 ? ranges : [] };
}

function entryMap(entries: NoteEntry[]): Map<string, Element> {
  return new Map(entries.map((entry) => [entry.id, entry.element]));
}

/**
 * Validate and inventory ancillary stories at the final package boundary.
 *
 * Header/footer structure follows the existing section binding audit. Complex
 * field citations cover structural validation and instruction classification;
 * target containment, note isolation, provenance, and canonical preservation
 * are stronger SafeDocX safety policies and metamorphic invariants.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.44
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.42
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */
async function evaluateAncillaryFieldSafetyUnsafe(
  input: AncillaryFieldSafetyInput,
): Promise<AncillaryFieldEvidence> {
  const issues: AncillaryStorySafetyIssue[] = [];
  const ranges: AncillaryFieldRangeEvidence[] = [];
  const stories: AncillaryStorySummary[] = [];
  const resultDocumentXml = await input.resultArchive.getDocumentXml();
  const resultRelationships = await input.resultArchive.getFile('word/_rels/document.xml.rels');
  const preliminarySectionAudit = auditSectPr(resultDocumentXml, resultRelationships);
  const resultParts = new Map<string, string>();
  for (const targetPath of [...new Set(
    preliminarySectionAudit.bindings.map((binding) => binding.targetPath),
  )].sort()) {
    const xml = await input.resultArchive.getFile(targetPath);
    if (xml !== null) resultParts.set(targetPath, xml);
  }
  const sectionAudit = auditSectPr(resultDocumentXml, resultRelationships, resultParts);

  for (const issue of sectionAudit.issues) {
    issues.push({
      category: 'binding_resolution',
      code: issue.type,
      detail: issue.message,
      locator: bindingLocator(issue),
    });
  }
  if (issues.length > 0) throw new AncillaryStorySafetyError(issues);

  const bindings = sectionAudit.bindings.map(bindingSummary);
  const bindingsByTarget = new Map<string, SectPrBinding[]>();
  for (const binding of sectionAudit.bindings) {
    const list = bindingsByTarget.get(binding.targetPath);
    if (list) list.push(binding);
    else bindingsByTarget.set(binding.targetPath, [binding]);
  }

  for (const [targetPath, targetBindings] of [...bindingsByTarget].sort(([a], [b]) => a.localeCompare(b))) {
    const finalXml = resultParts.get(targetPath)!;
    const baseXml = await input.baseArchive.getFile(targetPath);
    const importedXml = baseXml === null
      ? await input.mergeSourceArchive.getFile(targetPath)
      : null;
    const sourceXml = baseXml ?? importedXml;
    const provenance = baseXml === null ? 'imported' as const : 'base' as const;
    const sourceSide = provenance === 'base' ? input.baseSide : input.mergeSourceSide;
    const locator = {
      locatorType: 'header_footer_story' as const,
      normalizedPartPath: targetPath,
      selectingBindings: targetBindings.map(publicBindingLocator),
    };
    const storyStrictIssues = strictIssues(finalXml, targetPath, locator);
    issues.push(...storyStrictIssues);
    if (storyStrictIssues.length > 0) continue;
    if (sourceXml === null) {
      issues.push({
        category: 'canonical_evidence',
        code: 'FIELD_RANGE_MISSING',
        detail: `Selected source story '${targetPath}' is absent from both assembly sources`,
        locator,
      });
      continue;
    }
    const allowed = new Set<SupportedComplexField>(['PAGE', 'NUMPAGES']);
    const comparison = compareInventories(
      inventoryEligibleFields(sourceXml, targetPath, undefined, allowed),
      inventoryEligibleFields(finalXml, targetPath, undefined, allowed),
      sourceSide,
      provenance,
    );
    issues.push(...comparison.issues);
    ranges.push(...comparison.ranges);
    stories.push({
      storyKind: targetBindings[0]!.kind,
      normalizedPartPath: targetPath,
      selectingBindings: targetBindings.map(publicBindingLocator),
      sourceSide,
      provenance,
      strictFieldStructure: 'passed',
    });
  }

  for (const note of NOTE_PARTS) {
    const noteIssueStart = issues.length;
    const [baseXml, sourceXml, finalXml] = await Promise.all([
      input.baseArchive.getFile(note.path),
      input.mergeSourceArchive.getFile(note.path),
      input.resultArchive.getFile(note.path),
    ]);
    if (finalXml === null) continue;

    const mergeResult = input.noteMergeResults.get(note.storyKind);
    const sourceContributes = Boolean(
      mergeResult?.createdPart || (mergeResult && mergeResult.mergedIds.size > 0),
    );
    let baseInspection: NotePartInspection = { entries: [], issues: [] };
    let sourceInspection: NotePartInspection = { entries: [], issues: [] };
    let finalInspection: NotePartInspection;
    try {
      if (baseXml !== null) {
        baseInspection = inspectNotePart(
          baseXml,
          note.path,
          note.root,
          note.entry,
          input.baseSide,
        );
        issues.push(...baseInspection.issues);
      }
      if (sourceContributes && sourceXml !== null) {
        sourceInspection = inspectNotePart(
          sourceXml,
          note.path,
          note.root,
          note.entry,
          input.mergeSourceSide,
        );
        issues.push(...sourceInspection.issues);
      }
      finalInspection = inspectNotePart(finalXml, note.path, note.root, note.entry);
      issues.push(...finalInspection.issues);
    } catch (error) {
      issues.push({
        category: 'strict_field_structure',
        code: 'NOTE_PART_XML_INVALID',
        detail: error instanceof Error ? error.message : String(error),
        locator: packageLocator(note.path),
      });
      continue;
    }

    if (issues.length > noteIssueStart) continue;

    const finalEntries = finalInspection.entries;
    const baseEntries = entryMap(baseInspection.entries);
    const sourceEntries = entryMap(sourceInspection.entries);
    const canonicalMergedIds = new Set(
      [...(mergeResult?.mergedIds ?? [])]
        .map(canonicalNoteId)
        .filter((id): id is string => id !== undefined),
    );
    const allowed = new Set<SupportedComplexField>(['REF', 'PAGEREF']);

    for (const entry of finalEntries) {
      const provenance = baseEntries.has(entry.id) ? 'base' : 'imported';
      const sourceSide = provenance === 'base' ? input.baseSide : input.mergeSourceSide;
      const sourceEntry = provenance === 'base'
        ? baseEntries.get(entry.id)
        : sourceEntries.get(entry.id);
      const locator = {
        locatorType: 'note_entry' as const,
        normalizedPartPath: note.path,
        entryId: entry.id,
      };
      const entryStrictIssues = strictIssues(
        serializer.serializeToString(entry.element),
        `${note.path}:${entry.id}`,
        locator,
      );
      issues.push(...entryStrictIssues);
      if (entryStrictIssues.length > 0) continue;
      if (
        !sourceEntry ||
        (provenance === 'imported' && !canonicalMergedIds.has(entry.id) && !mergeResult?.createdPart)
      ) {
        issues.push({
          category: 'canonical_evidence',
          code: 'NOTE_ENTRY_PROVENANCE_MISSING',
          detail: `Final note entry '${entry.id}' has no assembly source provenance`,
          locator,
        });
        continue;
      }
      const sourceEntryXml = serializer.serializeToString(sourceEntry);
      const finalEntryXml = serializer.serializeToString(entry.element);
      const comparison = compareInventories(
        inventoryEligibleFields(sourceEntryXml, note.path, entry.id, allowed),
        inventoryEligibleFields(finalEntryXml, note.path, entry.id, allowed),
        sourceSide,
        provenance,
      );
      issues.push(...comparison.issues);
      ranges.push(...comparison.ranges);
      stories.push({
        storyKind: note.storyKind,
        normalizedPartPath: note.path,
        entryId: entry.id,
        sourceSide,
        provenance,
        strictFieldStructure: 'passed',
      });
    }
  }

  if (issues.length > 0) throw new AncillaryStorySafetyError(issues);
  return {
    status: 'passed',
    reconstructionMode: input.reconstructionMode,
    selectedBindings: bindings,
    stories,
    ranges,
  };
}

export async function evaluateAncillaryFieldSafety(
  input: AncillaryFieldSafetyInput,
): Promise<AncillaryFieldEvidence> {
  try {
    return await evaluateAncillaryFieldSafetyUnsafe(input);
  } catch (error) {
    if (error instanceof AncillaryStorySafetyError) throw error;
    throw new AncillaryStorySafetyError([{
      category: 'strict_field_structure',
      code: 'ANCILLARY_PACKAGE_XML_INVALID',
      detail: error instanceof Error ? error.message : String(error),
      locator: packageLocator('word/document.xml'),
    }]);
  }
}
