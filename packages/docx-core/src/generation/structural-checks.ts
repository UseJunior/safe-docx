/**
 * Post-build structural validation of a generated package — the
 * "no recovery dialog" gate. Each check targets a concrete repair trigger in
 * reading applications: missing content types, dangling relationship targets,
 * unresolvable r:id references, malformed section properties, and unbalanced
 * field characters.
 *
 * `auditSectPr` is reused as one component: it flags duplicated or misplaced
 * body-level sectPr and dangling header/footer references, but tolerates the
 * zero-sectPr case (legal for parsed third-party documents), so the
 * required-final-sectPr check lives here.
 */

import { auditSectPr } from '../primitives/sectPrAudit.js';
import { NODE_TYPE } from '../primitives/dom-helpers.js';
import { OOXML } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { DocxZip } from '../primitives/zip.js';
import { FieldTraversal } from '../shared/field-structure.js';

export type StructuralIssue = {
  check:
    | 'xml_declaration'
    | 'content_type_coverage'
    | 'relationship_target'
    | 'rid_resolution'
    | 'sectpr'
    | 'field_pairing'
    | 'bookmark_pairing'
    | 'bookmark_name_uniqueness'
    | 'table';
  part: string;
  message: string;
  /** The repeated name, lower-cased as compared; set on `bookmark_name_uniqueness` findings. */
  bookmarkName?: string;
};

export type StructuralCheckResult = {
  /** True when `issues` is empty; `warnings` never fail a package. */
  ok: boolean;
  issues: StructuralIssue[];
  warnings: StructuralIssue[];
};

export type StructuralCheckOptions = {
  /**
   * How a bookmark name repeated within one story part is reported. `'error'`
   * (the default) fails the package: safe-docx never writes a repeated name.
   * `'warning'` records it in `warnings` instead, for packages safe-docx did
   * not write, such as comparison inputs, where a repeat is legal.
   */
  duplicateBookmarkNames?: 'error' | 'warning';
  /**
   * Generation uses nested field traversal. The differential characterization
   * explicitly selects its frozen historical diagnostics, including false
   * positives for nested fields, so reviewed corpus evidence stays comparable.
   */
  fieldPairing?: 'nested' | 'legacy-differential';
};

/** Run every structural check against a generated package buffer. */
export async function checkGeneratedPackage(
  buffer: Buffer,
  options: StructuralCheckOptions = {},
): Promise<StructuralCheckResult> {
  const zip = await DocxZip.load(buffer);
  const files = zip.listFiles().filter((name) => !name.endsWith('/'));
  const contents = new Map<string, string>();
  for (const name of files) {
    contents.set(name, await zip.readText(name));
  }

  const issues: StructuralIssue[] = [
    ...checkXmlDeclarations(contents),
    ...checkContentTypeCoverage(contents),
    ...checkRelationshipTargets(contents),
    ...checkRidResolution(contents),
    ...checkSectPr(contents),
    ...(options.fieldPairing === 'legacy-differential'
      ? checkLegacyDifferentialFieldPairing(contents)
      : checkFieldPairing(contents)),
    ...checkBookmarks(contents),
    ...checkTables(contents),
  ];
  const duplicateNames = checkBookmarkNameUniqueness(contents);
  const warnings: StructuralIssue[] = [];
  if (options.duplicateBookmarkNames === 'warning') warnings.push(...duplicateNames);
  else issues.push(...duplicateNames);
  return { ok: issues.length === 0, issues, warnings };
}

function isXmlPart(name: string): boolean {
  return name.endsWith('.xml') || name.endsWith('.rels');
}

function checkXmlDeclarations(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isXmlPart(name)) continue;
    if (!text.startsWith('<?xml')) {
      issues.push({
        check: 'xml_declaration',
        part: name,
        message: 'XML part does not begin with an <?xml declaration',
      });
    }
  }
  return issues;
}

