import { parseXml, serializeXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { auditSectPr, type SectPrBinding } from './sectPrAudit.js';
import { hash } from '../runtime/hash.js';
import { posix } from '../runtime/posix.js';
import { normalizeOpcRelationshipTarget } from './opc-target.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export type RevisionFidelityParts = Readonly<Record<string, string>>;
export type RevisionFidelitySide = 'accept' | 'reject';
export interface RevisionFidelityFailure {
  side: RevisionFidelitySide;
  part: string;
  location: string;
  expected: unknown;
  actual: unknown;
}
export class RevisionFidelityViolation extends Error {
  readonly code = 'REVISION_FIDELITY_VIOLATION';
  constructor(readonly failures: RevisionFidelityFailure[]) {
    super(`Revision fidelity failed: ${failures.map(f => `${f.side} ${f.part} ${f.location}`).join('; ')}`);
    this.name = 'RevisionFidelityViolation';
  }
}
type StoryBinding = Pick<SectPrBinding, 'sectionOrdinal' | 'kind' | 'role' | 'targetPath'>;

export interface RevisionFidelityOptions {
  enabled?: boolean;
  /** Compare uses its established projection engine; editing uses the core DOM engine. */
  project?: (xml: string, side: RevisionFidelitySide) => string;
  /** Optional comparison-specific handling of volatile field caches. */
  normalizeXml?: (xml: string, side: RevisionFidelitySide) => string;
  /** Compare already checks effective formatting independently. Default true. */
  checkFormatting?: boolean;
  normalizeText?: (text: string) => string;
  /** Fixed existing stories for edits whose separately reported package lifecycle is untracked. */
  storyPaths?: readonly string[];
  /** Comparison can resolve the effective slot through section inheritance. */
  resolveStoryBindings?: (projectedMain: string, parts: RevisionFidelityParts) => readonly StoryBinding[];
}

class ProjectionError extends Error {
  constructor(readonly part: string, readonly kind: string) { super(`Cannot project ${part}`); }
}

function elements(node: Node): Element[] {
  return Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
}
function children(node: Node): Element[] {
  return elements(node).flatMap(el => {
    if (el.namespaceURI !== MC || el.localName !== 'AlternateContent') return [el];
    const branches = elements(el);
    const choice = branches.find(branch => branch.localName === 'Choice' &&
      (branch.getAttribute('Requires') ?? '').split(/\s+/u).filter(Boolean).every(prefix => !!branch.lookupNamespaceURI(prefix)))
      ?? branches.find(branch => branch.localName === 'Fallback');
    return choice ? children(choice) : [];
  });
}
function descendants(node: Node): Element[] {
  return children(node).flatMap(child => [child, ...descendants(child)]);
}
function property(el: Element | undefined): unknown {
  if (!el) return null;
  const attrs = Array.from(el.attributes)
    .filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !a.localName.startsWith('rsid'))
    .map(a => [`${a.namespaceURI ?? ''}:${a.localName}`, a.value]).sort((a, b) => a[0]!.localeCompare(b[0]!));
  const nested = elements(el).filter(c => !c.localName.endsWith('PrChange') && !['headerReference','footerReference'].includes(c.localName)).map(property);
  return attrs.length || nested.length || !el.localName.endsWith('Pr') ? [el.localName, attrs, nested] : null;
}

function noteId(value: string | null): string | undefined {
  const lexical = value?.trim();
  return lexical && /^[+-]?\d+$/u.test(lexical) ? BigInt(lexical).toString() : undefined;
}

