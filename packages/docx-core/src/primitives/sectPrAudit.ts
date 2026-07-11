import { parseXml } from './xml.js';
import { childElements } from './dom-helpers.js';
import { OOXML } from './namespaces.js';

export type SectPrIssueType =
  | 'missing_body'
  | 'multiple_body_level_sectpr'
  | 'body_level_sectpr_not_last'
  | 'sectpr_invalid_parent'
  | 'sectpr_in_ppr_without_paragraph_parent'
  | 'sectpr_reference_missing_rid'
  | 'sectpr_reference_dangling_rid'
  | 'sectpr_reference_wrong_relationship_type'
  | 'sectpr_reference_missing_target_part'
  | 'sectpr_reference_wrong_target_root';

export interface SectPrAuditIssue {
  type: SectPrIssueType;
  path: string;
  message: string;
  rid?: string;
}

export interface SectPrAuditSummary {
  ok: boolean;
  issues: SectPrAuditIssue[];
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
    if (sibling.tagName === node.tagName) {
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
  external: boolean;
}

function collectRelationships(documentRelsXml: string | null | undefined): Map<string, DocumentRelationship> {
  if (!documentRelsXml) {
    return new Map();
  }

  try {
    const relDoc = parseXml(documentRelsXml);
    const relationshipsById = new Map<string, DocumentRelationship>();
    const relationships = relDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships.item(i);
      const id = rel?.getAttribute('Id');
      if (id) {
        relationshipsById.set(id, {
          type: rel?.getAttribute('Type') ?? '',
          target: rel?.getAttribute('Target') ?? '',
          external: rel?.getAttribute('TargetMode') === 'External',
        });
      }
    }
    return relationshipsById;
  } catch {
    return new Map();
  }
}

function resolveDocumentTarget(target: string): string {
  const parts = ['word'];
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

function getRid(ref: Element): string | undefined {
  return (
    ref.getAttribute('r:id') ??
    ref.getAttributeNS(OOXML.R_NS, 'id') ??
    ref.getAttribute('id') ??
    undefined
  );
}

/**
 * Audit section placement and header/footer bindings. When package parts are
 * supplied, every typed reference is followed through document.xml.rels to a
 * target part whose root must match the reference kind.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.2
 * @see https://github.com/UseJunior/safe-docx/issues/560
 */
export function auditSectPr(
  documentXml: string,
  documentRelsXml?: string | null,
  packageParts?: ReadonlyMap<string, string>,
): SectPrAuditSummary {
  const issues: SectPrAuditIssue[] = [];
  const relationships = collectRelationships(documentRelsXml);

  const doc = parseXml(documentXml);
  const body = doc.getElementsByTagName('w:body').item(0) as Element | null;

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
      stats: {
        bodyLevelSectPrCount: 0,
        paragraphLevelSectPrCount: 0,
        totalSectPrCount: 0,
        referenceCount: 0,
      },
    };
  }

  const bodyChildren = childElements(body);
  const bodyLevelSectPrNodes = bodyChildren.filter((child) => child.tagName === 'w:sectPr');

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

  const sectPrNodes = Array.from(doc.getElementsByTagName('w:sectPr'));
  let paragraphLevelSectPrCount = 0;
  let referenceCount = 0;

  for (const sectPr of sectPrNodes) {
    const parent = sectPr.parentNode;
    const parentTag = parent && parent.nodeType === 1 ? (parent as Element).tagName : '';

    if (parentTag === 'w:pPr') {
      paragraphLevelSectPrCount++;
      const grand = (parent as Element).parentNode;
      const grandTag = grand && grand.nodeType === 1 ? (grand as Element).tagName : '';
      if (grandTag !== 'w:p') {
        issues.push({
          type: 'sectpr_in_ppr_without_paragraph_parent',
          path: nodePath(sectPr),
          message: 'w:sectPr in w:pPr does not have w:p as parent',
        });
      }
    } else if (parentTag !== 'w:body') {
      issues.push({
        type: 'sectpr_invalid_parent',
        path: nodePath(sectPr),
        message: `w:sectPr has invalid parent '${parentTag || '(none)'}'`,
      });
    }

    for (const child of childElements(sectPr)) {
      if (child.tagName !== 'w:headerReference' && child.tagName !== 'w:footerReference') {
        continue;
      }

      referenceCount++;
      const rid = getRid(child);
      if (!rid) {
        issues.push({
          type: 'sectpr_reference_missing_rid',
          path: nodePath(child),
          message: `${child.tagName} is missing r:id`,
        });
        continue;
      }

      const relationship = relationships.get(rid);
      if (!relationship) {
        issues.push({
          type: 'sectpr_reference_dangling_rid',
          path: nodePath(child),
          message: `${child.tagName} references missing relationship id '${rid}'`,
          rid,
        });
        continue;
      }

      const kind = child.tagName === 'w:headerReference' ? 'header' : 'footer';
      const expectedType = `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`;
      if (relationship.type !== expectedType || relationship.external) {
        issues.push({
          type: 'sectpr_reference_wrong_relationship_type',
          path: nodePath(child),
          message: `${child.tagName} relationship '${rid}' has type '${relationship.type || '(missing)'}'`,
          rid,
        });
        continue;
      }

      if (packageParts) {
        const targetName = resolveDocumentTarget(relationship.target);
        const targetXml = packageParts.get(targetName);
        if (!targetXml) {
          issues.push({
            type: 'sectpr_reference_missing_target_part',
            path: nodePath(child),
            message: `${child.tagName} relationship '${rid}' resolves to missing part '${targetName}'`,
            rid,
          });
          continue;
        }
        try {
          const expectedRoot = kind === 'header' ? 'w:hdr' : 'w:ftr';
          const actualRoot = parseXml(targetXml).documentElement?.tagName;
          if (actualRoot !== expectedRoot) {
            issues.push({
              type: 'sectpr_reference_wrong_target_root',
              path: nodePath(child),
              message: `${child.tagName} relationship '${rid}' targets <${actualRoot ?? 'nothing'}>, expected <${expectedRoot}>`,
              rid,
            });
          }
        } catch {
          issues.push({
            type: 'sectpr_reference_wrong_target_root',
            path: nodePath(child),
            message: `${child.tagName} relationship '${rid}' targets malformed XML`,
            rid,
          });
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      bodyLevelSectPrCount: bodyLevelSectPrNodes.length,
      paragraphLevelSectPrCount,
      totalSectPrCount: sectPrNodes.length,
      referenceCount,
    },
  };
}