function checkContentTypeCoverage(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const contentTypes = contents.get('[Content_Types].xml');
  if (!contentTypes) {
    return [{ check: 'content_type_coverage', part: '[Content_Types].xml', message: 'Part is missing' }];
  }
  const doc = parseXml(contentTypes);
  const defaults = new Set<string>();
  const overrides = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName('Default'))) {
    const ext = el.getAttribute('Extension');
    if (ext) defaults.add(ext.toLowerCase());
  }
  for (const el of Array.from(doc.getElementsByTagName('Override'))) {
    const part = el.getAttribute('PartName');
    if (part) overrides.add(part);
  }
  for (const name of contents.keys()) {
    if (name === '[Content_Types].xml') continue;
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    if (!overrides.has(`/${name}`) && !defaults.has(extension)) {
      issues.push({
        check: 'content_type_coverage',
        part: name,
        message: 'Part is covered by neither a content-type Default nor an Override',
      });
    }
  }
  return issues;
}

/** Directory ('word/' or '') whose relationships a .rels part declares. */
function relsOwnerDir(relsName: string): string {
  const marker = '_rels/';
  const idx = relsName.lastIndexOf(marker);
  return idx <= 0 ? '' : relsName.slice(0, idx);
}

function resolveTarget(ownerDir: string, target: string): string {
  const joined = target.startsWith('/') ? target.slice(1) : ownerDir + target;
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function checkRelationshipTargets(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!name.endsWith('.rels')) continue;
    const ownerDir = relsOwnerDir(name);
    const doc = parseXml(text);
    for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
      if (rel.getAttribute('TargetMode') === 'External') continue;
      const target = rel.getAttribute('Target');
      if (!target) {
        issues.push({ check: 'relationship_target', part: name, message: 'Relationship without Target' });
        continue;
      }
      const resolved = resolveTarget(ownerDir, target);
      if (!contents.has(resolved)) {
        issues.push({
          check: 'relationship_target',
          part: name,
          message: `Relationship target '${target}' resolves to missing part '${resolved}'`,
        });
      }
    }
  }
  return issues;
}

function relsIdsFor(contents: Map<string, string>, partName: string): Set<string> {
  const dir = partName.includes('/') ? partName.slice(0, partName.lastIndexOf('/') + 1) : '';
  const base = partName.slice(dir.length);
  const relsName = `${dir}_rels/${base}.rels`;
  const ids = new Set<string>();
  const text = contents.get(relsName);
  if (!text) return ids;
  const doc = parseXml(text);
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id');
    if (id) ids.add(id);
  }
  return ids;
}

function checkRidResolution(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
    const ids = relsIdsFor(contents, name);
    const doc = parseXml(text);
    const visit = (el: Element) => {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i]!;
        const isRid = attr.namespaceURI === OOXML.R_NS || attr.name === 'r:id' || attr.name === 'r:embed';
        if (!isRid) continue;
        if (!ids.has(attr.value)) {
          issues.push({
            check: 'rid_resolution',
            part: name,
            message: `<${el.tagName}> references relationship '${attr.value}' missing from this part's rels`,
          });
        }
      }
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i]!;
        if (child.nodeType === NODE_TYPE.ELEMENT) visit(child as Element);
      }
    };
    if (doc.documentElement) visit(doc.documentElement);
  }
  return issues;
}

/**
 * Generated documents must bind their final section explicitly: exactly one
 * body-level w:sectPr, positioned last. auditSectPr supplies the placement
 * and reference checks but allows the zero-sectPr case, hence the count
 * assertion here.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.17
 */
function checkSectPr(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const documentXml = contents.get('word/document.xml');
  if (!documentXml) {
    return [{ check: 'sectpr', part: 'word/document.xml', message: 'Part is missing' }];
  }
  const audit = auditSectPr(documentXml, contents.get('word/_rels/document.xml.rels') ?? null, contents);
  for (const issue of audit.issues) {
    issues.push({ check: 'sectpr', part: 'word/document.xml', message: `${issue.type}: ${issue.message}` });
  }
  if (audit.stats.bodyLevelSectPrCount !== 1) {
    issues.push({
      check: 'sectpr',
      part: 'word/document.xml',
      message: `Expected exactly one body-level w:sectPr, found ${audit.stats.bodyLevelSectPrCount}`,
    });
  }
  return issues;
}

