import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { ComparisonUnitAtom, DocxArchive, OpaquePassthroughNode } from '@usejunior/docx-core';
import { CorrelationStatus, OOXML, parseXml } from '@usejunior/docx-core';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

export class OpaquePassthroughError extends Error {
  constructor(message: string) {
    super(`Opaque passthrough: ${message}`);
    this.name = 'OpaquePassthroughError';
  }
}

interface PackageRelationship {
  id: string;
  type: string;
  target: string;
  mode: 'Internal' | 'External';
}

export interface OpaqueRelationshipInstrumentation {
  boundaryScans: number;
  relationshipIdentityComputations: number;
  relationshipPartReads: number;
  partHashComputations: number;
}

function relationshipPartPath(partPath: string): string {
  const directory = posix.dirname(partPath);
  return `${directory === '.' ? '' : `${directory}/`}_rels/${posix.basename(partPath)}.rels`;
}

function collectRelationshipIds(root: Element): string[] {
  const ids = new Set<string>();
  const visit = (element: Element): void => {
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!;
      if (attribute.namespaceURI === OFFICE_REL_NS) {
        if (!attribute.value) throw new OpaquePassthroughError('empty relationship-namespace attribute');
        ids.add(attribute.value);
      }
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(root);
  return [...ids].sort();
}

function normalizeInternalTarget(ownerPart: string, target: string): string {
  if (!target || target.includes('\\') || /[\u0000-\u001f\u007f?#]/.test(target)) {
    throw new OpaquePassthroughError(`unsafe internal relationship target '${target}'`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    throw new OpaquePassthroughError(`invalid encoded relationship target '${target}'`);
  }
  if (
    decoded.includes('\\') ||
    /[\u0000-\u001f\u007f?#]/.test(decoded) ||
    decoded.startsWith('//') ||
    decoded.includes(':')
  ) {
    throw new OpaquePassthroughError(`unsafe internal relationship target '${target}'`);
  }
  const segments = decoded.startsWith('/') ? [] : posix.dirname(ownerPart).split('/').filter(Boolean);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new OpaquePassthroughError(`relationship target escapes the package root: '${target}'`);
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) throw new OpaquePassthroughError(`empty resolved relationship target '${target}'`);
  return segments.join('/');
}

function normalizeExternalTarget(target: string): string {
  try {
    return new URL(target).href;
  } catch {
    throw new OpaquePassthroughError(`unsafe external relationship target '${target}'`);
  }
}

/** Memoized package-scoped relationship closure used only for opaque body blocks. */
export class OpaqueRelationshipClosureResolver {
  readonly instrumentation: OpaqueRelationshipInstrumentation = {
    boundaryScans: 0,
    relationshipIdentityComputations: 0,
    relationshipPartReads: 0,
    partHashComputations: 0,
  };
  private readonly relationshipsByPart = new Map<string, Promise<Map<string, PackageRelationship> | null>>();
  private readonly partHashes = new Map<string, Promise<string>>();
  private readonly closures = new Map<string, string>();
  private workQueue: Promise<void> = Promise.resolve();

  constructor(private readonly archive: DocxArchive) {}

  fingerprintBoundary(boundary: Element, ownerPart: string): Promise<string> {
    const task = this.workQueue.then(() => this.fingerprintBoundaryNow(boundary, ownerPart));
    this.workQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async fingerprintBoundaryNow(boundary: Element, ownerPart: string): Promise<string> {
    this.instrumentation.boundaryScans++;
    const ids = collectRelationshipIds(boundary);
    if (ids.length === 0) return '';
    const identities: string[] = [];
    for (const id of ids) identities.push(await this.relationshipIdentity(ownerPart, id, new Set()));
    return createHash('sha256').update(JSON.stringify(identities), 'utf8').digest('hex');
  }

  private async relationshipIdentity(ownerPart: string, id: string, active: Set<string>): Promise<string> {
    const key = `${ownerPart}\u0000${id}`;
    if (active.has(key)) {
      throw new OpaquePassthroughError(`cyclic relationship closure at ${ownerPart}#${id}`);
    }
    const cached = this.closures.get(key);
    if (cached) return cached;
    this.instrumentation.relationshipIdentityComputations++;
    const nextActive = new Set(active).add(key);
    const identity = await this.buildRelationshipIdentity(ownerPart, id, nextActive);
    this.closures.set(key, identity);
    return identity;
  }

  private async buildRelationshipIdentity(ownerPart: string, id: string, active: Set<string>): Promise<string> {
    const relationships = await this.relationshipsForPart(ownerPart);
    const relationship = relationships?.get(id);
    if (!relationship) throw new OpaquePassthroughError(`dangling relationship ${ownerPart}#${id}`);
    if (relationship.mode === 'External') {
      return JSON.stringify({
        id,
        type: relationship.type,
        mode: relationship.mode,
        target: normalizeExternalTarget(relationship.target),
      });
    }

    const targetPart = normalizeInternalTarget(ownerPart, relationship.target);
    const hash = await this.hashPart(targetPart);
    const dependentRelationships = await this.relationshipsForPart(targetPart);
    let dependencies: string[] = [];
    if (dependentRelationships) {
      if (!/\.(?:xml|vml)$/i.test(targetPart)) {
        throw new OpaquePassthroughError(`unsupported relationship-bearing target part '${targetPart}'`);
      }
      const targetBytes = await this.archive.getFileBuffer(targetPart);
      if (!targetBytes) throw new OpaquePassthroughError(`missing relationship target part '${targetPart}'`);
      const targetDocument = parseXml(targetBytes.toString('utf8'));
      const targetRoot = targetDocument.documentElement;
      if (!targetRoot) throw new OpaquePassthroughError(`relationship target is not XML '${targetPart}'`);
      const dependentIds = collectRelationshipIds(targetRoot);
      for (const dependentId of dependentIds) {
        dependencies.push(await this.relationshipIdentity(targetPart, dependentId, active));
      }
    }
    return JSON.stringify({
      id,
      type: relationship.type,
      mode: relationship.mode,
      resolvedTarget: targetPart,
      referencedPart: { path: targetPart, sha256: hash },
      dependencies,
    });
  }

  private relationshipsForPart(partPath: string): Promise<Map<string, PackageRelationship> | null> {
    const cached = this.relationshipsByPart.get(partPath);
    if (cached) return cached;
    const pending = (async () => {
      this.instrumentation.relationshipPartReads++;
      const xml = await this.archive.getFile(relationshipPartPath(partPath));
      if (xml === null) return null;
      const document = parseXml(xml);
      const elements = Array.from(document.getElementsByTagNameNS(PACKAGE_REL_NS, 'Relationship'));
      const relationships = new Map<string, PackageRelationship>();
      for (const element of elements) {
        const id = element.getAttribute('Id');
        const type = element.getAttribute('Type');
        const target = element.getAttribute('Target');
        const rawMode = element.getAttribute('TargetMode') || 'Internal';
        if (!id || !type || !target || (rawMode !== 'Internal' && rawMode !== 'External')) {
          throw new OpaquePassthroughError(`invalid relationship entry in '${relationshipPartPath(partPath)}'`);
        }
        if (relationships.has(id)) throw new OpaquePassthroughError(`duplicate relationship Id ${partPath}#${id}`);
        relationships.set(id, { id, type, target, mode: rawMode });
      }
      return relationships;
    })();
    this.relationshipsByPart.set(partPath, pending);
    return pending;
  }

  private hashPart(partPath: string): Promise<string> {
    const cached = this.partHashes.get(partPath);
    if (cached) return cached;
    const pending = (async () => {
      this.instrumentation.partHashComputations++;
      const bytes = await this.archive.getFileBuffer(partPath);
      if (!bytes) throw new OpaquePassthroughError(`missing relationship target part '${partPath}'`);
      return createHash('sha256').update(bytes).digest('hex');
    })();
    this.partHashes.set(partPath, pending);
    return pending;
  }
}

function isXmlnsAttribute(attribute: Attr): boolean {
  return attribute.namespaceURI === XMLNS_NS || attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:');
}

function namespacePrefix(attribute: Attr): string {
  if (attribute.name === 'xmlns') return '';
  return attribute.localName ?? attribute.name.slice('xmlns:'.length);
}

function effectiveNamespaces(element: Element): Record<string, string> {
  const lineage: Element[] = [];
  let current: Node | null = element;
  while (current?.nodeType === 1) {
    lineage.unshift(current as Element);
    current = current.parentNode;
  }

  const bindings: Record<string, string> = { xml: XML_NS };
  for (const node of lineage) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attribute = node.attributes.item(i)!;
      if (isXmlnsAttribute(attribute)) bindings[namespacePrefix(attribute)] = attribute.value;
    }
  }
  return bindings;
}

function elementLineage(element: Element): Element[] {
  const lineage: Element[] = [];
  let current: Node | null = element;
  while (current?.nodeType === 1) {
    lineage.unshift(current as Element);
    current = current.parentNode;
  }
  return lineage;
}

function effectiveMceDeclarations(element: Element): {
  values: Record<string, string>;
  qualifiedNames: Record<string, string>;
} {
  const tokens = new Map<string, string[]>();
  const qualifiedNames: Record<string, string> = {};
  for (const node of elementLineage(element)) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attribute = node.attributes.item(i)!;
      if (attribute.namespaceURI !== MC_NS) continue;
      const localName = attribute.localName ?? attribute.name;
      const accumulated = tokens.get(localName) ?? [];
      for (const token of attribute.value.trim().split(/\s+/).filter(Boolean)) {
        if (localName === 'Ignorable') {
          const declarationNamespace = node.lookupNamespaceURI(token);
          if (!declarationNamespace) {
            throw new OpaquePassthroughError(`mc:Ignorable names unbound prefix '${token}'`);
          }
          if (element.lookupNamespaceURI(token) !== declarationNamespace) {
            throw new OpaquePassthroughError(
              `inherited mc:Ignorable prefix '${token}' is shadowed at the opaque boundary`,
            );
          }
        }
        if (!accumulated.includes(token)) accumulated.push(token);
      }
      tokens.set(localName, accumulated);
      qualifiedNames[localName] = attribute.name;
    }
  }
  return {
    values: Object.fromEntries([...tokens].map(([name, values]) => [name, values.join(' ')])),
    qualifiedNames,
  };
}

