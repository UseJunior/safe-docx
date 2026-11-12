/**
 * Read and write a package's document properties: the Core Properties part
 * (`docProps/core.xml`, OPC Dublin Core metadata) and the Extended File
 * Properties part (`docProps/app.xml`, application metadata).
 *
 * Both parts are located through the package relationships, never by a fixed
 * path, and both are edited element by element: a write replaces or removes
 * only the named property elements and keeps every other element, attribute,
 * namespace declaration and extension in the part. A document without one of
 * the parts gets it created, with its package relationship and content-type
 * override, only when a write sets a value in it.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 8.2
 * @conformance ECMA-376 edition 5, Part 2 § 8.3.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 22.2
 * @see https://github.com/UseJunior/safe-docx/issues/1201
 */

import { OOXML } from './namespaces.js';
import { normalizeOpcRelationshipTarget } from './opc-target.js';
import { parseXml, serializeXml, XML_DECL } from './xml.js';
import type { DocxZip } from './zip.js';

export const CORE_PROPERTIES_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
export const DC_NS = 'http://purl.org/dc/elements/1.1/';
export const DCTERMS_NS = 'http://purl.org/dc/terms/';
export const DCMITYPE_NS = 'http://purl.org/dc/dcmitype/';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Extended-properties namespaces: transitional (what Word writes) and strict. */
export const EXTENDED_PROPERTIES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
export const EXTENDED_PROPERTIES_STRICT_NS = 'http://purl.oclc.org/ooxml/officeDocument/extendedProperties';
const DOCPROPS_VTYPES_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';

export const CORE_PROPERTIES_CONTENT_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
export const EXTENDED_PROPERTIES_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.extended-properties+xml';

/** Package relationship types that name the Core Properties part (the second is a legacy spelling some producers write). */
export const CORE_PROPERTIES_REL_TYPES = [
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  'http://schemas.openxmlformats.org/officedocument/2006/relationships/metadata/core-properties',
] as const;
/** Package relationship types that name the Extended File Properties part: transitional, then strict. */
export const EXTENDED_PROPERTIES_REL_TYPES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/extendedProperties',
] as const;

const PACKAGE_RELS_PATH = '_rels/.rels';
const CONTENT_TYPES_PATH = '[Content_Types].xml';

/**
 * Every core property read back, by its camelCase name, with the element it
 * is stored as. `cp` is the core-properties namespace.
 */
const CORE_PROPERTY_ELEMENTS = {
  title: { ns: DC_NS, prefix: 'dc', localName: 'title' },
  subject: { ns: DC_NS, prefix: 'dc', localName: 'subject' },
  creator: { ns: DC_NS, prefix: 'dc', localName: 'creator' },
  keywords: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'keywords' },
  description: { ns: DC_NS, prefix: 'dc', localName: 'description' },
  category: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'category' },
  contentStatus: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'contentStatus' },
  language: { ns: DC_NS, prefix: 'dc', localName: 'language' },
  identifier: { ns: DC_NS, prefix: 'dc', localName: 'identifier' },
  version: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'version' },
  lastModifiedBy: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'lastModifiedBy' },
  revision: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'revision' },
  created: { ns: DCTERMS_NS, prefix: 'dcterms', localName: 'created' },
  modified: { ns: DCTERMS_NS, prefix: 'dcterms', localName: 'modified' },
  lastPrinted: { ns: CORE_PROPERTIES_NS, prefix: 'cp', localName: 'lastPrinted' },
} as const;

export type CoreDocumentPropertyName = keyof typeof CORE_PROPERTY_ELEMENTS;
export const CORE_DOCUMENT_PROPERTY_NAMES = Object.keys(CORE_PROPERTY_ELEMENTS) as CoreDocumentPropertyName[];

/** The core properties a caller may set or remove. The rest are read only. */
export const WRITABLE_CORE_DOCUMENT_PROPERTY_NAMES = [
  'title',
  'subject',
  'creator',
  'keywords',
  'description',
  'category',
  'contentStatus',
  'language',
  'lastModifiedBy',
  'revision',
  'created',
  'modified',
] as const satisfies readonly CoreDocumentPropertyName[];
export type WritableCoreDocumentPropertyName = (typeof WRITABLE_CORE_DOCUMENT_PROPERTY_NAMES)[number];

