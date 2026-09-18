import { XMLSerializer } from '@xmldom/xmldom';
import { childElements, OOXML } from '@usejunior/docx-core';
import { canonicalNoteId } from './ancillaryFieldSafety.js';

const serializer = new XMLSerializer();

/** A reader workaround for one unchanged anchor position, not a general
 * anchor-history flattening rule. Preserve ambiguous or foreign shapes.
 * This internal predicate is not exported from the public package entry point.
 * @internal
 * @see https://github.com/UseJunior/safe-docx/issues/979
 */
export function alignedInlineFootnoteAnchorPair(document: Document, oldId: string, newId: string, author: string): [Element, Element, Element, Element] | undefined {
  const refs = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'footnoteReference'));
  const old = refs.filter(ref => canonicalNoteId(ref.getAttributeNS(OOXML.W_NS, 'id') ?? '') === oldId);
  const fresh = refs.filter(ref => canonicalNoteId(ref.getAttributeNS(OOXML.W_NS, 'id') ?? '') === newId);
  if (old.length !== 1 || fresh.length !== 1) return;
  const dedicated = (ref: Element, kind: string): [Element, Element] | undefined => {
    const run = ref.parentNode as Element, wrapper = run?.parentNode as Element;
    if (run?.namespaceURI !== OOXML.W_NS || run.localName !== 'r' || wrapper?.namespaceURI !== OOXML.W_NS || wrapper.localName !== kind || wrapper.getAttributeNS(OOXML.W_NS, 'author') !== author) return;
    if (Array.from(wrapper.attributes).some(attr => attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !(attr.namespaceURI === OOXML.W_NS && ['id', 'author', 'date'].includes(attr.localName)))) return;
    if (wrapper.parentNode?.nodeType !== 1 || (wrapper.parentNode as Element).namespaceURI !== OOXML.W_NS || (wrapper.parentNode as Element).localName !== 'p') return;
    const substantive = (element: Element) => Array.from(element.childNodes).filter(n => !(n.nodeType === 3 && !n.nodeValue?.trim()));
    if (substantive(wrapper).length !== 1 || substantive(wrapper)[0] !== run) return;
    if (substantive(run).some(n => n !== ref && !(n.nodeType === 1 && (n as Element).namespaceURI === OOXML.W_NS && (n as Element).localName === 'rPr'))) return;
    if (run.getElementsByTagNameNS(OOXML.W_NS, 'rPrChange').length) return;
    return [wrapper, run];
  };
  const a = dedicated(old[0]!, 'del'), b = dedicated(fresh[0]!, 'ins');
  if (!a || !b || a[0].parentNode !== b[0].parentNode) return;
  let next = a[0].nextSibling;
  while (next?.nodeType === 3 && !next.nodeValue?.trim()) next = next.nextSibling;
  if (next !== b[0]) return;
  const format = (run: Element) => childElements(run).filter(e => e.localName === 'rPr').map(e => serializer.serializeToString(e)).join('');
  if (format(a[1]) !== format(b[1])) return;
  const referenceProperties = (ref: Element) => Array.from(ref.attributes)
    .filter(attr => attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !(attr.namespaceURI === OOXML.W_NS && attr.localName === 'id'))
    .map(attr => `${attr.namespaceURI}:${attr.localName}=${attr.value}`).sort().join('|');
  if (referenceProperties(old[0]!) !== referenceProperties(fresh[0]!)) return;
  return [a[0], b[0], b[1], fresh[0]!];
}