function canonicalNode(node: Node): string {
  if (node.nodeType === 1) {
    const element = node as Element;
    const attributes: string[] = [];
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes.item(i)!;
      if (isXmlnsAttribute(attribute)) continue;
      attributes.push(
        `{${attribute.namespaceURI ?? ''}}${attribute.localName ?? attribute.name}=${JSON.stringify(attribute.value)}`,
      );
    }
    attributes.sort();
    const children: string[] = [];
    for (let i = 0; i < element.childNodes.length; i++) children.push(canonicalNode(element.childNodes[i]!));
    return `E{${element.namespaceURI ?? ''}}${element.localName ?? element.tagName}[${attributes.join(',')}](${children.join('')})`;
  }
  if (node.nodeType === 3 || node.nodeType === 4) return `T${JSON.stringify(node.nodeValue ?? '')}`;
  if (node.nodeType === 8) return `C${JSON.stringify(node.nodeValue ?? '')}`;
  return `N${node.nodeType}:${JSON.stringify(node.nodeValue ?? '')}`;
}

function semanticFingerprint(
  element: Element,
  bindings: Readonly<Record<string, string>>,
  mceDeclarations: Readonly<Record<string, string>>,
): string {
  const namespaceIdentity = Object.entries(bindings)
    .filter(([prefix]) => prefix !== 'xml')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, uri]) => `${prefix}=${uri}`)
    .join('\u0000');
  const mceIdentity = Object.entries(mceDeclarations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('\u0000');
  return createHash('sha256')
    .update(`${canonicalNode(element)}\u0001${namespaceIdentity}\u0001${mceIdentity}`, 'utf8')
    .digest('hex');
}