/** The extended (application) properties read and written, by camelCase name, with their element local names. */
const APP_PROPERTY_ELEMENTS = {
  application: 'Application',
  appVersion: 'AppVersion',
  company: 'Company',
  manager: 'Manager',
  template: 'Template',
} as const;

export type AppDocumentPropertyName = keyof typeof APP_PROPERTY_ELEMENTS;
export const APP_DOCUMENT_PROPERTY_NAMES = Object.keys(APP_PROPERTY_ELEMENTS) as AppDocumentPropertyName[];

export type DocumentProperties = {
  /** Each core property's text, or null when the element (or the part) is absent. */
  core: Record<CoreDocumentPropertyName, string | null>;
  /** Each extended property's text, or null when the element (or the part) is absent. */
  app: Record<AppDocumentPropertyName, string | null>;
  /** Package path of the Core Properties part, or null when the package has none. */
  corePart: string | null;
  /** Package path of the Extended File Properties part, or null when the package has none. */
  appPart: string | null;
};

/**
 * A partial write: a string sets the property, null removes its element, and
 * an absent key leaves it as it is.
 */
export type DocumentPropertiesMutation = {
  core?: Partial<Record<WritableCoreDocumentPropertyName, string | null>>;
  app?: Partial<Record<AppDocumentPropertyName, string | null>>;
};

export type DocumentPropertiesMutationResult = {
  /** False when every requested value already held: nothing was written. */
  changed: boolean;
  previous: DocumentProperties;
  current: DocumentProperties;
  /** Parts created by this write (with their relationship and content-type override). */
  partsCreated: string[];
  /** Every package part this write rewrote, created ones included, in a fixed order. */
  partsChanged: string[];
};

export type DocumentPropertiesErrorCode =
  | 'INVALID_DOCUMENT_PROPERTY'
  | 'EMPTY_DOCUMENT_PROPERTIES_MUTATION'
  | 'INVALID_DOCUMENT_PROPERTIES_PART';

export class DocumentPropertiesError extends Error {
  constructor(
    public readonly code: DocumentPropertiesErrorCode,
    message: string,
    /** The property the error is about, as `core.<name>` or `app.<name>`. */
    public readonly property?: string,
  ) {
    super(message);
    this.name = 'DocumentPropertiesError';
  }
}

const W3CDTF_RE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2})))?)?)?$/u;

/**
 * True for a W3CDTF date or date-time (the ISO 8601 profile `dcterms:W3CDTF`
 * names): `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or a date with `Thh:mm`,
 * `Thh:mm:ss` or `Thh:mm:ss.s` and a time zone (`Z` or `±hh:mm`), with every
 * field in range and the day existing in its month.
 */
