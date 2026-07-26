import { parseXml } from './xml.js';
import { childElements } from './dom-helpers.js';
import { OOXML } from './namespaces.js';
import {
  OpcRelationshipTargetError,
  normalizeOpcRelationshipTarget,
} from './opc-target.js';

export type SectPrIssueType =
  | 'missing_body'
  | 'multiple_body_level_sectpr'
  | 'body_level_sectpr_not_last'
  | 'sectpr_invalid_parent'
  | 'sectpr_in_ppr_without_paragraph_parent'
  | 'sectpr_reference_missing_rid'
  | 'sectpr_reference_invalid_type'
  | 'sectpr_reference_invalid_placement'
  | 'sectpr_duplicate_reference_type'
  | 'sectpr_reference_dangling_rid'
  | 'sectpr_duplicate_relationship_id'
  | 'sectpr_reference_wrong_relationship_type'
  | 'sectpr_reference_invalid_target_mode'
  | 'sectpr_reference_external_target'
  | 'sectpr_reference_invalid_target'
  | 'sectpr_reference_missing_target_part'
  | 'sectpr_reference_wrong_target_root';

export interface SectPrAuditIssue {
  type: SectPrIssueType;
  path: string;
  message: string;
  rid?: string;
  sectionOrdinal?: number;
  kind?: SectPrBindingKind;
  role?: SectPrBindingRole;
  targetPath?: string;
}

export type SectPrBindingKind = 'header' | 'footer';
export type SectPrBindingRole = 'default' | 'first' | 'even';

export interface SectPrBinding {
  sectionOrdinal: number;
  kind: SectPrBindingKind;
  role: SectPrBindingRole;
  rid: string;
  targetPath: string;
  path: string;
}

export interface SectPrAuditSummary {
  ok: boolean;
  issues: SectPrAuditIssue[];
  bindings: SectPrBinding[];
  stats: {
    bodyLevelSectPrCount: number;
    paragraphLevelSectPrCount: number;
    totalSectPrCount: number;
    referenceCount: number;
  };
}

function elementSiblingIndex(node: Element): number {
  const parent = node.parentNode;
  if (!parent) return 1;
  let idx = 0;
  for (const sibling of childElements(parent as Element)) {
    if (sibling.namespaceURI === node.namespaceURI && sibling.localName === node.localName) {
      idx++;
    }
    if (sibling === node) {
      return idx;
    }
  }
  return idx || 1;
}

function nodePath(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current) {
    parts.push(`${current.tagName}[${elementSiblingIndex(current)}]`);
    const parentNode: Node | null = current.parentNode;
    if (!parentNode || parentNode.nodeType !== 1) {
      break;
    }
    current = parentNode as Element;
  }
  return parts.reverse().join('/');
}

interface DocumentRelationship {
  type: string;
  target: string;
  targetMode?: string;
}

interface RelationshipCollection {
  relationships: Map<string, DocumentRelationship>;
  duplicateIds: string[];
}

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REFERENCE_TYPES = new Set(['first', 'default', 'even']);

function isWmlElement(element: Element, localName: string): boolean {
  return element.namespaceURI === OOXML.W_NS && element.localName === localName;
}

function collectRelationships(documentRelsXml: string | null | undefined): RelationshipCollection {
  if (!documentRelsXml) {
    return { relationships: new Map(), duplicateIds: [] };
  }

  try {
    const relDoc = parseXml(documentRelsXml);
    const relationshipsById = new Map<string, DocumentRelationship>();
    const duplicateIds = new Set<string>();
    const relationships = relDoc.getElementsByTagNameNS(RELATIONSHIPS_NS, 'Relationship');
    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships.item(i);
      const id = rel?.getAttribute('Id');
      if (id) {
        if (relationshipsById.has(id)) {
          duplicateIds.add(id);
          continue;
        }
        relationshipsById.set(id, {
          type: rel?.getAttribute('Type') ?? '',
          target: rel?.getAttribute('Target') ?? '',
          targetMode: rel?.hasAttribute('TargetMode')
            ? rel.getAttribute('TargetMode') ?? undefined
            : undefined,
        });
      }
    }
    return { relationships: relationshipsById, duplicateIds: [...duplicateIds].sort() };
  } catch {
    return { relationships: new Map(), duplicateIds: [] };
  }
}

function getRid(ref: Element): string | undefined {
  return ref.getAttributeNS(OOXML.R_NS, 'id') || undefined;
}

/**
 * Audit section placement and header/footer bindings. When package parts are
 * supplied, every typed reference is followed through document.xml.rels to a
 * target part whose root must match the reference kind.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.3
 * @see https://github.com/UseJunior/safe-docx/issues/560
 */