function nearestInlineBoundary(atom: ComparisonUnitAtom): Element | null {
  let paragraphIndex = -1;
  let boundaryIndex = -1;
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    const ancestor = atom.ancestorElements[i]!;
    if (paragraphIndex < 0 && ancestor.namespaceURI === OOXML.W_NS && ancestor.localName === 'p') {
      paragraphIndex = i;
    }
    if (boundaryIndex < 0 && ancestor.namespaceURI === OOXML.W_NS && ancestor.localName === 'sdt') {
      boundaryIndex = i;
    }
  }
  return paragraphIndex >= 0 && boundaryIndex > paragraphIndex
    ? atom.ancestorElements[boundaryIndex]!
    : null;
}

function nearestBodyBlockBoundary(atom: ComparisonUnitAtom): Element | null {
  for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
    const ancestor = atom.ancestorElements[i]!;
    if (ancestor.namespaceURI !== OOXML.W_NS || ancestor.localName !== 'sdt') continue;
    const parent = ancestor.parentNode;
    return parent?.nodeType === 1 &&
      (parent as Element).namespaceURI === OOXML.W_NS &&
      (parent as Element).localName === 'body'
      ? ancestor
      : null;
  }
  return null;
}

function nearestAncestor(element: Element, namespaceUri: string, localName: string): Element | null {
  let current: Node | null = element.parentNode;
  while (current?.nodeType === 1) {
    const candidate = current as Element;
    if (candidate.namespaceURI === namespaceUri && candidate.localName === localName) return candidate;
    current = current.parentNode;
  }
  return null;
}

