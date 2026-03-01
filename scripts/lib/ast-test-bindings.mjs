/**
 * Shared TypeScript AST parser for test bindings.
 *
 * Walks test files, parses with the TypeScript compiler API, and extracts
 * `.openspec()` invocations together with their epic labels.
 *
 * Ported from open-agreements/scripts/generate_system_card.mjs (lines 78-345)
 * and adapted for safe-docx's multi-package layout.
 *
 * Export: collectBindingEpicMap(repoRoot, testRoots)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const TEST_FILE_PATTERN = /\.test\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/;

// Detect by usage pattern, not import path — `.openspec()` DSL is the unique
// identifier regardless of how allure-test.js is imported or aliased.
const ALLURE_WRAPPER_EXPORT_NAMES = new Set(['itAllure', 'testAllure']);
const ALLURE_WRAPPER_CHAIN_METHODS = new Set(['epic', 'withLabels', 'openspec', 'allure']);

const MAPPED_TEST_REF_RE = /^(.+?):(\d+)\s+::\s+(.+)$/;

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

async function listTestFiles(repoRoot, testRoots) {
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(absPath);
        continue;
      }
      if (!TEST_FILE_PATTERN.test(entry.name)) continue;
      files.push(toPosixPath(path.relative(repoRoot, absPath)));
    }
  }

  for (const root of testRoots) {
    const absRoot = path.isAbsolute(root) ? root : path.join(repoRoot, root);
    try {
      const stat = await fs.stat(absRoot);
      if (!stat.isDirectory()) continue;
      await walk(absRoot);
    } catch {
      // Ignore missing test roots.
    }
  }

  return files.sort();
}

function getScriptKind(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function getStringLiteralValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function unwrapExpression(node) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrapExpression(node.expression);
  }
  return node;
}

/**
 * Detect `.openspec()` invocations in both direct and chained forms:
 *   - Direct: `it.openspec('name')('title', ...)`
 *   - Chained: `it.openspec('name').skip('title', ...)`
 *
 * Returns the root expression (for epic resolution) and the openspec call
 * node (for extracting the scenario name argument).
 */
function extractOpenSpecInvocation(node) {
  if (!ts.isCallExpression(node)) return null;

  // Direct form: it.openspec('OA-001')('title', ...)
  if (ts.isCallExpression(node.expression)) {
    const inner = node.expression;
    if (
      ts.isPropertyAccessExpression(inner.expression)
      && inner.expression.name.text === 'openspec'
    ) {
      return { openspecRoot: inner.expression.expression, openspecCall: inner };
    }
  }

  // Chained form: it.openspec('OA-001').skip('title', ...)
  if (ts.isPropertyAccessExpression(node.expression) && ts.isCallExpression(node.expression.expression)) {
    const inner = node.expression.expression;
    if (
      ts.isPropertyAccessExpression(inner.expression)
      && inner.expression.name.text === 'openspec'
    ) {
      return { openspecRoot: inner.expression.expression, openspecCall: inner };
    }
  }

  return null;
}

function createBindingRef({ relFile, sourceFile, node, title }) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const line = location.line + 1;
  return `${relFile}:${line} :: ${title}`;
}

/**
 * Scan import declarations for allure helper imports.
 * Detects by usage pattern: looks for imports of itAllure/testAllure regardless
 * of import path (handles varied relative paths and aliasing).
 */
function collectAllureImportAliases(sourceFile) {
  const aliases = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (ALLURE_WRAPPER_EXPORT_NAMES.has(importedName)) {
        aliases.add(element.name.text);
      }
    }
  }
  return aliases;
}

function isAllureWrapperExpression(node, knownWrapperAliases) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) {
    return knownWrapperAliases.has(expression.text);
  }

  if (ts.isPropertyAccessExpression(expression)) {
    if (!ALLURE_WRAPPER_CHAIN_METHODS.has(expression.name.text)) return false;
    return isAllureWrapperExpression(expression.expression, knownWrapperAliases);
  }

  if (ts.isCallExpression(expression)) {
    if (!ts.isPropertyAccessExpression(expression.expression)) return false;
    const methodName = expression.expression.name.text;
    if (!ALLURE_WRAPPER_CHAIN_METHODS.has(methodName)) return false;
    return isAllureWrapperExpression(expression.expression.expression, knownWrapperAliases);
  }

  return false;
}