export function auditSectPr(
  documentXml: string,
  documentRelsXml?: string | null,
  packageParts?: ReadonlyMap<string, string>,
): SectPrAuditSummary {
  const issues: SectPrAuditIssue[] = [];
  const bindings: SectPrBinding[] = [];
  const relationshipCollection = collectRelationships(documentRelsXml);
  const relationships = relationshipCollection.relationships;
  const ambiguousRelationshipIds = new Set(relationshipCollection.duplicateIds);

  for (const id of relationshipCollection.duplicateIds) {
    issues.push({
      type: 'sectpr_duplicate_relationship_id',
      path: 'Relationships',
      message: `document.xml.rels contains duplicate relationship id '${id}'`,
      rid: id,
    });
  }

  const doc = parseXml(documentXml);
  const body = doc.getElementsByTagNameNS(OOXML.W_NS, 'body').item(0) as Element | null;

  if (!body) {
    return {
      ok: false,
      issues: [
        {
          type: 'missing_body',
          path: 'w:document',
          message: 'Missing w:body element',
        },
      ],
      bindings,
      stats: {
        bodyLevelSectPrCount: 0,
        paragraphLevelSectPrCount: 0,
        totalSectPrCount: 0,
        referenceCount: 0,
      },
    };
  }

  const bodyChildren = childElements(body);
  const bodyLevelSectPrNodes = bodyChildren.filter((child) => isWmlElement(child, 'sectPr'));

  if (bodyLevelSectPrNodes.length > 1) {
    for (const sectPr of bodyLevelSectPrNodes) {
      issues.push({
        type: 'multiple_body_level_sectpr',
        path: nodePath(sectPr),
        message: 'Multiple body-level w:sectPr elements found; expected at most one final w:sectPr',
      });
    }
  }

  if (bodyLevelSectPrNodes.length > 0) {
    const lastChild = bodyChildren[bodyChildren.length - 1];
    for (const sectPr of bodyLevelSectPrNodes) {
      if (sectPr !== lastChild) {
        issues.push({
          type: 'body_level_sectpr_not_last',
          path: nodePath(sectPr),
          message: 'Body-level w:sectPr is not the final direct child of w:body',
        });
      }
    }
  }

  const sectPrNodes = Array.from(doc.getElementsByTagNameNS(OOXML.W_NS, 'sectPr'))
    .filter((sectPr) => {
      for (let ancestor = sectPr.parentNode; ancestor; ancestor = ancestor.parentNode) {
        if (
          ancestor.nodeType === 1 &&
          isWmlElement(ancestor as Element, 'sectPrChange')
        ) {
          return false;
        }
      }
      return true;
    });
  let paragraphLevelSectPrCount = 0;
  let referenceCount = 0;

  for (const [sectionOrdinal, sectPr] of sectPrNodes.entries()) {
    const seenReferenceTypes = new Set<string>();
    const parent = sectPr.parentNode;
    const parentTag = parent && parent.nodeType === 1 ? (parent as Element).tagName : '';

    if (parent && parent.nodeType === 1 && isWmlElement(parent as Element, 'pPr')) {
      paragraphLevelSectPrCount++;
      const grand = (parent as Element).parentNode;
      if (!(grand && grand.nodeType === 1 && isWmlElement(grand as Element, 'p'))) {
        issues.push({
          type: 'sectpr_in_ppr_without_paragraph_parent',
          path: nodePath(sectPr),
          message: 'w:sectPr in w:pPr does not have w:p as parent',
        });
      }
    } else if (!(parent && parent.nodeType === 1 && isWmlElement(parent as Element, 'body'))) {
      issues.push({
        type: 'sectpr_invalid_parent',
        path: nodePath(sectPr),
        message: `w:sectPr has invalid parent '${parentTag || '(none)'}'`,
      });
    }

    const descendantReferences = Array.from(
      sectPr.getElementsByTagNameNS(OOXML.W_NS, '*'),
    ).filter((element) => {
      if (element.localName !== 'headerReference' && element.localName !== 'footerReference') {
        return false;
      }
      let ancestor = element.parentNode;
      while (ancestor && ancestor !== sectPr) {
        if (ancestor.nodeType === 1 && isWmlElement(ancestor as Element, 'sectPr')) return false;
        ancestor = ancestor.parentNode;
      }
      return ancestor === sectPr;
    });
    referenceCount += descendantReferences.length;
    for (const reference of descendantReferences) {
      if (reference.parentNode === sectPr) continue;
      const referenceType = reference.getAttributeNS(OOXML.W_NS, 'type') ?? '';
      issues.push({
        type: 'sectpr_reference_invalid_placement',
        path: nodePath(reference),
        message: `${reference.tagName} must be a direct child of w:sectPr`,
        sectionOrdinal,
        kind: reference.localName === 'headerReference' ? 'header' : 'footer',
        role: REFERENCE_TYPES.has(referenceType)
          ? referenceType as SectPrBindingRole
          : undefined,
      });
    }

    for (const child of childElements(sectPr)) {
      const isHeaderReference = isWmlElement(child, 'headerReference');
      const isFooterReference = isWmlElement(child, 'footerReference');
      if (!isHeaderReference && !isFooterReference) {
        continue;
      }

      const kind = isHeaderReference ? 'header' : 'footer';
      const referenceType = child.getAttributeNS(OOXML.W_NS, 'type') ?? '';
      const role = REFERENCE_TYPES.has(referenceType)
        ? referenceType as SectPrBindingRole
        : undefined;
      if (!REFERENCE_TYPES.has(referenceType)) {
        issues.push({
          type: 'sectpr_reference_invalid_type',
          path: nodePath(child),
          message: `${child.tagName} has missing or invalid w:type '${referenceType || '(missing)'}'; expected first, default, or even`,
          sectionOrdinal,
          kind,
        });
        continue;
      } else {
        const referenceKey = `${isHeaderReference ? 'header' : 'footer'}:${referenceType}`;
        if (seenReferenceTypes.has(referenceKey)) {
          issues.push({
            type: 'sectpr_duplicate_reference_type',
            path: nodePath(child),
            message: `${child.tagName} duplicates the '${referenceType}' role within this w:sectPr`,
            sectionOrdinal,
            kind,
            role,
          });
          continue;
        } else {
          seenReferenceTypes.add(referenceKey);
        }
      }
      const rid = getRid(child);
      if (!rid) {
        issues.push({
          type: 'sectpr_reference_missing_rid',
          path: nodePath(child),
          message: `${child.tagName} is missing r:id`,
          sectionOrdinal,
          kind,
          role,
        });
        continue;
      }
      if (ambiguousRelationshipIds.has(rid)) continue;

      const relationship = relationships.get(rid);
      if (!relationship) {
        issues.push({
          type: 'sectpr_reference_dangling_rid',
          path: nodePath(child),
          message: `${child.tagName} references missing relationship id '${rid}'`,
          rid,
          sectionOrdinal,
          kind,
          role,
        });
        continue;
      }

      const expectedType = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`;
      if (relationship.type !== expectedType) {
        issues.push({
          type: 'sectpr_reference_wrong_relationship_type',
          path: nodePath(child),
          message: `${child.tagName} relationship '${rid}' has type '${relationship.type || '(missing)'}'`,
          rid,
          sectionOrdinal,
          kind,
          role,
        });
        continue;
      }

      let targetName: string;
      try {
        targetName = normalizeOpcRelationshipTarget({
          ownerPart: 'word/document.xml',
          target: relationship.target,
          targetMode: relationship.targetMode,
        }).target;
      } catch (error) {
        const targetError = error instanceof OpcRelationshipTargetError ? error : undefined;
        const type = targetError?.issue === 'invalid_target_mode'
          ? 'sectpr_reference_invalid_target_mode'
          : targetError?.issue === 'external_target_not_allowed'
            ? 'sectpr_reference_external_target'
            : 'sectpr_reference_invalid_target';
        issues.push({
          type,
          path: nodePath(child),
          message: `${child.tagName} relationship '${rid}' has unsupported or malformed target '${relationship.target}': ${
            error instanceof Error ? error.message : String(error)
          }`,
          rid,
          sectionOrdinal,
          kind,
          role,
        });
        continue;
      }
      if (packageParts) {
        const targetXml = packageParts.get(targetName);
        if (!targetXml) {
          issues.push({
            type: 'sectpr_reference_missing_target_part',
            path: nodePath(child),
            message: `${child.tagName} relationship '${rid}' resolves to missing part '${targetName}'`,
            rid,
            sectionOrdinal,
            kind,
            role,
            targetPath: targetName,
          });
          continue;
        }
        try {
          const expectedRoot = kind === 'header' ? 'hdr' : 'ftr';
          const actualRoot = parseXml(targetXml).documentElement;
          if (!actualRoot || !isWmlElement(actualRoot, expectedRoot)) {
            issues.push({
              type: 'sectpr_reference_wrong_target_root',
              path: nodePath(child),
              message: `${child.tagName} relationship '${rid}' targets <${actualRoot?.tagName ?? 'nothing'}>, expected WordprocessingML <${expectedRoot}>`,
              rid,
              sectionOrdinal,
              kind,
              role,
              targetPath: targetName,
            });
            continue;
          }
        } catch {
          issues.push({
            type: 'sectpr_reference_wrong_target_root',
            path: nodePath(child),
            message: `${child.tagName} relationship '${rid}' targets malformed XML`,
            rid,
            sectionOrdinal,
            kind,
            role,
            targetPath: targetName,
          });
          continue;
        }
      }
      bindings.push({
        sectionOrdinal,
        kind,
        role: referenceType as SectPrBindingRole,
        rid,
        targetPath: targetName,
        path: nodePath(child),
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    bindings,
    stats: {
      bodyLevelSectPrCount: bodyLevelSectPrNodes.length,
      paragraphLevelSectPrCount,
      totalSectPrCount: sectPrNodes.length,
      referenceCount,
    },
  };
}