function isStoryPart(name: string): boolean {
  return (
    name === 'word/document.xml' ||
    /^word\/header\d+\.xml$/.test(name) ||
    /^word\/footer\d+\.xml$/.test(name) ||
    name === 'word/footnotes.xml' ||
    name === 'word/endnotes.xml' ||
    name === 'word/comments.xml'
  );
}

/**
 * Frozen compatibility diagnostics used only by differential characterization.
 * Keep the historical phase transitions, story-part scope, prefix matching,
 * ordering, and messages; this is not the policy for validating new packages.
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.16.18 — the pinned differential diagnostic contract intentionally retains historical false positives for nested fields
 */
function checkLegacyDifferentialFieldPairing(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isStoryPart(name)) continue;
    const doc = parseXml(text);
    let state: 'idle' | 'instr' | 'result' = 'idle';
    const visit = (el: Element) => {
      if (el.tagName === 'w:fldChar') {
        const type = el.getAttribute('w:fldCharType');
        if (type === 'begin') {
          if (state !== 'idle') {
            issues.push({ check: 'field_pairing', part: name, message: 'fldChar begin while a field is already open' });
          }
          state = 'instr';
        } else if (type === 'separate') {
          if (state !== 'instr') {
            issues.push({ check: 'field_pairing', part: name, message: 'fldChar separate without a matching begin' });
          }
          state = 'result';
        } else if (type === 'end') {
          if (state === 'idle') {
            issues.push({ check: 'field_pairing', part: name, message: 'fldChar end without a matching begin' });
          }
          state = 'idle';
        }
      } else if (el.tagName === 'w:instrText') {
        if (state !== 'instr') {
          issues.push({ check: 'field_pairing', part: name, message: 'w:instrText outside a begin→separate range' });
        }
      }
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i]!;
        if (child.nodeType === NODE_TYPE.ELEMENT) visit(child as Element);
      }
    };
    if (doc.documentElement) visit(doc.documentElement);
    if (state !== 'idle') {
      issues.push({ check: 'field_pairing', part: name, message: 'Unclosed field at end of story part' });
    }
  }
  return issues;
}

/**
 * Validate begin → separate → end field structure independently in each
 * generated WordprocessingML story part.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 */
function checkFieldPairing(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isStoryPart(name)) continue;
    const doc = parseXml(text);
    const checkStory = (root: Element) => {
      const traversal = new FieldTraversal(name, (issue) => {
        issues.push({ check: 'field_pairing', part: name, message: issue.message });
      });
      const visit = (el: Element) => {
        // Notes, comments, and text boxes contain independent stories, even
        // when they share a package part or are embedded in the body story.
        if (el !== root && el.namespaceURI === OOXML.W_NS &&
          ['footnote', 'endnote', 'comment', 'txbxContent'].includes(el.localName)) {
          checkStory(el);
          return;
        }
        if (el.namespaceURI === OOXML.W_NS && el.localName === 'fldChar') {
          traversal.advance(el.getAttributeNS(OOXML.W_NS, 'fldCharType') ?? el.getAttribute('w:fldCharType'));
        } else if (el.namespaceURI === OOXML.W_NS && el.localName === 'instrText') {
          if (!traversal.isInsideFieldCode()) {
            issues.push({
              check: 'field_pairing',
              part: name,
              message: 'w:instrText outside a begin→separate range',
            });
          }
        }
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes[i]!;
          if (child.nodeType === NODE_TYPE.ELEMENT) visit(child as Element);
        }
      };
      visit(root);
      traversal.finish();
    };
    if (doc.documentElement) checkStory(doc.documentElement);
  }
  return issues;
}

/**
 * Bookmarks pair up in each story part: every `w:bookmarkStart` has a unique
 * id and a later `w:bookmarkEnd` with the same id, every end closes an earlier
 * start, and no bookmark id repeats a comment range id of the same part.
 * Repeated names are a separate, policy-level check
 * (`checkBookmarkNameUniqueness`).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 */
