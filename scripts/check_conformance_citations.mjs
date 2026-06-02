#!/usr/bin/env node
// check_conformance_citations.mjs
//
// Lints `@conformance` / `@conformance-gap` JSDoc tags in source and
// `.conformance(...)` calls in tests against the conformance registry at
// `spec-compliance/registry/*.md` and the vendored XSDs under
// `spec-compliance/ecma-376/schemas/`.
//
// Why AST instead of regex: the existing peer scripts under `scripts/`
// (validate_allure_test_labels.mjs, check_allure_test_filename_policy.mjs)
// scan with regex. JSDoc block parsing via regex is brittle (template
// literals containing `*/`, disjoint attachment, etc.), so this script
// uses `@typescript-eslint/parser` instead. See
// `openspec/changes/add-ecma-376-conformance-framework/design.md` (D5).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@typescript-eslint/parser';
import { XMLParser } from 'fast-xml-parser';
import { loadRegistry } from './lib/conformance-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'spec-compliance', 'registry');

const TAG_VALUE_GRAMMAR = /^([A-Z][A-Z0-9-]+)\s+edition\s+(\d+),\s+Part\s+(\d+)\s+§\s+(\d+(?:\.\d+)*)$/;
const TAG_GAP_VALUE_GRAMMAR = /^([A-Z][A-Z0-9-]+)\s+edition\s+(\d+),\s+Part\s+(\d+)\s+§\s+(\d+(?:\.\d+)*)\s+—\s+(.+)$/;

const SOURCE_GLOBS = [/^packages\/[^/]+\/src\//];
const SOURCE_EXCLUDES = [
  /\.test\.ts$/,
  /\/__tests__\//,
  /\/docs\//,
  /\/verification\//,
  /\bSUPPORT\.md$/,
  /\bopenspec\/changes\//,
  /\bopenspec\/specs\//,
  /\bspec-compliance\//,
];
const TEST_GLOBS = [/^packages\/[^/]+\/src\/.*\.test\.ts$/, /^packages\/[^/]+\/test-primitives\/.*\.test\.ts$/];

const ERRORS = [];
function err(file, line, message) {
  ERRORS.push({ file, line, message });
}

// ── Registry ────────────────────────────────────────────────────────────────

function* walkFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Don't descend into the schema directory or vendor-style trees
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      yield* walkFiles(full, predicate);
    } else if (predicate(full)) {
      yield full;
    }
  }
}

// Explicit spec → registry-ID-family map. Regex-stripping `-\d+$` from spec
// names happens to work for `ECMA-376` but misbehaves on `RFC-7234`,
// `ISO-8601`, and any spec whose number suffix is load-bearing. The map is
// the single source of truth; add a row to extend the framework to a new
// spec family.
const SPEC_FAMILY_MAP = {
  'ECMA-376': 'ECMA',
};

function deriveIdFromTagParts(spec, _edition, part, section) {
  // ECMA-PART4-17-16-5 style (no brackets — those are heading syntax in the
  // registry; the parser strips them). Edition is not part of the ID (lives
  // in the tag and the registry entry as a separate field).
  const family = SPEC_FAMILY_MAP[spec] ?? spec;
  const sectionId = String(section).replace(/\./g, '-');
  return `${family}-PART${part}-${sectionId}`;
}

// ── XSD index ───────────────────────────────────────────────────────────────

function buildXsdIndex() {
  // `removeNSPrefix: true` lets fast-xml-parser strip the namespace prefix
  // from element names, so we don't need to special-case `xsd:` vs `xs:`
  // (or any other alias an XSD file might use). The previous regex
  // `key.replace(/^(?:xsd|xs):/, '')` was case-sensitive and would silently
  // miss anything like `XS:` or a non-canonical alias.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    removeNSPrefix: true,
  });
  const schemasDir = path.join(REPO_ROOT, 'spec-compliance', 'ecma-376', 'schemas');
  const index = new Map(); // absolutePath -> { elements: Set, types: Set, attributes: Set }
  if (!fs.existsSync(schemasDir)) return index;

  for (const file of walkFiles(schemasDir, (f) => f.endsWith('.xsd'))) {
    try {
      const xml = fs.readFileSync(file, 'utf8');
      const tree = parser.parse(xml);
      const decls = { elements: new Set(), types: new Set(), attributes: new Set() };
      collectDecls(tree, decls);
      index.set(path.relative(REPO_ROOT, file), decls);
    } catch (e) {
      err(file, 1, `Failed to parse XSD: ${e.message}`);
    }
  }
  return index;
}

