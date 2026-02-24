// Parser for word/_rels/document.xml.rels — extracts external hyperlink relationships.

import { OOXML } from './namespaces.js';

export type RelsMap = Map<string, string>;

/**
 * Parse a document.xml.rels DOM and return a Map<rId, targetUrl> for external hyperlinks only.
 * Returns an empty map when the rels document is null (e.g. file missing from the DOCX archive).
 */
export function parseDocumentRels(relsDoc: Document | null): RelsMap {
  const map: RelsMap = new Map();
  if (!relsDoc) return map;

  const relationships = relsDoc.getElementsByTagName('Relationship');
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships.item(i)!;
    const type = rel.getAttribute('Type');
    const targetMode = rel.getAttribute('TargetMode');
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');

    if (type === OOXML.HYPERLINK_REL_TYPE && targetMode === 'External' && id && target) {
      map.set(id, target);
    }
  }
  return map;
}