function siblingOrdinal(element: Element): number {
  let ordinal = 0;
  let sibling = element.previousSibling;
  while (sibling) {
    if (
      sibling.nodeType === 1 &&
      (sibling as Element).namespaceURI === element.namespaceURI &&
      (sibling as Element).localName === element.localName
    ) {
      ordinal++;
    }
    sibling = sibling.previousSibling;
  }
  return ordinal;
}

function elementChildOrdinal(element: Element): number {
  let ordinal = 0;
  let sibling = element.previousSibling;
  while (sibling) {
    if (sibling.nodeType === 1) ordinal++;
    sibling = sibling.previousSibling;
  }
  return ordinal;
}

function structuralContainerIdentity(paragraph: Element): string {
  const parts: string[] = [];
  let current: Node | null = paragraph.parentNode;
  while (current?.nodeType === 1) {
    const element = current as Element;
    if (
      element.namespaceURI === OOXML.W_NS &&
      (element.localName === 'body' || element.localName === 'tbl' ||
        element.localName === 'tr' || element.localName === 'tc')
    ) {
      parts.unshift(`{${element.namespaceURI}}${element.localName}:${siblingOrdinal(element)}`);
    }
    current = current.parentNode;
  }
  return parts.join('/');
}

function withLocalNamespaceBindings(
  element: Element,
  inherited: Readonly<Record<string, string>>,
): Record<string, string> {
  const bindings = { ...inherited };
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (isXmlnsAttribute(attribute)) bindings[namespacePrefix(attribute)] = attribute.value;
  }
  return bindings;
}

function validateNamespaceOwnership(
  element: Element,
  inherited: Readonly<Record<string, string>>,
): void {
  const bindings = withLocalNamespaceBindings(element, inherited);
  if (element.prefix) {
    const ownedNamespace = bindings[element.prefix];
    if (!ownedNamespace || ownedNamespace !== element.namespaceURI) {
      throw new OpaquePassthroughError(
        `prefix '${element.prefix}' has unbound or conflicting element ownership`,
      );
    }
  }
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (isXmlnsAttribute(attribute) || !attribute.prefix || attribute.prefix === 'xml') continue;
    const ownedNamespace = bindings[attribute.prefix];
    if (!ownedNamespace || ownedNamespace !== attribute.namespaceURI) {
      throw new OpaquePassthroughError(
        `prefix '${attribute.prefix}' has unbound or conflicting attribute ownership`,
      );
    }
    if (attribute.namespaceURI === MC_NS && attribute.localName === 'Ignorable') {
      for (const prefix of attribute.value.trim().split(/\s+/).filter(Boolean)) {
        if (!bindings[prefix]) {
          throw new OpaquePassthroughError(`mc:Ignorable names unbound prefix '${prefix}'`);
        }
      }
    }
  }
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) validateNamespaceOwnership(child as Element, bindings);
  }
}

function validateIgnorableTokens(
  declarations: Readonly<Record<string, string>>,
  bindings: Readonly<Record<string, string>>,
): void {
  for (const prefix of (declarations.Ignorable ?? '').split(/\s+/).filter(Boolean)) {
    if (!bindings[prefix]) {
      throw new OpaquePassthroughError(`mc:Ignorable names unbound prefix '${prefix}'`);
    }
  }
}

function validateInlineSdtKnownStructure(boundary: Element): void {
  const directChildren = Array.from(boundary.childNodes)
    .filter((child): child is Element => child.nodeType === 1);
  for (const child of directChildren) {
    if (
      (child.localName === 'sdtPr' || child.localName === 'sdtContent') &&
      child.namespaceURI !== OOXML.W_NS
    ) {
      throw new OpaquePassthroughError(
        `known child '${child.localName}' has conflicting WordprocessingML namespace ownership`,
      );
    }
  }
  if (!directChildren.some(
    (child) => child.namespaceURI === OOXML.W_NS && child.localName === 'sdtContent',
  )) {
    throw new OpaquePassthroughError('inline w:sdt has no WordprocessingML w:sdtContent child');
  }
}