function snapshot(parts: RevisionFidelityParts, side: RevisionFidelitySide, options: RevisionFidelityOptions): Record<string, unknown> {
  const projected = new Map<string, Document>();
  const read = (part: string): Document | undefined => {
    if (!parts[part]) return undefined;
    let doc = projected.get(part);
    if (!doc) {
      try {
        if (options.project) {
          let xml = options.project(parts[part]!, side);
          if (options.normalizeXml) xml = options.normalizeXml(xml, side);
          doc = parseXml(xml);
        } else {
          doc = parseXml(parts[part]!);
          if (side === 'accept') acceptChanges(doc); else rejectChanges(doc);
          if (options.normalizeXml) doc = parseXml(options.normalizeXml(serializeXml(doc), side));
        }
        projected.set(part, doc);
      } catch (error) { throw new ProjectionError(part, error instanceof Error ? error.name : 'projection failed'); }
    }
    return doc;
  };
  const format = options.checkFormatting !== false;
  const cleanText = options.normalizeText ?? ((value: string) => value);
  const emptyStory = (value: unknown[]): unknown[] => {
    const p = value[0];
    return value.length === 1 && Array.isArray(p) && p[0] === 'p' && Array.isArray(p[1]) && p[1].length === 0 &&
      p[2] == null && (p.length < 4 || (Array.isArray(p[3]) && p[3].length === 0)) ? [] : value;
  };
  const noteStack = new Set<string>();
  const noteCache = new Map<string, string>();
  const usedNoteKinds = new Set<string>();
  const assetCache = new Map<string, string>();
  const activeAssets = new Set<string>();
  type Relationship = { target: string; external: boolean; type: string };
  const relationshipCache = new Map<string, Map<string, Relationship>>();
  const relationships = (owner: string): Map<string, Relationship> => {
    const cached = relationshipCache.get(owner);
    if (cached) return cached;
    const path = posix.join(posix.dirname(owner), '_rels', posix.basename(owner) + '.rels');
    const xml = parts[path];
    const result = !xml ? new Map<string, Relationship>() : new Map(Array.from(parseXml(xml).getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships','Relationship'))
      .map(el => [el.getAttribute('Id')!, { target: el.getAttribute('Target') ?? '', external: el.getAttribute('TargetMode') === 'External', type: el.getAttribute('Type') ?? '' }]));
    relationshipCache.set(owner, result);
    return result;
  };
  let assetVisits = 0;
  const asset = (path: string): unknown => {
    if (activeAssets.has(path)) throw new ProjectionError(path, 'cyclic asset relationships');
    if (parts['@binary:' + path]) return ['binary', parts['@binary:' + path]];
    if (!parts[path]) return ['missing-asset'];
    const cached = assetCache.get(path);
    if (cached !== undefined) return cached;
    if (activeAssets.size >= 128 || ++assetVisits > 10000) throw new ProjectionError(path, 'asset graph exceeds validation budget');
    activeAssets.add(path);
    const rels = relationships(path);
    const identity = (rel: Relationship): unknown => [rel.type, rel.external ? rel.target
      : asset(normalizeOpcRelationshipTarget({ownerPart:path,target:rel.target}).target)];
    const canonical = (node: Node): unknown => {
      if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue;
      if (node.nodeType !== 1) return null;
      const el = node as Element;
      const attrs = Array.from(el.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => {
        const reference = a.namespaceURI === R ||
          (a.namespaceURI === 'urn:schemas-microsoft-com:office:office' && a.localName === 'relid');
        const value = reference ? (rels.has(a.value) ? identity(rels.get(a.value)!) : ['missing-relationship']) : a.value;
        return [`${a.namespaceURI ?? ''}:${a.localName}`, value];
      }).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
      const hasElements = elements(el).length > 0;
      const content = Array.from(el.childNodes).filter(n => !(hasElements && n.nodeType === 3 && !n.nodeValue?.trim())).map(canonical);
      return [el.namespaceURI,el.localName,attrs,content];
    };
    const value = hash(JSON.stringify([
      canonical(parseXml(parts[path]!).documentElement),
      [...rels.values()].map(identity).map(v => JSON.stringify(v)).sort(),
    ]));
    activeAssets.delete(path);
    assetCache.set(path, value);
    return value;
  };
  const assetsOf = (root: Element, owner: string): unknown[] => {
    const rels = relationships(owner);
    const nodes = [root, ...descendants(root)];
    const values = nodes.flatMap(el => Array.from(el.attributes)
      .filter(a => a.namespaceURI === R ||
        (a.namespaceURI === 'urn:schemas-microsoft-com:office:office' && a.localName === 'relid'))
      .map(a => {
        const rel = rels.get(a.value);
        return !rel ? ['missing-relationship'] : [rel.type, rel.external ? rel.target : asset(normalizeOpcRelationshipTarget({ownerPart:owner,target:rel.target}).target)];
      }));
    return [...new Set(values.map(v => JSON.stringify(v)))].sort();
  };
  const blocks = (root: Node, owner = 'word/document.xml'): unknown[] => children(root).flatMap(el => {
    if (el.namespaceURI !== W) return blocks(el, owner);
    if (el.localName === 'p') {
      const tokens: unknown[] = [];
      const spans: Array<{ text: string; format: string }> = [];
      const inline = (node: Node, runFormat = 'null'): void => {
        for (const child of children(node)) {
          if (child.namespaceURI === W && ['pPr', 'rPr'].includes(child.localName)) continue;
          if (child.namespaceURI === W && child.localName === 'r') {
            inline(child, format ? JSON.stringify(property(elements(child).find(e => e.namespaceURI === W && e.localName === 'rPr'))) : 'null');
          } else if (child.namespaceURI === W && ['t', 'tab', 'br', 'cr', 'noBreakHyphen', 'softHyphen', 'sym'].includes(child.localName)) {
            const text = child.localName === 't' ? child.textContent ?? '' : child.localName === 'tab' ? '\t'
              : ['br','cr'].includes(child.localName) ? '\n' : child.localName === 'noBreakHyphen' ? '‑'
                : child.localName === 'softHyphen' ? '\u00ad' : `[sym:${child.getAttributeNS(W,'font')}:${child.getAttributeNS(W,'char')}]`;
            if (text.length) tokens.push(child.localName === 't' || child.localName === 'sym' ? text : ['layout', child.localName, child.getAttributeNS(W, 'type')]);
            const last = spans.at(-1);
            if (format && text.length) { if (last?.format === runFormat) last.text += text; else spans.push({ text, format: runFormat }); }
          } else if (child.namespaceURI === W && child.localName === 'instrText') {
            const instruction = child.textContent ?? '';
            const previous = tokens.at(-1);
            if (Array.isArray(previous) && previous[0] === 'instruction') previous[1] += instruction;
            else tokens.push(['instruction', instruction]);
          } else if (child.namespaceURI === W && child.localName === 'fldChar') {
            tokens.push(['field-boundary', child.getAttributeNS(W, 'fldCharType')]);
          } else if (child.namespaceURI === W && ['hyperlink', 'fldSimple', 'sdt'].includes(child.localName)) {
            const kind = child.localName;
            const metadata = kind === 'hyperlink'
              ? [child.getAttributeNS(W, 'anchor'), child.getAttributeNS(W, 'docLocation'), assetsOf(child.cloneNode(false) as Element, owner)]
              : kind === 'fldSimple' ? child.getAttributeNS(W, 'instr')
                : property(elements(child).find(e => e.namespaceURI === W && e.localName === 'sdtPr'));
            tokens.push([kind, metadata]);
            const content = kind === 'sdt'
              ? elements(child).find(e => e.namespaceURI === W && e.localName === 'sdtContent')
              : child;
            if (content) inline(content, runFormat);
            tokens.push(['end', kind]);
          } else if (child.namespaceURI === M && ['oMath', 'oMathPara'].includes(child.localName)) {
            const math = (node: Element): unknown => [
              property(node.cloneNode(false) as Element),
              elements(node).length ? elements(node).map(math) : node.textContent,
            ];
            tokens.push(['math', math(child)]);
          } else if (child.namespaceURI === W && ['footnoteReference','endnoteReference'].includes(child.localName)) {
            const kind = child.localName === 'footnoteReference' ? 'footnote' : 'endnote';
            usedNoteKinds.add(kind);
            const id = noteId(child.getAttributeNS(W,'id'));
            const key = `${kind}:${id}`;
            const note = read(`word/${kind}s.xml`);
            const definition = note && Array.from(note.getElementsByTagNameNS(W, kind)).find(n => id !== undefined && noteId(n.getAttributeNS(W,'id')) === id);
            if (!definition || noteStack.has(key)) tokens.push([kind, 'missing-or-cyclic']);
            else {
              if (!noteCache.has(key)) { noteStack.add(key); noteCache.set(key, hash(JSON.stringify(blocks(definition, `word/${kind}s.xml`)))); noteStack.delete(key); }
              tokens.push([kind, noteCache.get(key)]);
            }
          } else if (child.namespaceURI === W && ['drawing','pict','object'].includes(child.localName)) {
            const boxes = descendants(child).filter(node => node.namespaceURI === W && node.localName === 'txbxContent').map(box => blocks(box, owner));
            tokens.push([child.localName, assetsOf(child, owner), boxes]);
          } else inline(child, runFormat);
        }
      };
      inline(el);
      // Adjacent text runs can split/coalesce without changing the document.
      const merged: unknown[] = [];
      for (const token of tokens) {
        if (typeof token === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += token;
        else merged.push(token);
      }
      return [[ 'p', merged.map(t => typeof t === 'string' ? cleanText(t) : t),
        ...(format ? [property(elements(el).find(e => e.namespaceURI === W && e.localName === 'pPr')), spans.map(s => [cleanText(s.text), s.format])] : []) ]];
    }
    if (['altChunk','subDoc'].includes(el.localName)) return [[el.localName, assetsOf(el,owner)]];
    if (['sdt','customXml'].includes(el.localName)) {
      const metadata = elements(el).find(child => child.localName === (el.localName === 'sdt' ? 'sdtPr' : 'customXmlPr'));
      return [[el.localName, property(el.cloneNode(false) as Element), property(metadata), blocks(el, owner)]];
    }
    if (['tbl','tr','tc'].includes(el.localName)) {
      const cellProps = elements(el).find(c => c.namespaceURI === W && c.localName === 'tcPr');
      const cellProperty = (name: string): Element | undefined => cellProps && elements(cellProps).find(c => c.localName === name && c.namespaceURI === W);
      const mergeValue = (name: string): string => { const el = cellProperty(name); return el ? el.getAttributeNS(W,'val') || 'continue' : 'none'; };
      const occupancy = el.localName === 'tc' ? [cellProperty('gridSpan')?.getAttributeNS(W,'val') || '1', mergeValue('vMerge'), mergeValue('hMerge')] : [];
      const properties = format
        ? elements(el).filter(child => child.namespaceURI === W &&
          ['tblPr', 'tblPrEx', 'tblGrid', 'trPr', 'tcPr'].includes(child.localName)).map(property)
        : [];
      return [[el.localName, occupancy, properties, blocks(el, owner)]];
    }
    // Properties, markers and note separators carry no independent story block.
    if (el.localName.endsWith('Pr') || el.localName === 'tblGrid') return [];
    return blocks(el, owner);
  });
  const main = read('word/document.xml');
  if (!main) return { 'word/document.xml': ['missing-document'] };
  const body = main.getElementsByTagNameNS(W,'body').item(0) ?? main.documentElement;
  const result: Record<string, unknown> = { 'word/document.xml': emptyStory(blocks(body)) };
  const finish = (): Record<string, unknown> => {
    for (const kind of usedNoteKinds) {
      const path = `word/${kind}s.xml`, notes = read(path);
      if (!notes) continue;
      for (const note of Array.from(notes.getElementsByTagNameNS(W,kind))) {
        const type = note.getAttributeNS(W,'type');
        if (['separator','continuationSeparator','continuationNotice'].includes(type ?? '')) result[`${path}#${type}`] = blocks(note,path);
      }
    }
    return result;
  };
  if (format) result['word/document.xml#section-properties'] = Array.from(main.getElementsByTagNameNS(W,'sectPr')).map(property);
  if (options.storyPaths) {
    for (const path of options.storyPaths) { const story = read(path); result[path] = story ? emptyStory(blocks(story.documentElement,path)) : ['missing-story']; }
    return finish();
  }
  const mainXml = serializeXml(main);
  const bindings = options.resolveStoryBindings?.(mainXml, parts)
    ?? auditSectPr(mainXml, parts['word/_rels/document.xml.rels']).bindings;
  const stories = new Map<string, unknown[]>();
  for (const binding of bindings) {
    const path = binding.targetPath;
    let content = stories.get(path);
    if (!content) {
      const story = read(path);
      content = story ? emptyStory(blocks(story.documentElement, path)) : ['missing-story'];
      stories.set(path, content);
    }
    // Comparison may express deletion by leaving a bound, empty story.
    if (content.length === 0 && options.resolveStoryBindings) continue;
    result[`section[${binding.sectionOrdinal}]/${binding.kind}/${binding.role}`] = content;
  }
  return finish();
}
function firstDifference(expected: unknown, actual: unknown, path = '$'): { location: string; expected: unknown; actual: unknown } | undefined {
  if (expected === actual) return undefined;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for (let i=0; i<Math.max(expected.length,actual.length); i++) {
      const mismatch = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  const bounded = (value: unknown): unknown => {
    if (value === undefined) return { missing: true };
    const encoded = JSON.stringify(value);
    return encoded.length > 200 ? encoded.slice(0, 200) + '…' : value;
  };
  return { location: path, expected: bounded(expected), actual: bounded(actual) };
}

/**
 * Refuse a tracked candidate unless both effective projections match their
 * independent source/intended views. This does not mutate or publish any input.
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @see https://github.com/UseJunior/safe-docx/issues/1537
 */
export function assertRevisionFidelity(input: {
  source: RevisionFidelityParts; intended: RevisionFidelityParts; output: RevisionFidelityParts;
}, options: RevisionFidelityOptions = {}): void {
  if (options.enabled === false) return;
  const failures: RevisionFidelityFailure[] = [];
  for (const side of ['reject','accept'] as const) {
    let expected: Record<string, unknown>, actual: Record<string, unknown>;
    try {
      expected = snapshot(side === 'reject' ? input.source : input.intended, side, options);
      actual = snapshot(input.output, side, options);
    } catch (error) {
      failures.push({side,part:error instanceof ProjectionError ? error.part : 'package',location:'projection',expected:'projectable XML and relationships',actual:error instanceof ProjectionError ? error.kind : error instanceof Error ? error.name : 'projection failed'});
      continue;
    }
    for (const part of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const mismatch = firstDifference(expected[part], actual[part]);
      if (mismatch) failures.push({ side, part, ...mismatch });
    }
  }
  if (failures.length) throw new RevisionFidelityViolation(failures);
}

/** Collect XML and binary identities without mutating the archive or serializing ZIP bytes. */
export async function collectRevisionFidelityParts(archive: {
  listFiles(): string[];
  getFile(path: string): Promise<string | null>;
  getFileBuffer(path: string): Promise<Uint8Array | null>;
}): Promise<RevisionFidelityParts> {
  const entries = await Promise.all(archive.listFiles().filter(p => !p.endsWith('/')).map(async p => {
    if (/\.(?:xml|rels)$/iu.test(p)) return [p, (await archive.getFile(p))!] as const;
    const bytes = await archive.getFileBuffer(p);
    return ['@binary:' + p, bytes ? hash(bytes) : 'missing'] as const;
  }));
  return Object.fromEntries(entries);
}
export async function readRevisionFidelityParts(bytes: Uint8Array): Promise<RevisionFidelityParts> {
  return collectRevisionFidelityParts(await DocxArchive.load(bytes));
}