function collectDecls(node, decls) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_')) continue;
    // The parser is configured with `removeNSPrefix: true`, so element keys
    // arrive as their local-name (`element`, `complexType`, etc.) regardless
    // of which namespace prefix the source XSD used.
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const name = item['@_name'];
        if (typeof name === 'string') {
          if (key === 'element') decls.elements.add(name);
          else if (key === 'complexType' || key === 'simpleType') decls.types.add(name);
          else if (key === 'attribute') decls.attributes.add(name);
        }
        collectDecls(item, decls);
      }
    }
  }
}

function resolveSchemaRef(schemaRef, xsdIndex) {
  const m = schemaRef.match(/^(.+?\.xsd)#(element|type|attribute):(.+)$/);
  if (!m) return { ok: false, reason: `Bad schemaRef syntax: ${schemaRef} (expected path#element:name or #type:name or #attribute:name)` };
  const [, relPath, kind, name] = m;
  const decls = xsdIndex.get(relPath);
  if (!decls) return { ok: false, reason: `schemaRef path not found: ${relPath}` };
  const bucket = kind === 'element' ? decls.elements : kind === 'attribute' ? decls.attributes : decls.types;
  if (!bucket.has(name)) {
    return { ok: false, reason: `schemaRef target not found: ${kind}:${name} in ${relPath}` };
  }
  return { ok: true };
}

// ── Source walk ─────────────────────────────────────────────────────────────

function listSourceFiles() {
  const all = [];
  for (const file of walkFiles(REPO_ROOT, (f) => f.endsWith('.ts'))) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (!SOURCE_GLOBS.some((re) => re.test(rel))) continue;
    if (SOURCE_EXCLUDES.some((re) => re.test(rel))) continue;
    all.push({ abs: file, rel });
  }
  return all;
}

function listTestFiles() {
  const all = [];
  for (const file of walkFiles(REPO_ROOT, (f) => f.endsWith('.ts'))) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (TEST_GLOBS.some((re) => re.test(rel))) {
      all.push({ abs: file, rel });
    }
  }
  return all;
}

function findJsDocComments(ast) {
  // Return JSDoc-style /** ... */ blocks.
  return (ast.comments ?? []).filter((c) => c.type === 'Block' && c.value.startsWith('*'));
}

function isTopLevelOrFileLeading(comment, ast, src) {
  // File-leading: the very first JSDoc block in the file.
  const allDoc = findJsDocComments(ast);
  if (allDoc.length > 0 && allDoc[0].range[0] === comment.range[0]) return true;

  // Attached to a top-level declaration: the next top-level body statement
  // is separated from this comment by nothing but whitespace and other
  // comments. The previous fixed-char heuristic silently skipped stacked
  // JSDoc blocks (a tall second block could push the next statement past
  // the threshold). Strip intervening comments and require what remains to
  // be whitespace only.
  const commentEnd = comment.range[1];
  for (const stmt of ast.body ?? []) {
    if (stmt.range[0] >= commentEnd) {
      const gap = src.slice(commentEnd, stmt.range[0]);
      const stripped = gap
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      if (/^\s*$/.test(stripped)) return true;
      break;
    }
  }
  return false;
}

function extractTags(commentValue) {
  // Returns an array of { tag, value, lineOffset } where lineOffset is the
  // line number within the comment (1-based).
  const tags = [];
  const lines = commentValue.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*\*?\s*@([\w-]+)\s*(.*?)\s*$/);
    if (m) {
      tags.push({ tag: m[1], value: m[2], lineOffset: i });
    }
  }
  return tags;
}

