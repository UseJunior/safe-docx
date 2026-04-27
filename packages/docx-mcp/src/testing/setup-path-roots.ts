import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// From packages/docx-mcp/src/testing → up 4 segments to the workspace root.
// (The previous "..", "..", ".." landed on `packages/`, which made
// `path.join(repoRoot, 'packages', 'docx-core')` resolve to the bogus
// `packages/packages/docx-core` and meant fixtures under the workspace
// root were not added to the allowlist.)
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

const cwd = process.cwd();
const tmpDir = os.tmpdir();
const home = process.env.HOME ?? '';

const existing = (process.env.SAFE_DOCX_ALLOWED_ROOTS ?? '')
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

// Realpath every candidate so symlinked roots (e.g. `/tmp` → `/private/tmp`
// on macOS) match what `enforceReadPathPolicy` resolves at request time.
// Without this, a worktree under `/tmp/foo` would add `/tmp/foo` to the
// allowlist while the policy resolved fixture paths to `/private/tmp/foo`
// and rejected them as PATH_NOT_ALLOWED.
function canonicalize(entry: string): string[] {
  if (!entry) return [];
  const resolved = path.resolve(entry);
  const out = new Set<string>();
  out.add(resolved);
  try {
    out.add(fs.realpathSync(resolved));
  } catch {
    // Path may not exist yet (e.g. a temp dir we'll create later); the
    // resolved form is still useful.
  }
  return Array.from(out);
}

const candidates = [
  ...existing,
  home,
  tmpDir,
  cwd,
  workspaceRoot,
  path.join(workspaceRoot, 'packages', 'docx-core'),
];

const merged = Array.from(
  new Set(candidates.flatMap(canonicalize)),
);

process.env.SAFE_DOCX_ALLOWED_ROOTS = merged.join(path.delimiter);