function validateBlockSdtKnownStructure(boundary: Element): Element[] {
  const directChildren = Array.from(boundary.childNodes)
    .filter((child): child is Element => child.nodeType === 1);
  const names = directChildren.map((child) =>
    child.namespaceURI === OOXML.W_NS ? child.localName : `{${child.namespaceURI}}${child.localName}`,
  );
  const expected = names[1] === 'sdtEndPr'
    ? ['sdtPr', 'sdtEndPr', 'sdtContent']
    : ['sdtPr', 'sdtContent'];
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new OpaquePassthroughError(
      'body-block w:sdt must contain ordered w:sdtPr, optional w:sdtEndPr, and w:sdtContent',
    );
  }
  const content = directChildren[directChildren.length - 1]!;
  if (content.getElementsByTagNameNS(OOXML.W_NS, 'tbl').length > 0) {
    throw new OpaquePassthroughError('tables inside a body-block w:sdt are outside the bounded placement');
  }
  const paragraphs = Array.from(content.getElementsByTagNameNS(OOXML.W_NS, 'p'));
  if (paragraphs.length === 0) {
    throw new OpaquePassthroughError('body-block w:sdt has no controlled paragraphs');
  }
  if (paragraphs.some((paragraph) => paragraph.parentNode !== content)) {
    throw new OpaquePassthroughError('body-block w:sdt paragraphs must be direct children of w:sdtContent');
  }
  return paragraphs;
}

/** Validate supported SDT namespace scope before atomization clones leaf nodes. */
export function validateSdtNamespaceOwnership(root: Element): void {
  for (const boundary of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'sdt'))) {
    const paragraph = nearestAncestor(boundary, OOXML.W_NS, 'p');
    const parent = boundary.parentNode;
    const isInline = paragraph && parent === paragraph;
    const isBodyBlock = parent?.nodeType === 1 &&
      (parent as Element).namespaceURI === OOXML.W_NS &&
      (parent as Element).localName === 'body';
    if (!isInline && !isBodyBlock) {
      throw new OpaquePassthroughError('w:sdt placement is outside inline-run and direct body-block support');
    }
    const bindings = effectiveNamespaces(boundary);
    if (bindings.w !== OOXML.W_NS) {
      throw new OpaquePassthroughError("inline w:sdt has conflicting 'w' namespace ownership");
    }
    if (nearestAncestor(boundary, OOXML.W_NS, 'sdt')) {
      throw new OpaquePassthroughError('nested w:sdt boundaries are outside the bounded passthrough contract');
    }
    if (isInline) validateInlineSdtKnownStructure(boundary);
    else validateBlockSdtKnownStructure(boundary);
    validateNamespaceOwnership(boundary, bindings);
  }
}

function materializeNamespaces(
  element: Element,
  bindings: Readonly<Record<string, string>>,
  mceDeclarations: Readonly<Record<string, string>>,
  mceQualifiedNames: Readonly<Record<string, string>>,
): Element {
  const clone = element.cloneNode(true) as Element;
  for (const [prefix, uri] of Object.entries(bindings)) {
    if (prefix === 'xml') continue;
    const attributeName = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
    const existing = clone.getAttribute(attributeName);
    if (existing !== null && existing !== uri) {
      throw new OpaquePassthroughError(`prefix '${prefix}' has conflicting boundary ownership`);
    }
    if (existing === null) clone.setAttributeNS(XMLNS_NS, attributeName, uri);
  }
  for (const [localName, value] of Object.entries(mceDeclarations)) {
    const qualifiedName = mceQualifiedNames[localName];
    if (!qualifiedName) throw new OpaquePassthroughError(`MCE declaration '${localName}' has no qualified name`);
    clone.setAttributeNS(MC_NS, qualifiedName, value);
  }
  return clone;
}

