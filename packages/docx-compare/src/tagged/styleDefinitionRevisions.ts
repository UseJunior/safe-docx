import { DocxArchive, OOXML, normalizeOpcRelationshipTarget, parseXml, serializeXml } from '@usejunior/docx-core';
import { formatDate, revisionStoryPartPaths } from './revisionMarkup.js';

const W = OOXML.W_NS;
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STYLES_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export interface StyleDefinitionRevisionOptions {
  author: string;
  date?: Date;
}

/** The styles part the main story's relationships name, or undefined. */
async function stylesPartPath(archive: DocxArchive): Promise<string | undefined> {
  const relationshipsXml = await archive.getFile('word/_rels/document.xml.rels');
  if (relationshipsXml === null) return undefined;
  for (const relationship of Array.from(parseXml(relationshipsXml).getElementsByTagNameNS(PACKAGE_RELATIONSHIPS_NS, 'Relationship'))) {
    if (relationship.getAttribute('TargetMode') === 'External') continue;
    if (relationship.getAttribute('Type') !== STYLES_RELATIONSHIP_TYPE) continue;
    const target = relationship.getAttribute('Target');
    if (!target) continue;
    const path = normalizeOpcRelationshipTarget({ ownerPart: 'word/document.xml', target }).target;
    if (path && archive.hasFile(path)) return path;
  }
  return undefined;
}

const children = (element: Element | null | undefined): Element[] => {
  const result: Element[] = [];
  for (let child = element?.firstChild ?? null; child; child = child.nextSibling) {
    if (child.nodeType === 1) result.push(child as Element);
  }
  return result;
};

const wChild = (element: Element | null | undefined, name: string): Element | undefined =>
  children(element).find((child) => child.namespaceURI === W && child.localName === name);

