#!/usr/bin/env node

/**
 * Tag-density guard for OpenSpec traceability tags.
 *
 * A single `test(...)` carrying many `.openspec('[ID] …')` tags is a
 * tag-stuffing smell: one assertion claiming to discharge several distinct
 * scenarios (see #513, where `[LEAN-RT-01..05]` were piled onto one property
 * test and `[LEAN-RT-05]` landed on the *wrong* test). But it is sometimes
 * legitimate — the Lean bridge tests genuinely map a related cluster of
 * `[LEAN-*]` scenarios onto one property/fixture test by accepted convention.
 *
 * This guard makes that legitimacy deliberate and greppable: when a single
 * test carries `>= THRESHOLD` `.openspec` tags, it must declare an explicit
 * adjacent `coverage-rationale:` annotation (a leading `//`/`/* *\/` comment or
 * a `@coverage-rationale` JSDoc tag). A missing rationale WARNs by default and
 * FAILs under `--strict`; an empty rationale is itself the smell a reviewer can
 * grep for, so it is reported too.
 *
 * Counting is AST-based (TypeScript compiler API), so it sees the fluent
 * `test.openspec(...).openspec(...)('name', fn)` chain regardless of
 * formatting, and it is not fooled by `.openspec` mentions inside comments or
 * strings.
 *
 * Usage:
 *   node scripts/validate_openspec_tag_density.mjs [--strict] [--threshold N]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const TEST_ROOT = path.join(PACKAGE_ROOT, 'src');

const DEFAULT_THRESHOLD = 3;

// Recognizes `coverage-rationale:` / `@coverage-rationale` / `@coverageRationale`
// inside a leading comment, and captures whatever follows so we can tell a real
// rationale apart from an empty marker.
const RATIONALE_RE = /(?:^|[\s*/@])coverage-?rationale\b\s*[:-]?\s*([^\n\r]*)/i;

const TEST_CALLEE_NAMES = new Set(['test', 'it']);

function parseArgs(argv) {
  let strict = false;
  let threshold = DEFAULT_THRESHOLD;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--threshold') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--threshold requires a positive integer, got: ${argv[i + 1]}`);
      }
      threshold = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { strict, threshold };
}

async function listTestFiles(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
        continue;
      }
      if (full.endsWith('.test.ts')) out.push(full);
    }
  }
  await walk(rootDir);
  return out.sort();
}

/** Leftmost identifier of a callee chain, e.g. `test` in `test.skip.openspec`. */
function baseIdentifierName(node) {
  let current = node;
  while (current) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Given the outermost `test(...)` call, count the `.openspec(...)` tags in its
 * callee chain. `test.openspec(a).openspec(b)('name', fn)` → 2.
 */
function countOpenspecTags(outerCall) {
  let count = 0;
  let node = outerCall.expression;
  while (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'openspec'
  ) {
    count += 1;
    node = node.expression.expression;
  }
  return count;
}

/** Is `call` the outermost test invocation (not an intermediate `.openspec` in a chain)? */
function isOuterTestCall(call) {
  if (baseIdentifierName(call.expression) === null) return false;
  if (!TEST_CALLEE_NAMES.has(baseIdentifierName(call.expression))) return false;
  // An intermediate `.openspec(...)` call is the object of a parent `.openspec`
  // property access; the outer call is not.
  const parent = call.parent;
  if (
    parent &&
    ts.isPropertyAccessExpression(parent) &&
    parent.name.text === 'openspec' &&
    parent.expression === call
  ) {
    return false;
  }
  return true;
}

/** Walk up to the enclosing statement so we can read its leading comments. */
function enclosingStatement(node) {
  let current = node;
  while (current && current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isStatement(current)) return current;
    current = current.parent;
  }
  return current;
}

/**
 * Inspect leading comments of `statement` for a `coverage-rationale` marker.
 * Returns `{ present, text }` — `present` true if the marker exists, `text` the
 * (possibly empty) rationale prose following it.
 */
function findRationale(statement, fullText) {
  const ranges = ts.getLeadingCommentRanges(fullText, statement.getFullStart()) ?? [];
  for (const range of ranges) {
    const comment = fullText.slice(range.pos, range.end);
    const match = comment.match(RATIONALE_RE);
    if (match) {
      // Strip comment artifacts (`*`, `/`) and collapse whitespace so a JSDoc
      // rationale wrapped across lines still reads as non-empty.
      const tail = comment
        .slice(match.index + match[0].length - (match[1] ?? '').length)
        .replace(/\*\/\s*$/, '')
        .replace(/^[\s*/]+/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { present: true, text: tail };
    }
  }
  return { present: false, text: '' };
}

function testLabel(outerCall) {
  const firstArg = outerCall.arguments[0];
  if (firstArg && ts.isStringLiteralLike(firstArg)) return firstArg.text;
  return '<unnamed test>';
}

export function analyzeFile(absPath, content, threshold = DEFAULT_THRESHOLD) {
  const sourceFile = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];

  function visit(node) {
    if (ts.isCallExpression(node) && isOuterTestCall(node)) {
      const tagCount = countOpenspecTags(node);
      if (tagCount >= threshold) {
        const statement = enclosingStatement(node);
        const rationale = findRationale(statement, content);
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({
          line: line + 1,
          tagCount,
          label: testLabel(node),
          hasRationale: rationale.present && rationale.text.length > 0,
          emptyRationale: rationale.present && rationale.text.length === 0,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

async function main() {
  const { strict, threshold } = parseArgs(process.argv.slice(2));
  const testFiles = await listTestFiles(TEST_ROOT);

  const violations = [];
  let highDensityTotal = 0;

  for (const absPath of testFiles) {
    const content = await fs.readFile(absPath, 'utf-8');
    const rel = path.relative(PACKAGE_ROOT, absPath).split(path.sep).join('/');
    for (const finding of analyzeFile(absPath, content, threshold)) {
      highDensityTotal += 1;
      if (!finding.hasRationale) {
        violations.push({ rel, ...finding });
      }
    }
  }

  const annotated = highDensityTotal - violations.length;
  if (violations.length === 0) {
    console.log(
      `PASS openspec-tag-density: ${highDensityTotal} high-density test(s) (>= ${threshold} tags), all carry a coverage-rationale.`,
    );
    return;
  }

  const label = strict ? 'FAIL' : 'WARN';
  console.error(
    `${label} openspec-tag-density: ${violations.length} high-density test(s) (>= ${threshold} tags) lack a coverage-rationale (${annotated} annotated).`,
  );
  for (const v of violations) {
    const reason = v.emptyRationale ? 'empty coverage-rationale' : 'no coverage-rationale annotation';
    console.error(`  ${v.rel}:${v.line}  ${v.tagCount} tags — ${reason}`);
    console.error(`    test: ${v.label}`);
  }
  console.error(
    '  Add an adjacent `// coverage-rationale: …` comment (or `@coverage-rationale` JSDoc tag) explaining why this',
  );
  console.error('  cluster of scenarios legitimately maps to one test, or split the tags across tests.');

  if (strict) process.exitCode = 1;
}

// Run as a CLI only when invoked directly (`node validate_openspec_tag_density.mjs`),
// not when imported by the unit test.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