/**
 * Capture supported structured-document-tag boundaries without modeling their
 * property or extension vocabulary.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.36
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */
export function captureSdtPassthrough(root: Element, atoms: ComparisonUnitAtom[]): void {
  const descriptorByElement = new Map<Element, OpaquePassthroughNode>();
  const paragraphOrdinals = new Map(
    Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'p'))
      .map((paragraph, ordinal) => [paragraph, ordinal] as const),
  );
  let nextOrdinal = 0;
  for (const boundary of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'sdt'))) {
    const paragraph = nearestAncestor(boundary, OOXML.W_NS, 'p');
    if (nearestAncestor(boundary, OOXML.W_NS, 'sdt')) {
      throw new OpaquePassthroughError('nested w:sdt boundaries are outside the bounded passthrough contract');
    }
    const parent = boundary.parentNode;
    const isInline = paragraph && parent === paragraph;
    const isBodyBlock = parent?.nodeType === 1 &&
      (parent as Element).namespaceURI === OOXML.W_NS &&
      (parent as Element).localName === 'body';
    if (!isInline && !isBodyBlock) {
      throw new OpaquePassthroughError('w:sdt placement is outside inline-run and direct body-block support');
    }
    const bindings = effectiveNamespaces(boundary);
    const mceDeclarations = effectiveMceDeclarations(boundary);
    if (bindings.w !== OOXML.W_NS) {
      throw new OpaquePassthroughError("inline w:sdt has conflicting 'w' namespace ownership");
    }
    const blockParagraphs = isBodyBlock ? validateBlockSdtKnownStructure(boundary) : undefined;
    if (isInline) validateInlineSdtKnownStructure(boundary);
    validateNamespaceOwnership(boundary, bindings);
    validateIgnorableTokens(mceDeclarations.values, bindings);
    const ownedParagraph = isInline ? paragraph! : blockParagraphs![0]!;
    const paragraphOrdinal = paragraphOrdinals.get(ownedParagraph);
    if (paragraphOrdinal === undefined) {
      throw new OpaquePassthroughError('w:sdt paragraph has no source-order identity');
    }
    if (blockParagraphs) {
      for (let relative = 0; relative < blockParagraphs.length; relative++) {
        if (paragraphOrdinals.get(blockParagraphs[relative]!) !== paragraphOrdinal + relative) {
          throw new OpaquePassthroughError('body-block w:sdt paragraph ownership is non-contiguous');
        }
      }
    }
    descriptorByElement.set(boundary, {
      placementKind: isInline ? 'inline-run' : 'body-block',
      namespaceUri: OOXML.W_NS,
      localName: 'sdt',
      documentOrdinal: nextOrdinal++,
      paragraphOrdinal,
      containerIdentity: structuralContainerIdentity(ownedParagraph),
      bodyChildOrdinal: isBodyBlock ? elementChildOrdinal(boundary) : undefined,
      ownedParagraphCount: blockParagraphs?.length,
      semanticFingerprint: semanticFingerprint(boundary, bindings, mceDeclarations.values),
      sourceElement: materializeNamespaces(
        boundary,
        bindings,
        mceDeclarations.values,
        mceDeclarations.qualifiedNames,
      ),
      effectiveNamespaces: bindings,
      effectiveMceDeclarations: mceDeclarations.values,
    });
  }

  const ownedCounts = new Map<OpaquePassthroughNode, number>();
  for (const atom of atoms) {
    const boundary = nearestInlineBoundary(atom) ?? nearestBodyBlockBoundary(atom);
    if (!boundary) continue;
    const descriptor = descriptorByElement.get(boundary);
    if (!descriptor) {
      throw new OpaquePassthroughError('atom is owned by an unsupported inline w:sdt placement');
    }
    atom.opaquePassthrough = descriptor;
    if (descriptor.placementKind === 'body-block') {
      let atomParagraph: Element | undefined;
      for (let i = atom.ancestorElements.length - 1; i >= 0; i--) {
        const ancestor = atom.ancestorElements[i]!;
        if (ancestor.namespaceURI === OOXML.W_NS && ancestor.localName === 'p') {
          atomParagraph = ancestor;
          break;
        }
      }
      const atomParagraphOrdinal = atomParagraph ? paragraphOrdinals.get(atomParagraph) : undefined;
      if (atomParagraphOrdinal === undefined) {
        throw new OpaquePassthroughError('body-block atom has no controlled paragraph identity');
      }
      atom.opaquePassthroughRelativeParagraphOrdinal = atomParagraphOrdinal - descriptor.paragraphOrdinal;
    }
    ownedCounts.set(descriptor, (ownedCounts.get(descriptor) ?? 0) + 1);
  }
  for (const descriptor of descriptorByElement.values()) {
    if (!ownedCounts.has(descriptor)) {
      throw new OpaquePassthroughError(`boundary ${descriptor.documentOrdinal} has no atomizable controlled content`);
    }
  }
}

