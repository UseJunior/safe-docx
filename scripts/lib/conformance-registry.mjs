import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'spec-compliance', 'registry');

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

export function parseRegistryFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const entries = [];
  const nonGoals = [];
  // Prose that sits under `## Non-Goals` before the first `## [ID]` entry. It
  // states the product-level scope boundaries that have no single spec section,
  // so it cannot be a registry entry; capture it as free text instead of
  // discarding it (the `if (!current) continue` below used to drop these lines).
  const nonGoalsPreambleLines = [];
  let current = null;
  let inYaml = false;
  let yamlBuf = [];
  let section = 'targets';
  let lineNo = 0;
  for (const raw of lines) {
    lineNo += 1;
    if (raw.startsWith('## Non-Goals')) {
      if (current) finalize();
      section = 'non-goals';
      continue;
    }
    const heading = raw.match(/^##\s+\[([A-Z][A-Z0-9-]+)\]\s+(.+)$/);
    if (heading) {
      if (current) finalize();
      current = { id: heading[1], title: heading[2], line: lineNo, file, section, meta: {}, prose: [] };
      continue;
    }
    if (!current) {
      if (section === 'non-goals') nonGoalsPreambleLines.push(raw);
      continue;
    }
    if (raw.startsWith('```yaml')) { inYaml = true; yamlBuf = []; continue; }
    if (raw.startsWith('```') && inYaml) {
      inYaml = false;
      for (const ymlLine of yamlBuf) {
        const m = ymlLine.match(/^(\w+):\s*(.*)$/);
        if (m) {
          let val = m[2].trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          current.meta[m[1]] = val;
        }
      }
      yamlBuf = [];
      continue;
    }
    if (inYaml) { yamlBuf.push(raw); continue; }
    current.prose.push(raw);
  }
  if (current) finalize();

  function finalize() {
    if (current.section === 'non-goals') nonGoals.push(current);
    else entries.push(current);
    current = null;
  }
  return { entries, nonGoals, nonGoalsPreamble: nonGoalsPreambleLines.join('\n').trim() };
}

export function loadRegistry() {
  const result = { targets: new Map(), nonGoals: [], entries: [], sources: [], errors: [], nonGoalsPreamble: '' };
  const nonGoalTargets = new Map();
  result.nonGoals.has = (id) => nonGoalTargets.has(id);
  const preambles = [];

  for (const file of walkFiles(REGISTRY_DIR, (f) => f.endsWith('.md'))) {
    const { entries, nonGoals, nonGoalsPreamble } = parseRegistryFile(file);
    result.sources.push(path.relative(REPO_ROOT, file));
    if (nonGoalsPreamble) preambles.push(nonGoalsPreamble);
    for (const e of entries) {
      if (result.targets.has(e.id)) {
        result.errors.push({ file, line: e.line, message: `Duplicate registry ID ${e.id}` });
        continue;
      }
      result.targets.set(e.id, e);
      result.entries.push(e);
    }
    for (const e of nonGoals) {
      // A Non-Goal ID must not shadow a targeted section: the citation lint
      // consults `nonGoals.has(id)` to reject `@conformance` against Non-Goals,
      // so an overlap would make a legitimate target's annotation fail.
      if (result.targets.has(e.id)) {
        result.errors.push({ file, line: e.line, message: `Non-Goal ID ${e.id} collides with a targeted registry entry` });
        continue;
      }
      nonGoalTargets.set(e.id, e);
      result.nonGoals.push(e);
    }
  }
  result.nonGoalsPreamble = preambles.join('\n\n');
  return result;
}