function resolveEpicFromWrapperExpression(node, aliasToEpic) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) {
    return aliasToEpic.get(expression.text) ?? null;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    if (!ALLURE_WRAPPER_CHAIN_METHODS.has(expression.name.text)) return null;
    return resolveEpicFromWrapperExpression(expression.expression, aliasToEpic);
  }

  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const methodName = expression.expression.name.text;
    if (!ALLURE_WRAPPER_CHAIN_METHODS.has(methodName)) return null;
    const baseEpic = resolveEpicFromWrapperExpression(expression.expression.expression, aliasToEpic);
    if (methodName === 'epic') {
      const epic = expression.arguments[0] ? getStringLiteralValue(expression.arguments[0]) : null;
      if (epic && epic.trim().length > 0) return epic.trim();
    }
    return baseEpic;
  }

  return null;
}

function collectAllureWrapperEpics(sourceFile) {
  const knownAliases = collectAllureImportAliases(sourceFile);
  const aliasToEpic = new Map();
  const declarations = [];

  for (const alias of knownAliases) {
    aliasToEpic.set(alias, null);
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // Fixed-point iteration to propagate wrapper aliases through reassignments
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const alias = declaration.name.text;
      if (!isAllureWrapperExpression(declaration.initializer, knownAliases)) continue;
      if (!knownAliases.has(alias)) {
        knownAliases.add(alias);
        changed = true;
      }
      const epic = resolveEpicFromWrapperExpression(declaration.initializer, aliasToEpic);
      const normalizedEpic = epic ?? null;
      if ((aliasToEpic.get(alias) ?? null) !== normalizedEpic) {
        aliasToEpic.set(alias, normalizedEpic);
        changed = true;
      }
    }
  }

  return { knownAliases, aliasToEpic };
}

/**
 * Normalize a scenario name from an `.openspec()` argument for matching
 * against spec scenario entries.
 */
function normalizeScenarioForMatching(raw) {
  return raw
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Main driver: parse every test file with the TypeScript compiler, collect
 * `.openspec()` invocations, and build:
 *   - `bindingEpicByRef`: Map<ref, epic> for epic grouping
 *   - `scenarioToRefs`: Map<normalizedScenarioName, ref[]> for matrix enrichment
 *
 * @param {string} repoRoot - Absolute path to the repository root
 * @param {string[]} testRoots - Relative (or absolute) paths to test root directories
 * @param {string} [defaultEpic] - Fallback epic label for tests without .epic() chain
 * @returns {Promise<{ bindingEpicByRef: Map<string, string>, scenarioToRefs: Map<string, string[]> }>}
 */
export async function collectBindingEpicMap(repoRoot, testRoots, defaultEpic) {
  const fallbackEpic = defaultEpic ?? 'Uncategorized';
  const bindingEpicByRef = new Map();
  const scenarioToRefs = new Map();
  const testFiles = await listTestFiles(repoRoot, testRoots);

  for (const relFile of testFiles) {
    const absFile = path.join(repoRoot, relFile);
    const content = await fs.readFile(absFile, 'utf-8');
    const sourceFile = ts.createSourceFile(
      relFile,
      content,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(relFile),
    );
    const { knownAliases, aliasToEpic } = collectAllureWrapperEpics(sourceFile);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const invocation = extractOpenSpecInvocation(node);
        if (
          invocation
          && isAllureWrapperExpression(invocation.openspecRoot, knownAliases)
        ) {
          const titleNode = node.arguments[0];
          const title = titleNode
            ? (getStringLiteralValue(titleNode) ?? '<dynamic test title>')
            : '<missing test title>';
          const ref = createBindingRef({ relFile, sourceFile, node, title });
          const epic = resolveEpicFromWrapperExpression(invocation.openspecRoot, aliasToEpic)
            ?? fallbackEpic;
          if (!bindingEpicByRef.has(ref)) {
            bindingEpicByRef.set(ref, epic);
          }

          // Extract scenario name from the .openspec() argument
          const scenarioArg = invocation.openspecCall.arguments[0];
          if (scenarioArg) {
            const rawScenario = getStringLiteralValue(scenarioArg);
            if (rawScenario) {
              const normalized = normalizeScenarioForMatching(rawScenario);
              const refs = scenarioToRefs.get(normalized) ?? [];
              refs.push(ref);
              scenarioToRefs.set(normalized, refs);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { bindingEpicByRef, scenarioToRefs };
}

// ── Ref parsing helpers (shared with trust-metrics.mjs / generate_system_card.mjs) ──

export function parseMappedTestRefs(cellValue) {
  const refs = [];
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(cellValue)) !== null) {
    const ref = match[1].trim();
    if (ref.length > 0) refs.push(ref);
  }
  return refs;
}

export function parseMappedTestRef(ref) {
  const match = String(ref).match(MAPPED_TEST_REF_RE);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line) || line <= 0) return null;
  return {
    filePath: toPosixPath(match[1].trim()),
    line,
    title: match[3].trim().replace(/\s+/g, ' '),
  };
}