function uniqueDescriptors(atoms: ComparisonUnitAtom[]): OpaquePassthroughNode[] {
  const seen = new Set<OpaquePassthroughNode>();
  const result: OpaquePassthroughNode[] = [];
  for (const atom of atoms) {
    const descriptor = atom.opaquePassthrough;
    if (!descriptor || seen.has(descriptor)) continue;
    seen.add(descriptor);
    result.push(descriptor);
  }
  return result.sort((a, b) => a.documentOrdinal - b.documentOrdinal);
}

/** Validate and bind original/revised opaque occurrences before LCS reconstruction. */
export async function bindOpaquePassthroughCounterparts(
  originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
  originalRelationships: OpaqueRelationshipClosureResolver,
  revisedRelationships: OpaqueRelationshipClosureResolver,
  ownerPart: string,
): Promise<void> {
  const original = uniqueDescriptors(originalAtoms);
  const revised = uniqueDescriptors(revisedAtoms);
  if (original.length !== revised.length) {
    throw new OpaquePassthroughError(`boundary count changed (${original.length} original, ${revised.length} revised)`);
  }
  const placementKey = (descriptor: OpaquePassthroughNode) =>
    descriptor.placementKind === 'inline-run'
      ? `inline\u0000${descriptor.containerIdentity}\u0000${descriptor.paragraphOrdinal}\u0000${descriptor.documentOrdinal}`
      : `block\u0000${descriptor.containerIdentity}\u0000${descriptor.bodyChildOrdinal}\u0000` +
        `${descriptor.paragraphOrdinal}\u0000${descriptor.ownedParagraphCount}`;
  original.sort((left, right) => placementKey(left).localeCompare(placementKey(right)));
  revised.sort((left, right) => placementKey(left).localeCompare(placementKey(right)));
  await Promise.all([
    ...original.filter((descriptor) => descriptor.placementKind === 'body-block').map(async (descriptor) => {
      descriptor.relationshipClosureFingerprint = await originalRelationships.fingerprintBoundary(
        descriptor.sourceElement,
        ownerPart,
      );
    }),
    ...revised.filter((descriptor) => descriptor.placementKind === 'body-block').map(async (descriptor) => {
      descriptor.relationshipClosureFingerprint = await revisedRelationships.fingerprintBoundary(
        descriptor.sourceElement,
        ownerPart,
      );
    }),
  ]);
  for (let i = 0; i < original.length; i++) {
    const before = original[i]!;
    const after = revised[i]!;
    if (
      placementKey(before) !== placementKey(after) ||
      before.placementKind !== after.placementKind ||
      before.paragraphOrdinal !== after.paragraphOrdinal ||
      before.containerIdentity !== after.containerIdentity ||
      before.namespaceUri !== after.namespaceUri ||
      before.localName !== after.localName ||
      before.bodyChildOrdinal !== after.bodyChildOrdinal ||
      before.ownedParagraphCount !== after.ownedParagraphCount ||
      before.semanticFingerprint !== after.semanticFingerprint ||
      before.relationshipClosureFingerprint !== after.relationshipClosureFingerprint
    ) {
      throw new OpaquePassthroughError(`boundary ${i} changed paragraph ownership, moved, or mutated`);
    }
    before.correlatedNode = after;
    after.emissionElement = before.sourceElement;
  }
}

