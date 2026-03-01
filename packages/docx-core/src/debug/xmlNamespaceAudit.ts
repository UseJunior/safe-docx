import { parseXml, serializeXml } from '../primitives/xml.js';
import { childElements } from '../primitives/dom-helpers.js';

export interface NamespaceAuditIssue {
  type:
    | 'xml_parse_error'
    | 'undeclared_element_prefix'
    | 'undeclared_attribute_prefix'
    | 'element_namespace_mismatch'
    | 'attribute_namespace_mismatch';
  path: string;
  nodeName: string;
  prefix?: string;
  expectedNamespaceUri?: string;
  actualNamespaceUri?: string;
  snippet?: string;
  message: string;
}

export interface NamespaceAuditSummary {
  ok: boolean;
  issueCount: number;
  declaredPrefixCount: number;
  usedPrefixCount: number;
  issues: NamespaceAuditIssue[];
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

function prefixedNamePrefix(name: string): string | undefined {
  const idx = name.indexOf(':');
  if (idx <= 0) return undefined;
  return name.slice(0, idx);
}

function elementSiblingIndex(node: Element): number {
  const parent = node.parentNode;
  if (!parent) return 1;

  let index = 0;
  for (const sibling of childElements(parent as Element)) {
    if (sibling.tagName === node.tagName) {
      index++;
    }
    if (sibling === node) {
      return index;
    }
  }

  return index || 1;
}

function buildNodePath(node: Element): string {
  const segments: string[] = [];
  let current: Element | null = node;

  while (current) {
    segments.push(`${current.tagName}[${elementSiblingIndex(current)}]`);
    const parentNode: Node | null = current.parentNode;
    if (!parentNode || parentNode.nodeType !== 1) {
      break;
    }
    current = parentNode as Element;
  }

  return segments.reverse().join('/');
}

function shortSnippet(node: Element): string {
  const full = serializeXml(node.ownerDocument ?? (node as unknown as Document));
  return full.slice(0, 220);
}

function collectNamespaceDeclarations(node: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes.item(i);
    if (!attr) continue;

    if (attr.name === 'xmlns') {
      map.set('', attr.value);
      continue;
    }

    if (attr.name.startsWith('xmlns:')) {
      map.set(attr.name.slice('xmlns:'.length), attr.value);
    }
  }
  return map;
}

interface TraverseContext {
  inScopeNamespaces: Map<string, string>;
  issues: NamespaceAuditIssue[];
  declaredPrefixes: Set<string>;
  usedPrefixes: Set<string>;
}

function addIssue(ctx: TraverseContext, issue: NamespaceAuditIssue): void {
  ctx.issues.push(issue);
}

function validateElementNamespace(node: Element, ctx: TraverseContext, inScope: Map<string, string>): void {
  const prefix = node.prefix ?? prefixedNamePrefix(node.tagName);
  if (!prefix) {
    return;
  }

  ctx.usedPrefixes.add(prefix);
  const bound = inScope.get(prefix);
  if (!bound) {
    addIssue(ctx, {
      type: 'undeclared_element_prefix',
      path: buildNodePath(node),
      nodeName: node.tagName,
      prefix,
      actualNamespaceUri: node.namespaceURI ?? undefined,
      snippet: shortSnippet(node),
      message: `Element prefix '${prefix}' is not declared in scope`,
    });
    return;
  }

  if (node.namespaceURI && node.namespaceURI !== bound) {
    addIssue(ctx, {
      type: 'element_namespace_mismatch',
      path: buildNodePath(node),
      nodeName: node.tagName,
      prefix,
      expectedNamespaceUri: bound,
      actualNamespaceUri: node.namespaceURI,
      snippet: shortSnippet(node),
      message: `Element prefix '${prefix}' is bound to '${bound}' but node.namespaceURI is '${node.namespaceURI}'`,
    });
  }
}

function validateAttributeNamespaces(node: Element, ctx: TraverseContext, inScope: Map<string, string>): void {
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes.item(i);
    if (!attr) continue;

    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
      continue;
    }

    const prefix = attr.prefix ?? prefixedNamePrefix(attr.name);
    if (!prefix || prefix === 'xml' || prefix === 'xmlns') {
      continue;
    }

    ctx.usedPrefixes.add(prefix);
    const bound = inScope.get(prefix);
    if (!bound) {
      addIssue(ctx, {
        type: 'undeclared_attribute_prefix',
        path: buildNodePath(node),
        nodeName: attr.name,
        prefix,
        actualNamespaceUri: attr.namespaceURI ?? undefined,
        snippet: shortSnippet(node),
        message: `Attribute prefix '${prefix}' is not declared in scope`,
      });
      continue;
    }

    if (attr.namespaceURI && attr.namespaceURI !== bound) {
      addIssue(ctx, {
        type: 'attribute_namespace_mismatch',
        path: buildNodePath(node),
        nodeName: attr.name,
        prefix,
        expectedNamespaceUri: bound,
        actualNamespaceUri: attr.namespaceURI,
        snippet: shortSnippet(node),
        message: `Attribute prefix '${prefix}' is bound to '${bound}' but attr.namespaceURI is '${attr.namespaceURI}'`,
      });
    }
  }
}

function traverse(node: Element, ctx: TraverseContext): void {
  const inScope = new Map(ctx.inScopeNamespaces);
  const localDeclarations = collectNamespaceDeclarations(node);
  for (const [prefix, ns] of localDeclarations.entries()) {
    inScope.set(prefix, ns);
    ctx.declaredPrefixes.add(prefix || '(default)');
  }

  validateElementNamespace(node, ctx, inScope);
  validateAttributeNamespaces(node, ctx, inScope);

  for (const child of childElements(node)) {
    traverse(child, {
      ...ctx,
      inScopeNamespaces: inScope,
    });
  }
}

export function auditXmlNamespaces(xml: string): NamespaceAuditSummary {
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issueCount: 1,
      declaredPrefixCount: 0,
      usedPrefixCount: 0,
      issues: [
        {
          type: 'xml_parse_error',
          path: '',
          nodeName: '',
          message,
        },
      ],
    };
  }

  const root = doc.documentElement;
  if (!root) {
    return {
      ok: false,
      issueCount: 1,
      declaredPrefixCount: 0,
      usedPrefixCount: 0,
      issues: [
        {
          type: 'xml_parse_error',
          path: '',
          nodeName: '',
          message: 'XML document has no documentElement',
        },
      ],
    };
  }

  const ctx: TraverseContext = {
    inScopeNamespaces: new Map<string, string>([
      ['xml', XML_NS],
      ['xmlns', XMLNS_NS],
    ]),
    issues: [],
    declaredPrefixes: new Set<string>(['xml', 'xmlns']),
    usedPrefixes: new Set<string>(),
  };

  traverse(root, ctx);

  return {
    ok: ctx.issues.length === 0,
    issueCount: ctx.issues.length,
    declaredPrefixCount: ctx.declaredPrefixes.size,
    usedPrefixCount: ctx.usedPrefixes.size,
    issues: ctx.issues,
  };
}
