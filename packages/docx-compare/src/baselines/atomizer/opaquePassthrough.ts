import { createHash } from 'node:crypto';
import type { ComparisonUnitAtom, OpaquePassthroughNode } from '@usejunior/docx-core';
import { CorrelationStatus, OOXML } from '@usejunior/docx-core';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export class OpaquePassthroughError extends Error {
  constructor(message: string) {
    super(`Opaque passthrough: ${message}`);
    this.name = 'OpaquePassthroughError';
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

function nearestAncestor(element: Element, namespaceUri: string, localName: string): Element | null {
  let current: Node | null = element.parentNode;
  while (current?.nodeType === 1) {
    const candidate = current as Element;
    if (candidate.namespaceURI === namespaceUri && candidate.localName === localName) return candidate;
    current = current.parentNode;
  }
  return null;
}

function validateMceBindings(element: Element, bindings: Readonly<Record<string, string>>): void {
  const descendants = [element, ...Array.from(element.getElementsByTagName('*'))];
  for (const descendant of descendants) {
    for (let i = 0; i < descendant.attributes.length; i++) {
      const attribute = descendant.attributes.item(i)!;
      if (attribute.namespaceURI !== MC_NS || attribute.localName !== 'Ignorable') continue;
      for (const prefix of attribute.value.trim().split(/\s+/).filter(Boolean)) {
        if (!bindings[prefix]) {
          throw new OpaquePassthroughError(`mc:Ignorable names unbound prefix '${prefix}'`);
        }
      }
    }
  }
}

function validateNamespaceOwnership(element: Element, bindings: Readonly<Record<string, string>>): void {
  const descendants = [element, ...Array.from(element.getElementsByTagName('*'))];
  for (const descendant of descendants) {
    if (descendant.prefix && bindings[descendant.prefix] !== descendant.namespaceURI) {
      throw new OpaquePassthroughError(
        `prefix '${descendant.prefix}' has conflicting element ownership`,
      );
    }
    for (let i = 0; i < descendant.attributes.length; i++) {
      const attribute = descendant.attributes.item(i)!;
      if (isXmlnsAttribute(attribute) || !attribute.prefix || attribute.prefix === 'xml') continue;
      if (bindings[attribute.prefix] !== attribute.namespaceURI) {
        throw new OpaquePassthroughError(
          `prefix '${attribute.prefix}' has conflicting attribute ownership`,
        );
      }
    }
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
 * Capture the pilot's inline structured-document-tag boundary without modeling
 * its property or extension vocabulary.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.36
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */
export function captureInlineSdtPassthrough(root: Element, atoms: ComparisonUnitAtom[]): void {
  const descriptorByElement = new Map<Element, OpaquePassthroughNode>();
  let nextOrdinal = 0;
  for (const boundary of Array.from(root.getElementsByTagNameNS(OOXML.W_NS, 'sdt'))) {
    const paragraph = nearestAncestor(boundary, OOXML.W_NS, 'p');
    if (!paragraph) continue; // Block/cell/row SDTs remain scaffold-owned and out of pilot scope.
    if (nearestAncestor(boundary, OOXML.W_NS, 'sdt')) {
      throw new OpaquePassthroughError('nested inline w:sdt boundaries are outside the pilot');
    }
    if (boundary.parentNode !== paragraph) {
      throw new OpaquePassthroughError('inline w:sdt must be a direct child of w:p in the pilot');
    }
    const bindings = effectiveNamespaces(boundary);
    const mceDeclarations = effectiveMceDeclarations(boundary);
    if (bindings.w !== OOXML.W_NS) {
      throw new OpaquePassthroughError("inline w:sdt has conflicting 'w' namespace ownership");
    }
    validateNamespaceOwnership(boundary, bindings);
    validateMceBindings(boundary, bindings);
    validateIgnorableTokens(mceDeclarations.values, bindings);
    descriptorByElement.set(boundary, {
      namespaceUri: OOXML.W_NS,
      localName: 'sdt',
      documentOrdinal: nextOrdinal++,
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
    const boundary = nearestInlineBoundary(atom);
    if (!boundary) continue;
    const descriptor = descriptorByElement.get(boundary);
    if (!descriptor) {
      throw new OpaquePassthroughError('atom is owned by an unsupported inline w:sdt placement');
    }
    atom.opaquePassthrough = descriptor;
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
export function bindOpaquePassthroughCounterparts(
  originalAtoms: ComparisonUnitAtom[],
  revisedAtoms: ComparisonUnitAtom[],
): void {
  const original = uniqueDescriptors(originalAtoms);
  const revised = uniqueDescriptors(revisedAtoms);
  if (original.length !== revised.length) {
    throw new OpaquePassthroughError(`boundary count changed (${original.length} original, ${revised.length} revised)`);
  }
  for (let i = 0; i < original.length; i++) {
    const before = original[i]!;
    const after = revised[i]!;
    if (
      before.documentOrdinal !== after.documentOrdinal ||
      before.namespaceUri !== after.namespaceUri ||
      before.localName !== after.localName ||
      before.semanticFingerprint !== after.semanticFingerprint
    ) {
      throw new OpaquePassthroughError(`boundary ${i} changed or moved`);
    }
    after.emissionElement = before.sourceElement;
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