/** Order- and prefix-insensitive form of a property element's content. */
function canonical(element: Element | undefined, skip: string): string {
  if (!element) return '';
  const visit = (node: Element): string => {
    const attributes = Array.from(node.attributes)
      .filter((attribute) => attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:'))
      .map((attribute) => `${attribute.namespaceURI ?? ''}|${attribute.localName}=${attribute.value}`)
      .sort();
    return `<${node.namespaceURI ?? ''}|${node.localName} ${attributes.join(' ')}>${children(node).map(visit).join('')}</>`;
  };
  return children(element)
    .filter((child) => !(child.namespaceURI === W && child.localName === skip))
    .map(visit).join('');
}

interface PropertySlot {
  /** The property container name (`pPr` or `rPr`). */
  container: 'pPr' | 'rPr';
  /** Its change-record child (`pPrChange` or `rPrChange`). */
  change: 'pPrChange' | 'rPrChange';
}

const SLOTS: readonly PropertySlot[] = [
  { container: 'pPr', change: 'pPrChange' },
  { container: 'rPr', change: 'rPrChange' },
];

/**
 * The properties a side shows once its own pending record is rejected: the
 * record's snapshot when there is one, else the current properties.
 */
function rejectedProperties(properties: Element | undefined, slot: PropertySlot): string {
  const record = wChild(properties, slot.change);
  return record ? canonical(wChild(record, slot.container), '') : canonical(properties, slot.change);
}

/**
 * The style definitions and document defaults a redline's styles part holds,
 * keyed so the same definition can be found on the other side.
 */
function definitionHosts(root: Element): Map<string, Element> {
  const hosts = new Map<string, Element>();
  const defaults = wChild(root, 'docDefaults');
  const rPrDefault = wChild(defaults, 'rPrDefault');
  const pPrDefault = wChild(defaults, 'pPrDefault');
  if (rPrDefault) hosts.set('defaults|rPr', rPrDefault);
  if (pPrDefault) hosts.set('defaults|pPr', pPrDefault);
  for (const style of children(root)) {
    if (style.namespaceURI !== W || style.localName !== 'style') continue;
    const key = `style|${style.getAttributeNS(W, 'type') || 'paragraph'}|${style.getAttributeNS(W, 'styleId') ?? ''}`;
    if (hosts.has(key)) {
      // A duplicated identifier cannot be paired reliably.
      hosts.set(key, undefined as unknown as Element);
      continue;
    }
    hosts.set(key, style);
  }
  return hosts;
}

/** Whether a host may hold the slot (document defaults hold only their own). */
function hostHolds(key: string, slot: PropertySlot): boolean {
  return !key.startsWith('defaults|') || key === `defaults|${slot.container}`;
}

/** Insert a property container where CT_Style expects it (pPr before rPr, both after the header elements). */
function ensureContainer(host: Element, slot: PropertySlot): Element {
  const existing = wChild(host, slot.container);
  if (existing) return existing;
  const document = host.ownerDocument!;
  const container = document.createElementNS(W, `w:${slot.container}`);
  const after = slot.container === 'pPr'
    ? ['rPr', 'tblPr', 'trPr', 'tcPr', 'tblStylePr']
    : ['tblPr', 'trPr', 'tcPr', 'tblStylePr'];
  const before = children(host).find((child) => child.namespaceURI === W && after.includes(child.localName));
  host.insertBefore(container, before ?? null);
  return container;
}

/**
 * Track the formatting a style definition or the document defaults change
 * between the two documents. The redline is built on the revised package, so
 * its styles part holds the revised definitions; a paragraph or run whose
 * style reference is the same on both sides (in the body, a note or any other
 * story) would otherwise show the revised formatting after Reject All. Each
 * paired definition whose paragraph or run properties differ gets a
 * `w:pPrChange` / `w:rPrChange` holding the original's properties, the
 * revision record ECMA-376 allows inside a style's and the defaults'
 * property containers.
 *
 * A record the original already carries is kept (with its author) when the
 * current properties are unchanged; otherwise the original's Reject
 * projection is recorded, so Reject All restores what the original shows
 * after its own Reject All.
 *
 * Left out: definitions only one side holds, and changes outside `w:pPr` /
 * `w:rPr` (`w:basedOn`, table-style properties), for which WordprocessingML
 * has no revision record.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.4.17
 * @conformance ECMA-376 edition 5, Part 1 § 17.7.5.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @see https://github.com/UseJunior/safe-docx/issues/1578
 */
export async function trackStyleDefinitionChanges(
  original: Buffer,
  compared: Buffer,
  options: StyleDefinitionRevisionOptions,
): Promise<Buffer> {
  const originalArchive = await DocxArchive.load(original);
  const comparedArchive = await DocxArchive.load(compared);
  const originalPath = await stylesPartPath(originalArchive);
  const comparedPath = await stylesPartPath(comparedArchive);
  if (!originalPath || !comparedPath) return compared;
  const originalXml = await originalArchive.getFile(originalPath);
  const comparedXml = await comparedArchive.getFile(comparedPath);
  if (originalXml === null || comparedXml === null) return compared;
  const originalRoot = parseXml(originalXml).documentElement;
  const comparedDocument = parseXml(comparedXml);
  const comparedRoot = comparedDocument.documentElement;
  if (originalRoot.namespaceURI !== W || comparedRoot.namespaceURI !== W) return compared;

  const originalHosts = definitionHosts(originalRoot);
  const comparedHosts = definitionHosts(comparedRoot);
  const pending: Array<{ host: Element; slot: PropertySlot; record: Element }> = [];
  for (const [key, comparedHost] of comparedHosts) {
    const originalHost = originalHosts.get(key);
    if (!comparedHost || !originalHost) continue;
    for (const slot of SLOTS) {
      if (!hostHolds(key, slot)) continue;
      const originalProperties = wChild(originalHost, slot.container);
      const comparedProperties = wChild(comparedHost, slot.container);
      const target = rejectedProperties(originalProperties, slot);
      if (rejectedProperties(comparedProperties, slot) === target) continue;
      const originalRecord = wChild(originalProperties, slot.change);
      let record: Element;
      if (originalRecord && canonical(originalProperties, slot.change) === canonical(comparedProperties, slot.change)) {
        record = comparedDocument.importNode(originalRecord, true) as Element;
      } else {
        record = comparedDocument.createElementNS(W, `w:${slot.change}`);
        record.setAttributeNS(W, 'w:author', options.author);
        if (options.date) record.setAttributeNS(W, 'w:date', formatDate(options.date));
        const snapshot = comparedDocument.createElementNS(W, `w:${slot.container}`);
        const source = originalRecord ? wChild(originalRecord, slot.container) : originalProperties;
        for (const child of children(source)) {
          if (child.namespaceURI === W && child.localName === slot.change) continue;
          snapshot.appendChild(comparedDocument.importNode(child, true));
        }
        record.appendChild(snapshot);
      }
      pending.push({ host: comparedHost, slot, record });
    }
  }
  if (pending.length === 0) return compared;

  // Identifiers stay unique across the package's revisions.
  let maximum = 0;
  for (const path of [...await revisionStoryPartPaths(comparedArchive), comparedPath]) {
    const xml = path === comparedPath ? comparedXml : await comparedArchive.getFile(path);
    if (xml === null) continue;
    for (const match of xml.matchAll(/\bw:id="(\d+)"/gu)) maximum = Math.max(maximum, Number(match[1]));
  }
  for (const { host, slot, record } of pending) {
    const container = ensureContainer(host, slot);
    const stale = wChild(container, slot.change);
    if (stale) container.removeChild(stale);
    record.setAttributeNS(W, 'w:id', String(++maximum));
    container.appendChild(record);
  }
  const serialized = serializeXml(comparedDocument);
  comparedArchive.setFile(comparedPath, serialized.startsWith('<?xml') ? serialized : XML_DECLARATION + serialized);
  return comparedArchive.save();
}
