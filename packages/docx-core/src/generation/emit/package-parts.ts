/**
 * OPC package plumbing: [Content_Types].xml, package/part relationships, and
 * document properties. Built with the same skeleton-parse + namespace-aware
 * DOM approach as the WML parts — no string concatenation of dynamic values.
 *
 * docProps/core.xml dates come exclusively from the spec (meta.createdIso);
 * generation never reads the clock, keeping output byte-deterministic.
 */

import { OOXML } from '../../primitives/namespaces.js';
import { parseXml, serializeXml, XML_DECL } from '../../primitives/xml.js';
import type { CompileContext } from '../context.js';
import type { DocumentSpec } from '../types.js';

export const CONTENT_TYPES = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  coreProps: 'application/vnd.openxmlformats-package.core-properties+xml',
  extendedProps: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  relationships: 'application/vnd.openxmlformats-package.relationships+xml',
} as const;

export const REL_TYPES = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
} as const;

const CORE_PROPS_NS = {
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
} as const;

const EXTENDED_PROPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

/** Emit every package-plumbing part into the context's file map. */
export function emitPackageParts(spec: DocumentSpec, ctx: CompileContext): void {
  ctx.setFileContent('docProps/core.xml', emitCoreProps(spec));
  ctx.setFileContent('docProps/app.xml', emitAppProps());
  ctx.setFileContent('_rels/.rels', emitPackageRels());
  ctx.setFileContent('word/_rels/document.xml.rels', emitDocumentRels(ctx));
  ctx.setFileContent('[Content_Types].xml', emitContentTypes(ctx));
}

function emitContentTypes(ctx: CompileContext): string {
  const doc = parseXml(`<Types xmlns="${OOXML.CT_NS}"/>`);
  const root = doc.documentElement!;

  const addDefault = (extension: string, contentType: string) => {
    const el = doc.createElementNS(OOXML.CT_NS, 'Default');
    el.setAttribute('Extension', extension);
    el.setAttribute('ContentType', contentType);
    root.appendChild(el);
  };
  const addOverride = (partName: string, contentType: string) => {
    const el = doc.createElementNS(OOXML.CT_NS, 'Override');
    el.setAttribute('PartName', partName);
    el.setAttribute('ContentType', contentType);
    root.appendChild(el);
  };

  addDefault('rels', CONTENT_TYPES.relationships);
  addDefault('xml', 'application/xml');
  addOverride('/word/document.xml', CONTENT_TYPES.document);
  addOverride('/docProps/core.xml', CONTENT_TYPES.coreProps);
  addOverride('/docProps/app.xml', CONTENT_TYPES.extendedProps);
  for (const part of ctx.registeredParts()) {
    addOverride(`/${part.name}`, part.contentType);
  }

  return XML_DECL + serializeXml(doc);
}

function emitPackageRels(): string {
  const doc = parseXml(`<Relationships xmlns="${OOXML.REL_NS}"/>`);
  const root = doc.documentElement!;
  const add = (id: string, type: string, target: string) => {
    const el = doc.createElementNS(OOXML.REL_NS, 'Relationship');
    el.setAttribute('Id', id);
    el.setAttribute('Type', type);
    el.setAttribute('Target', target);
    root.appendChild(el);
  };
  add('rId1', REL_TYPES.officeDocument, 'word/document.xml');
  add('rId2', REL_TYPES.coreProps, 'docProps/core.xml');
  add('rId3', REL_TYPES.extendedProps, 'docProps/app.xml');
  return XML_DECL + serializeXml(doc);
}

function emitDocumentRels(ctx: CompileContext): string {
  const doc = parseXml(`<Relationships xmlns="${OOXML.REL_NS}"/>`);
  const root = doc.documentElement!;
  for (const part of ctx.documentRelParts()) {
    const el = doc.createElementNS(OOXML.REL_NS, 'Relationship');
    el.setAttribute('Id', part.documentRel!.rId);
    el.setAttribute('Type', part.documentRel!.type);
    // Targets are resolved relative to word/, the directory owning document.xml.
    el.setAttribute('Target', part.name.replace(/^word\//, ''));
    root.appendChild(el);
  }
  return XML_DECL + serializeXml(doc);
}

function emitCoreProps(spec: DocumentSpec): string {
  const doc = parseXml(
    `<cp:coreProperties xmlns:cp="${CORE_PROPS_NS.cp}" xmlns:dc="${CORE_PROPS_NS.dc}"` +
      ` xmlns:dcterms="${CORE_PROPS_NS.dcterms}" xmlns:xsi="${CORE_PROPS_NS.xsi}"/>`,
  );
  const root = doc.documentElement!;
  const meta = spec.meta;

  const addText = (ns: string, qname: string, text: string, attrs?: Record<string, string>) => {
    const el = doc.createElementNS(ns, qname);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.appendChild(doc.createTextNode(text));
    root.appendChild(el);
  };

  if (meta?.title) addText(CORE_PROPS_NS.dc, 'dc:title', meta.title);
  if (meta?.author) addText(CORE_PROPS_NS.dc, 'dc:creator', meta.author);
  if (meta?.createdIso) {
    addText(CORE_PROPS_NS.dcterms, 'dcterms:created', meta.createdIso, { 'xsi:type': 'dcterms:W3CDTF' });
    addText(CORE_PROPS_NS.dcterms, 'dcterms:modified', meta.createdIso, { 'xsi:type': 'dcterms:W3CDTF' });
  }

  return XML_DECL + serializeXml(doc);
}

function emitAppProps(): string {
  const doc = parseXml(`<Properties xmlns="${EXTENDED_PROPS_NS}"/>`);
  const root = doc.documentElement!;
  const app = doc.createElementNS(EXTENDED_PROPS_NS, 'Application');
  app.appendChild(doc.createTextNode('safe-docx'));
  root.appendChild(app);
  return XML_DECL + serializeXml(doc);
}