export function isW3cdtfDate(value: string): boolean {
  const match = W3CDTF_RE.exec(value);
  if (!match) return false;
  const [, , month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const year = Number(match[1]);
  if (month !== undefined && (Number(month) < 1 || Number(month) > 12)) return false;
  if (day !== undefined) {
    const daysInMonth = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
    if (Number(day) < 1 || Number(day) > daysInMonth) return false;
  }
  if (hour !== undefined && Number(hour) > 23) return false;
  if (minute !== undefined && Number(minute) > 59) return false;
  if (second !== undefined && Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

/** Characters XML 1.0 cannot carry (C0 controls but tab, LF and CR; U+FFFE/U+FFFF; lone surrogates). */
const XML_ILLEGAL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const APP_VERSION_RE = /^\d{2}\.\d{4}$/u;
const LANGUAGE_TAG_RE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const REVISION_RE = /^\d{1,9}$/u;

function invalid(property: string, message: string): never {
  throw new DocumentPropertiesError('INVALID_DOCUMENT_PROPERTY', `${property} ${message}`, property);
}

/**
 * Check one value of a write. Strings must be non-empty (null removes a
 * property) and hold only characters XML 1.0 allows; markup characters are
 * escaped on serialization. `created` and `modified` must be W3CDTF dates,
 * `revision` a non-negative integer, `appVersion` of the form `XX.YYYY`, and
 * `language` a language tag such as `en-US`.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 22.2
 */
export function validateDocumentPropertyValue(
  part: 'core' | 'app',
  name: string,
  value: unknown,
): void {
  const property = `${part}.${name}`;
  const known = part === 'core'
    ? (WRITABLE_CORE_DOCUMENT_PROPERTY_NAMES as readonly string[]).includes(name)
    : (APP_DOCUMENT_PROPERTY_NAMES as readonly string[]).includes(name);
  if (!known) {
    const allowed = part === 'core' ? WRITABLE_CORE_DOCUMENT_PROPERTY_NAMES : APP_DOCUMENT_PROPERTY_NAMES;
    invalid(property, `is not a settable property; ${part} accepts ${allowed.join(', ')}.`);
  }
  if (value === null) return;
  if (typeof value !== 'string') invalid(property, 'must be a string, or null to remove it.');
  if (value.length === 0) invalid(property, 'must not be empty; pass null to remove it.');
  if (XML_ILLEGAL_RE.test(value)) invalid(property, 'contains a character XML cannot carry (a control character or a lone surrogate).');
  if (part === 'core' && (name === 'created' || name === 'modified') && !isW3cdtfDate(value)) {
    invalid(property, `must be a W3CDTF date such as 2026-01-02 or 2026-01-02T03:04:05Z, got '${value}'.`);
  }
  if (part === 'core' && name === 'revision' && !REVISION_RE.test(value)) {
    invalid(property, `must be a non-negative integer, got '${value}'.`);
  }
  if (part === 'core' && name === 'language' && !LANGUAGE_TAG_RE.test(value)) {
    invalid(property, `must be a language tag such as en-US, got '${value}'.`);
  }
  if (part === 'app' && name === 'appVersion' && !APP_VERSION_RE.test(value)) {
    invalid(property, `must have the form XX.YYYY (two digits, a dot, four digits) such as 16.0000, got '${value}'.`);
  }
}

function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

/** Find a zip entry by OPC part name, which compares case-insensitively. */
function findEntry(zip: DocxZip, partPath: string): string | null {
  if (zip.hasFile(partPath)) return partPath;
  const lower = partPath.toLowerCase();
  return zip.listFiles().find((name) => name.toLowerCase() === lower) ?? null;
}

type PropertiesRelationship = { target: string };

/** The first internal package relationship of one of `types`, resolved to a part path. */
function findPackageRelationship(relsDoc: Document | null, types: readonly string[]): PropertiesRelationship | null {
  if (!relsDoc) return null;
  const relationships = Array.from(relsDoc.getElementsByTagNameNS(OOXML.REL_NS, 'Relationship'));
  for (const type of types) {
    for (const relationship of relationships) {
      if (relationship.getAttribute('Type') !== type) continue;
      const target = relationship.getAttribute('Target');
      if (!target) continue;
      try {
        const normalized = normalizeOpcRelationshipTarget({
          ownerPart: '/',
          target,
          targetMode: relationship.getAttribute('TargetMode'),
        });
        return { target: normalized.target };
      } catch {
        // An external or unsafe target names no part in this package.
        continue;
      }
    }
  }
  return null;
}

async function readPackageRels(zip: DocxZip): Promise<Document | null> {
  const text = await zip.readTextOrNull(PACKAGE_RELS_PATH);
  return text === null ? null : parseXml(text, { partName: PACKAGE_RELS_PATH });
}

type LoadedPart = {
  /** Package path the relationship names (the zip entry when it exists). */
  path: string;
  doc: Document | null;
  related: boolean;
};

async function loadPropertiesPart(
  zip: DocxZip,
  relsDoc: Document | null,
  types: readonly string[],
  which: 'core' | 'app',
): Promise<LoadedPart | null> {
  const relationship = findPackageRelationship(relsDoc, types);
  if (!relationship) return null;
  const entry = findEntry(zip, relationship.target);
  if (entry === null) return { path: relationship.target, doc: null, related: true };
  let doc: Document;
  try {
    doc = parseXml(await zip.readText(entry), { partName: entry });
  } catch (error) {
    throw new DocumentPropertiesError(
      'INVALID_DOCUMENT_PROPERTIES_PART',
      `${entry} is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const root = doc.documentElement;
  const valid = which === 'core'
    ? root?.namespaceURI === CORE_PROPERTIES_NS && root.localName === 'coreProperties'
    : (root?.namespaceURI === EXTENDED_PROPERTIES_NS || root?.namespaceURI === EXTENDED_PROPERTIES_STRICT_NS) && root.localName === 'Properties';
  if (!valid) {
    throw new DocumentPropertiesError(
      'INVALID_DOCUMENT_PROPERTIES_PART',
      `${entry} does not have the ${which === 'core' ? 'cp:coreProperties' : 'Properties'} root element its relationship type calls for.`,
    );
  }
  return { path: entry, doc, related: true };
}

function coreElement(root: Element, name: CoreDocumentPropertyName): Element | undefined {
  const { ns, localName } = CORE_PROPERTY_ELEMENTS[name];
  return elementChildren(root).find((child) => child.namespaceURI === ns && child.localName === localName);
}

function appElement(root: Element, name: AppDocumentPropertyName): Element | undefined {
  const localName = APP_PROPERTY_ELEMENTS[name];
  return elementChildren(root).find((child) => child.namespaceURI === root.namespaceURI && child.localName === localName);
}

function project(core: Document | null | undefined, app: Document | null | undefined, corePart: string | null, appPart: string | null): DocumentProperties {
  const coreRoot = core?.documentElement ?? null;
  const appRoot = app?.documentElement ?? null;
  const coreValues = {} as Record<CoreDocumentPropertyName, string | null>;
  for (const name of CORE_DOCUMENT_PROPERTY_NAMES) {
    const element = coreRoot ? coreElement(coreRoot, name) : undefined;
    coreValues[name] = element ? element.textContent ?? '' : null;
  }
  const appValues = {} as Record<AppDocumentPropertyName, string | null>;
  for (const name of APP_DOCUMENT_PROPERTY_NAMES) {
    const element = appRoot ? appElement(appRoot, name) : undefined;
    appValues[name] = element ? element.textContent ?? '' : null;
  }
  return {
    core: coreValues,
    app: appValues,
    corePart: core ? corePart : null,
    appPart: app ? appPart : null,
  };
}

/** Read the package's core and extended document properties. Reading never changes the package. */
export async function readDocumentProperties(zip: DocxZip): Promise<DocumentProperties> {
  const relsDoc = await readPackageRels(zip);
  const core = await loadPropertiesPart(zip, relsDoc, CORE_PROPERTIES_REL_TYPES, 'core');
  const app = await loadPropertiesPart(zip, relsDoc, EXTENDED_PROPERTIES_REL_TYPES, 'app');
  return project(core?.doc, app?.doc, core?.path ?? null, app?.path ?? null);
}

/** The namespace declarations on an element, prefix to URI (the default namespace under ''). */
function declaredNamespaces(element: Element): Map<string, string> {
  const declared = new Map<string, string>();
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === 'xmlns') declared.set('', attribute.value);
    else if (attribute.name.startsWith('xmlns:')) declared.set(attribute.name.slice('xmlns:'.length), attribute.value);
  }
  return declared;
}

/**
 * The prefix to write `ns` elements with under `root`, declaring it on the root
 * when it is not declared there yet. Returns '' for the root's own default
 * namespace. `required` insists on that exact prefix (dcterms, which
 * `xsi:type="dcterms:W3CDTF"` names).
 */
function prefixFor(root: Element, ns: string, preferred: string, required = false): string {
  const declared = declaredNamespaces(root);
  if (required) {
    const bound = declared.get(preferred);
    if (bound === undefined) {
      root.setAttributeNS(XMLNS_NS, `xmlns:${preferred}`, ns);
      return preferred;
    }
    if (bound === ns) return preferred;
    throw new DocumentPropertiesError(
      'INVALID_DOCUMENT_PROPERTIES_PART',
      `The core properties part binds the prefix '${preferred}' to '${bound}', but ${preferred}:W3CDTF dates need it bound to '${ns}'.`,
    );
  }
  if (root.namespaceURI === ns) return root.prefix ?? '';
  for (const [prefix, uri] of declared) if (uri === ns) return prefix;
  let prefix = preferred;
  for (let suffix = 1; declared.has(prefix); suffix++) prefix = `${preferred}${suffix}`;
  root.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, ns);
  return prefix;
}

function setText(element: Element, value: string): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  element.appendChild(element.ownerDocument!.createTextNode(value));
}

/** Apply core writes to a parsed part; returns whether its content changed. */
function applyCore(doc: Document, writes: Partial<Record<WritableCoreDocumentPropertyName, string | null>>): boolean {
  const root = doc.documentElement!;
  let changed = false;
  for (const name of WRITABLE_CORE_DOCUMENT_PROPERTY_NAMES) {
    if (!(name in writes) || writes[name] === undefined) continue;
    const value = writes[name]!;
    const existing = coreElement(root, name);
    if (value === null) {
      if (!existing) continue;
      // Core property elements are non-repeatable; drop any stray repeats too.
      const { ns, localName } = CORE_PROPERTY_ELEMENTS[name];
      for (const child of elementChildren(root)) {
        if (child.namespaceURI === ns && child.localName === localName) root.removeChild(child);
      }
      changed = true;
      continue;
    }
    const isDate = name === 'created' || name === 'modified';
    if (existing && existing.textContent === value && elementChildren(existing).length === 0
      && (!isDate || hasW3cdtfType(existing))) {
      continue;
    }
    const { ns, prefix: preferred, localName } = CORE_PROPERTY_ELEMENTS[name];
    let element = existing;
    if (!element) {
      const prefix = prefixFor(root, ns, preferred, ns === DCTERMS_NS);
      element = doc.createElementNS(ns, prefix ? `${prefix}:${localName}` : localName);
      root.appendChild(element);
    }
    if (isDate) {
      prefixFor(root, DCTERMS_NS, 'dcterms', true);
      const xsiPrefix = prefixFor(root, XSI_NS, 'xsi');
      element.setAttributeNS(XSI_NS, `${xsiPrefix}:type`, 'dcterms:W3CDTF');
    }
    setText(element, value);
    changed = true;
  }
  return changed;
}

function hasW3cdtfType(element: Element): boolean {
  return element.getAttributeNS(XSI_NS, 'type') === 'dcterms:W3CDTF';
}

/** Apply app writes to a parsed part; returns whether its content changed. */
function applyApp(doc: Document, writes: Partial<Record<AppDocumentPropertyName, string | null>>): boolean {
  const root = doc.documentElement!;
  let changed = false;
  for (const name of APP_DOCUMENT_PROPERTY_NAMES) {
    if (!(name in writes) || writes[name] === undefined) continue;
    const value = writes[name]!;
    const existing = appElement(root, name);
    if (value === null) {
      if (!existing) continue;
      const localName = APP_PROPERTY_ELEMENTS[name];
      for (const child of elementChildren(root)) {
        if (child.namespaceURI === root.namespaceURI && child.localName === localName) root.removeChild(child);
      }
      changed = true;
      continue;
    }
    if (existing && existing.textContent === value && elementChildren(existing).length === 0) continue;
    let element = existing;
    if (!element) {
      const prefix = root.prefix;
      element = doc.createElementNS(root.namespaceURI, prefix ? `${prefix}:${APP_PROPERTY_ELEMENTS[name]}` : APP_PROPERTY_ELEMENTS[name]);
      root.appendChild(element);
    }
    setText(element, value);
    changed = true;
  }
  return changed;
}

function hasValue(writes: Record<string, string | null | undefined> | undefined): boolean {
  return Object.values(writes ?? {}).some((value) => typeof value === 'string');
}

const NEW_CORE_PART =
  `${XML_DECL}\n<cp:coreProperties xmlns:cp="${CORE_PROPERTIES_NS}" xmlns:dc="${DC_NS}"` +
  ` xmlns:dcterms="${DCTERMS_NS}" xmlns:dcmitype="${DCMITYPE_NS}" xmlns:xsi="${XSI_NS}"/>`;
const NEW_APP_PART =
  `${XML_DECL}\n<Properties xmlns="${EXTENDED_PROPERTIES_NS}" xmlns:vt="${DOCPROPS_VTYPES_NS}"/>`;

/** A path for a new part: `preferred`, or the first `stemN.xml` no entry already uses. */
function freePartPath(zip: DocxZip, preferred: string): string {
  if (findEntry(zip, preferred) === null) return preferred;
  const stem = preferred.replace(/\.xml$/u, '');
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n}.xml`;
    if (findEntry(zip, candidate) === null) return candidate;
  }
}

/** Add a package relationship of `type` to `target`, with an Id no relationship in the part uses. */
function addPackageRelationship(relsDoc: Document, type: string, target: string): void {
  const root = relsDoc.documentElement!;
  const ids = new Set(Array.from(relsDoc.getElementsByTagNameNS(OOXML.REL_NS, 'Relationship')).map((rel) => rel.getAttribute('Id')));
  let n = 1;
  while (ids.has(`rId${n}`)) n++;
  const prefix = root.prefix;
  const relationship = relsDoc.createElementNS(OOXML.REL_NS, prefix ? `${prefix}:Relationship` : 'Relationship');
  relationship.setAttribute('Id', `rId${n}`);
  relationship.setAttribute('Type', type);
  relationship.setAttribute('Target', target);
  root.appendChild(relationship);
}

/** Give `partPath` a content-type override of `contentType`, replacing a different one. */
function ensureOverride(ctDoc: Document, partPath: string, contentType: string): void {
  const root = ctDoc.documentElement!;
  const partName = `/${partPath}`;
  const existing = Array.from(ctDoc.getElementsByTagNameNS(OOXML.CT_NS, 'Override'))
    .find((override) => (override.getAttribute('PartName') ?? '').toLowerCase() === partName.toLowerCase());
  if (existing) {
    existing.setAttribute('ContentType', contentType);
    return;
  }
  const prefix = root.prefix;
  const override = ctDoc.createElementNS(OOXML.CT_NS, prefix ? `${prefix}:Override` : 'Override');
  override.setAttribute('PartName', partName);
  override.setAttribute('ContentType', contentType);
  root.appendChild(override);
}

function validateMutation(mutation: DocumentPropertiesMutation): void {
  if (mutation === null || typeof mutation !== 'object' || Array.isArray(mutation)) {
    throw new DocumentPropertiesError('EMPTY_DOCUMENT_PROPERTIES_MUTATION', 'The write must be an object with core and/or app properties.');
  }
  let count = 0;
  for (const part of ['core', 'app'] as const) {
    const writes = mutation[part];
    if (writes === undefined) continue;
    if (writes === null || typeof writes !== 'object' || Array.isArray(writes)) {
      invalid(part, 'must be an object of property values.');
    }
    for (const [name, value] of Object.entries(writes)) {
      if (value === undefined) continue;
      validateDocumentPropertyValue(part, name, value);
      count++;
    }
  }
  if (count === 0) {
    throw new DocumentPropertiesError('EMPTY_DOCUMENT_PROPERTIES_MUTATION', 'The write names no property; pass at least one core or app value.');
  }
}

function serializePart(doc: Document): string {
  const text = serializeXml(doc);
  return text.startsWith('<?xml') ? text : `${XML_DECL}\n${text}`;
}

/**
 * Set or remove document properties. Every value is validated before anything
 * is written; a write whose values already hold changes nothing. Only the
 * named property elements change: other elements, attributes, namespace
 * declarations and extensions in the parts are kept. A missing part is
 * created, with a package relationship and content-type override, only when
 * the write sets a value in it.
 *
 * @conformance ECMA-376 edition 5, Part 2 § 8.2
 * @conformance ECMA-376 edition 5, Part 2 § 8.3.4.3
 * @conformance ECMA-376 edition 5, Part 1 § 22.2
 */
export async function setDocumentProperties(
  zip: DocxZip,
  mutation: DocumentPropertiesMutation,
): Promise<DocumentPropertiesMutationResult> {
  validateMutation(mutation);
  const relsText = await zip.readTextOrNull(PACKAGE_RELS_PATH);
  const relsDoc = relsText === null ? null : parseXml(relsText, { partName: PACKAGE_RELS_PATH });
  const core = await loadPropertiesPart(zip, relsDoc, CORE_PROPERTIES_REL_TYPES, 'core');
  const app = await loadPropertiesPart(zip, relsDoc, EXTENDED_PROPERTIES_REL_TYPES, 'app');
  const previous = project(core?.doc, app?.doc, core?.path ?? null, app?.path ?? null);

  const partsCreated: string[] = [];
  const partsChanged: string[] = [];
  let packageRels = relsDoc;
  let relsChanged = false;
  let ctDoc: Document | null = null;
  const pendingWrites: Array<[string, string]> = [];

  const prepare = async (
    loaded: LoadedPart | null,
    writes: Record<string, string | null | undefined> | undefined,
    which: 'core' | 'app',
  ): Promise<{ doc: Document | null; path: string | null }> => {
    if (!writes || Object.values(writes).every((value) => value === undefined)) {
      return { doc: loaded?.doc ?? null, path: loaded?.path ?? null };
    }
    let doc = loaded?.doc ?? null;
    let path = loaded?.path ?? null;
    let created = false;
    if (!doc) {
      // Removing a property from a part that does not exist changes nothing.
      if (!hasValue(writes)) return { doc: null, path };
      doc = parseXml(which === 'core' ? NEW_CORE_PART : NEW_APP_PART);
      created = true;
      if (!loaded) {
        path = freePartPath(zip, which === 'core' ? 'docProps/core.xml' : 'docProps/app.xml');
        packageRels ??= parseXml(`${XML_DECL}\n<Relationships xmlns="${OOXML.REL_NS}"/>`);
        addPackageRelationship(packageRels, which === 'core' ? CORE_PROPERTIES_REL_TYPES[0] : EXTENDED_PROPERTIES_REL_TYPES[0], path);
        relsChanged = true;
      }
      if (!ctDoc) {
        const ctText = await zip.readTextOrNull(CONTENT_TYPES_PATH);
        ctDoc = parseXml(ctText ?? `${XML_DECL}\n<Types xmlns="${OOXML.CT_NS}"/>`, { partName: CONTENT_TYPES_PATH });
      }
      ensureOverride(ctDoc, path!, which === 'core' ? CORE_PROPERTIES_CONTENT_TYPE : EXTENDED_PROPERTIES_CONTENT_TYPE);
    }
    const changed = which === 'core'
      ? applyCore(doc, writes as Partial<Record<WritableCoreDocumentPropertyName, string | null>>)
      : applyApp(doc, writes as Partial<Record<AppDocumentPropertyName, string | null>>);
    if (changed || created) {
      pendingWrites.push([path!, serializePart(doc)]);
      partsChanged.push(path!);
      if (created) partsCreated.push(path!);
    }
    return { doc, path };
  };

  const coreResult = await prepare(core, mutation.core, 'core');
  const appResult = await prepare(app, mutation.app, 'app');
  if (pendingWrites.length === 0) {
    return { changed: false, previous, current: previous, partsCreated: [], partsChanged: [] };
  }
  if (ctDoc) {
    pendingWrites.push([CONTENT_TYPES_PATH, serializePart(ctDoc)]);
    partsChanged.push(CONTENT_TYPES_PATH);
  }
  if (relsChanged && packageRels) {
    pendingWrites.push([PACKAGE_RELS_PATH, serializePart(packageRels)]);
    partsChanged.push(PACKAGE_RELS_PATH);
  }
  // Every value validated and every part built before the first write.
  for (const [path, text] of pendingWrites) zip.writeText(path, text);
  const current = project(coreResult.doc, appResult.doc, coreResult.path, appResult.path);
  return { changed: true, previous, current, partsCreated, partsChanged };
}