function checkBookmarks(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isStoryPart(name) || !text.includes('bookmark')) continue;
    const doc = parseXml(text);
    const open = new Set<string>();
    const ids = new Set<string>();
    const fail = (message: string) => issues.push({ check: 'bookmark_pairing', part: name, message });
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      const id = el.getAttribute('w:id') ?? '';
      if (el.tagName === 'w:bookmarkStart') {
        if (ids.has(id)) fail(`Bookmark id ${id} is used twice`);
        ids.add(id);
        open.add(id);
      } else if (el.tagName === 'w:bookmarkEnd') {
        if (!open.delete(id)) fail(`bookmarkEnd ${id} closes no earlier bookmarkStart`);
      }
    }
    for (const id of open) fail(`bookmarkStart ${id} has no later bookmarkEnd`);
    for (const el of Array.from(doc.getElementsByTagName('w:commentRangeStart'))) {
      if (ids.has(el.getAttribute('w:id') ?? '')) fail(`Bookmark id ${el.getAttribute('w:id')} repeats a comment range id`);
    }
  }
  return issues;
}

/**
 * Bookmark names are unique in each story part, compared without regard to
 * case, as Word compares them. This is a safe-docx policy, stricter than the
 * spec. The `name` attribute of § 17.13.6.2 permits a repeat and says how a
 * reader resolves it: "If multiple bookmarks in a document share the same
 * name, then the first bookmark (defined by the location of the bookmarkStart
 * element in document order) shall be maintained, and all subsequent
 * bookmarks should be ignored." Word does not follow that sentence: Word for
 * Mac 16.114 keeps the last range of a repeated name and resolves a REF field
 * to it (scripts/oracle/word/evidence/issue-1264-word-16.114.json). Because
 * the spec and Word disagree about which range a cross-reference reaches,
 * safe-docx never writes a repeat. Packages safe-docx did not write report a
 * repeat as a warning when the caller asks (`duplicateBookmarkNames:
 * 'warning'`).
 *
 * @conformance-gap ECMA-376 edition 5, Part 1 § 17.13.6.2 — stricter than the spec: repeated bookmark names are legal (the spec keeps the first range, Word keeps the last), but generated packages must not contain them
 */
function checkBookmarkNameUniqueness(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isStoryPart(name) || !text.includes('bookmark')) continue;
    const names = new Set<string>();
    for (const el of Array.from(parseXml(text).getElementsByTagName('w:bookmarkStart'))) {
      const bookmarkName = (el.getAttribute('w:name') ?? '').toLowerCase();
      if (names.has(bookmarkName)) {
        issues.push({
          check: 'bookmark_name_uniqueness',
          part: name,
          message: `Bookmark name '${el.getAttribute('w:name')}' is used twice`,
          bookmarkName,
        });
      }
      names.add(bookmarkName);
    }
  }
  return issues;
}

/**
 * Table invariants readers actually enforce: every cell ends with a w:p,
 * and the document body never ends with a table (the element preceding the
 * body-level sectPr, or the last body child, must not be w:tbl).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.4.65
 */
function checkTables(contents: Map<string, string>): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  for (const [name, text] of contents) {
    if (!isStoryPart(name)) continue;
    const doc = parseXml(text);

    for (const tc of Array.from(doc.getElementsByTagName('w:tc'))) {
      let last: Element | null = null;
      for (let child = tc.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === NODE_TYPE.ELEMENT) last = child as Element;
      }
      if (!last || last.tagName !== 'w:p') {
        issues.push({
          check: 'table',
          part: name,
          message: `Table cell ends with <${last?.tagName ?? 'nothing'}> instead of a w:p`,
        });
      }
    }

    if (name !== 'word/document.xml') continue;
    const body = doc.getElementsByTagName('w:body').item(0);
    if (!body) continue;
    let lastContent: Element | null = null;
    for (let child = body.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== NODE_TYPE.ELEMENT) continue;
      const el = child as Element;
      if (el.tagName === 'w:sectPr') continue;
      lastContent = el;
    }
    if (lastContent && lastContent.tagName === 'w:tbl') {
      issues.push({ check: 'table', part: name, message: 'Document body ends with a w:tbl' });
    }
  }
  return issues;
}