/** Reject opaque correlation loss before any whole-paragraph branch can emit. */
export function validateOpaquePassthroughCorrelation(atoms: ComparisonUnitAtom[]): void {
  const paragraphByDescriptor = new Map<OpaquePassthroughNode, number | undefined>();
  const relativeParagraphsByDescriptor = new Map<OpaquePassthroughNode, Set<number>>();
  for (const atom of atoms) {
    let descriptor = atom.opaquePassthrough;
    if (!descriptor) continue;
    if (atom.correlationStatus !== CorrelationStatus.Equal) {
      throw new OpaquePassthroughError(
        `boundary ${descriptor.documentOrdinal} lost equal correlation (${atom.correlationStatus})`,
      );
    }
    if (
      atom.sourceDocument === 'original' &&
      atom.contentElement.tagName === '__emptyParagraph__' &&
      descriptor.correlatedNode
    ) {
      descriptor = descriptor.correlatedNode;
      atom.opaquePassthrough = descriptor;
    }
    if (!descriptor.emissionElement ||
      (atom.sourceDocument !== 'revised' && atom.contentElement.tagName !== '__emptyParagraph__')) {
      throw new OpaquePassthroughError(
        `boundary ${descriptor.documentOrdinal} has no validated revised-side owner`,
      );
    }
    if (descriptor.placementKind === 'body-block') {
      const relative = atom.opaquePassthroughRelativeParagraphOrdinal;
      if (
        relative === undefined ||
        relative < 0 ||
        relative >= (descriptor.ownedParagraphCount ?? 0)
      ) {
        throw new OpaquePassthroughError(
          `boundary ${descriptor.documentOrdinal} has changed relative paragraph ownership`,
        );
      }
      const seen = relativeParagraphsByDescriptor.get(descriptor) ?? new Set<number>();
      seen.add(relative);
      relativeParagraphsByDescriptor.set(descriptor, seen);
    } else if (!paragraphByDescriptor.has(descriptor)) {
      paragraphByDescriptor.set(descriptor, atom.paragraphIndex);
    } else if (paragraphByDescriptor.get(descriptor) !== atom.paragraphIndex) {
      throw new OpaquePassthroughError(
        `boundary ${descriptor.documentOrdinal} crossed reconstructed paragraph ownership`,
      );
    }
  }
  for (const [descriptor, seen] of relativeParagraphsByDescriptor) {
    if (seen.size !== descriptor.ownedParagraphCount) {
      throw new OpaquePassthroughError(
        `boundary ${descriptor.documentOrdinal} lost controlled paragraph correlation`,
      );
    }
  }
}

/**
 * Render validated opaque nodes once while delegating ordinary atom slices to
 * the caller. Extension payload preservation here is a SafeDocX metamorphic
 * invariant, not a claim imposed by an external standard.
 */
export function renderOpaqueAtomSequence(
  groups: Array<{ status: CorrelationStatus; atoms: ComparisonUnitAtom[]; rPr: Element | null; moveName?: string }>,
  renderOrdinary: (groups: Array<{ status: CorrelationStatus; atoms: ComparisonUnitAtom[]; rPr: Element | null; moveName?: string }>) => string,
  serialize: (element: Element) => string,
): string {
  const output: string[] = [];
  let ordinary: typeof groups = [];
  const emitted = new Set<OpaquePassthroughNode>();
  const closed = new Set<OpaquePassthroughNode>();
  let active: OpaquePassthroughNode | undefined;
  let lastEmittedOrdinal = -1;
  const flushOrdinary = () => {
    if (ordinary.length > 0) output.push(renderOrdinary(ordinary));
    ordinary = [];
  };

  for (const group of groups) {
    let pendingAtoms: ComparisonUnitAtom[] = [];
    const flushPending = () => {
      if (pendingAtoms.length > 0) ordinary.push({ ...group, atoms: pendingAtoms });
      pendingAtoms = [];
    };
    for (const atom of group.atoms) {
      const descriptor = atom.opaquePassthrough;
      if (!descriptor) {
        if (active) {
          closed.add(active);
          active = undefined;
        }
        pendingAtoms.push(atom);
        continue;
      }
      if (descriptor.placementKind !== 'inline-run') {
        throw new OpaquePassthroughError('body-block boundary reached paragraph-run emission');
      }
      if (descriptor !== active) {
        if (active) closed.add(active);
        if (closed.has(descriptor)) {
          throw new OpaquePassthroughError(`boundary ${descriptor.documentOrdinal} is non-contiguous`);
        }
        if (descriptor.documentOrdinal <= lastEmittedOrdinal) {
          throw new OpaquePassthroughError(`boundary ${descriptor.documentOrdinal} violates source order`);
        }
        active = descriptor;
        lastEmittedOrdinal = descriptor.documentOrdinal;
      }
      flushPending();
      flushOrdinary();
      if (atom.correlationStatus !== CorrelationStatus.Equal) {
        throw new OpaquePassthroughError(`boundary ${descriptor.documentOrdinal} contains a non-equal atom`);
      }
      if (!descriptor.emissionElement) {
        throw new OpaquePassthroughError(`boundary ${descriptor.documentOrdinal} has no validated original owner`);
      }
      if (!emitted.has(descriptor)) {
        output.push(serialize(descriptor.emissionElement));
        emitted.add(descriptor);
      }
    }
    flushPending();
  }
  flushOrdinary();
  return output.join('');
}

export function sameOpaqueOwner(a: ComparisonUnitAtom, b: ComparisonUnitAtom): boolean {
  return a.opaquePassthrough === b.opaquePassthrough;
}
