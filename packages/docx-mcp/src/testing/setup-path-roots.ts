import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cwd = process.cwd();
const tmpDir = os.tmpdir();

const existing = (process.env.SAFE_DOCX_ALLOWED_ROOTS ?? '')
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

const merged = Array.from(
  new Set([
    ...existing,
    process.env.HOME ?? '',
    tmpDir,
    cwd,
    repoRoot,
    path.join(repoRoot, 'packages', 'docx-core'),
  ].filter((entry) => entry.length > 0)),
);

process.env.SAFE_DOCX_ALLOWED_ROOTS = merged.join(path.delimiter);