function lintSourceFile(file, registry, xsdIndex) {
  const src = fs.readFileSync(file.abs, 'utf8');
  let ast;
  try {
    ast = parse(src, { loc: true, range: true, comment: true, jsx: false });
  } catch (e) {
    err(file.rel, 1, `Parse error: ${e.message}`);
    return;
  }
  const comments = findJsDocComments(ast);
  for (const c of comments) {
    if (!isTopLevelOrFileLeading(c, ast, src)) continue;
    const startLine = c.loc.start.line;
    const tags = extractTags(c.value);
    const conformanceTags = tags.filter((t) => t.tag === 'conformance');
    const gapTags = tags.filter((t) => t.tag === 'conformance-gap');
    const mentionsEcma = /ECMA-?376/i.test(c.value);

    for (const t of conformanceTags) {
      const tagLine = startLine + t.lineOffset;
      if (/#\d+/.test(t.value)) {
        err(file.rel, tagLine, `@conformance value MUST NOT contain a #NNN issue reference: "${t.value}". Move it to @see or surrounding prose.`);
        continue;
      }
      const m = t.value.match(TAG_VALUE_GRAMMAR);
      if (!m) {
        err(file.rel, tagLine, `@conformance value does not match grammar "<SPEC> edition <N>, Part <N> § <SECTION>": "${t.value}"`);
        continue;
      }
      const [, spec, edition, part, section] = m;
      const id = deriveIdFromTagParts(spec, edition, part, section);
      if (registry.nonGoals.has(id)) {
        err(file.rel, tagLine, `@conformance points at Non-Goal section ${id}. Use @conformance-gap with a reason instead, or revise the registry.`);
        continue;
      }
      if (!registry.targets.has(id)) {
        err(file.rel, tagLine, `@conformance section ${id} is not in the registry (spec-compliance/registry/). Add it before annotating source.`);
      }
    }

    for (const t of gapTags) {
      const tagLine = startLine + t.lineOffset;
      const m = t.value.match(TAG_GAP_VALUE_GRAMMAR);
      if (!m) {
        err(file.rel, tagLine, `@conformance-gap value does not match grammar "<SPEC> edition <N>, Part <N> § <SECTION> — <reason>": "${t.value}"`);
      }
    }

    if (mentionsEcma && conformanceTags.length === 0 && gapTags.length === 0) {
      err(file.rel, startLine, `JSDoc block mentions "ECMA-376" without @conformance or @conformance-gap tag. Lead with the spec (see spec-compliance/AGENTS.md).`);
    }
  }
}

function lintTestFile(file, registry) {
  const src = fs.readFileSync(file.abs, 'utf8');
  let ast;
  try {
    ast = parse(src, { loc: true, range: true, comment: true, jsx: false });
  } catch (e) {
    err(file.rel, 1, `Parse error: ${e.message}`);
    return;
  }

  // Source-text heuristic for ECMA mentions in describe/it titles. AST walk
  // for .conformance(...) calls would be more accurate but the text-level
  // check is sufficient for the hygiene rule.
  const mentionsEcma = /ECMA-?376/i.test(src) || /ECMA-?376/i.test(file.rel);
  if (!mentionsEcma) return;
  const hasConformanceLabel = /\.conformance\s*\(/.test(src);
  if (!hasConformanceLabel) {
    err(file.rel, 1, `Test mentions "ECMA-376" in describe/it text or filename but does not call .conformance({...}). Use testAllure.conformance({ spec, edition, part, section }).`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const registry = loadRegistry();
  for (const e of registry.errors ?? []) {
    err(e.file, e.line, e.message);
  }
  if (registry.entries.length === 0) {
    err(REGISTRY_DIR, 1, 'No registry entries found under spec-compliance/registry/. Add at least one before this lint can be useful.');
  }

  const xsdIndex = buildXsdIndex();

  // 1. Verify every registry schemaRef resolves. Non-Goals carry the same
  // schema binding as targeted sections ("we explicitly do not target this
  // element") so they are validated identically — otherwise a typo'd Non-Goal
  // anchor would pass silently and the out-of-scope claim would rot.
  for (const entry of [...registry.entries, ...registry.nonGoals]) {
    if (!entry.meta.schemaRef) {
      err(entry.file, entry.line, `Registry entry ${entry.id} is missing required schemaRef field.`);
      continue;
    }
    const r = resolveSchemaRef(entry.meta.schemaRef, xsdIndex);
    if (!r.ok) {
      err(entry.file, entry.line, `Registry entry ${entry.id}: ${r.reason}`);
    }
  }

  // 2. Walk source files.
  for (const file of listSourceFiles()) {
    lintSourceFile(file, registry, xsdIndex);
  }

  // 3. Walk test files.
  for (const file of listTestFiles()) {
    lintTestFile(file, registry);
  }

  if (ERRORS.length === 0) {
    console.log(`check_conformance_citations: OK (${registry.entries.length} registry entries, ${xsdIndex.size} XSDs)`);
    process.exit(0);
  }
  for (const e of ERRORS) {
    console.error(`${e.file}:${e.line}: ${e.message}`);
  }
  console.error(`\ncheck_conformance_citations: FAIL (${ERRORS.length} issue${ERRORS.length === 1 ? '' : 's'})`);
  process.exit(1);
}

main();
