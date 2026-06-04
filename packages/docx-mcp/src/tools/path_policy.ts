import fs from 'node:fs/promises';
import { errorMessage } from "../error_utils.js";
import os from 'node:os';
import path from 'node:path';
import { err, type ToolResponse } from './types.js';

export type PathPolicyOutcome =
  | {
      ok: true;
      normalizedPath: string;
      resolvedPath: string;
      allowedRoots: string[];
    }
  | {
      ok: false;
      response: ToolResponse;
    };

function expandPath(inputPath: string): string {
  return inputPath.startsWith('~') ? path.join(process.env.HOME || '', inputPath.slice(1)) : inputPath;
}

function normalizePath(inputPath: string): string {
  return path.resolve(expandPath(inputPath));
}

export async function canonicalizePath(inputPath: string): Promise<string> {
  const normalized = normalizePath(inputPath);
  try {
    return await fs.realpath(normalized);
  } catch {
    return normalized;
  }
}

/**
 * True when two paths resolve to the same filesystem location. Canonicalizes both via realpath (with a
 * lexical fallback for paths that do not exist yet) so a symlink can't disguise a clobber of an input
 * document behind a different-looking output path. Shared source-clobber guard for the write tools
 * (issue #313); folded out of the export-local guard so all write tools enforce it identically.
 */
export async function resolvesToSamePath(a: string, b: string): Promise<boolean> {
  return (await canonicalizePath(a)) === (await canonicalizePath(b));
}

// On Linux `/private/tmp` does not exist by default. If we listed it as a root,
// `canonicalizePath`'s realpath-fallback would leave it as a ghost entry whose
// subpaths `resolveWritePathWithExistingAncestor` would still match (walking up
// to `/` as the existing ancestor), silently allowing writes the user never
// opted into. Restrict `/private/tmp` to darwin where it is the canonical form
// of `/tmp`. Windows already covers `%TEMP%/%TMP%` via `os.tmpdir()`.
export function getPlatformTempDefaults(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return ['/tmp', '/private/tmp'];
  if (platform === 'win32') return [];
  return ['/tmp'];
}

async function resolveAllowedRoots(): Promise<string[]> {
  const configured = process.env.SAFE_DOCX_ALLOWED_ROOTS;
  const fromEnv = configured
    ? configured
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : [];
  const defaults = fromEnv.length > 0
    ? fromEnv
    : [process.env.HOME ?? '', os.tmpdir(), ...getPlatformTempDefaults()].filter((entry) => entry.length > 0);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawRoot of defaults) {
    const canonical = await canonicalizePath(rawRoot);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function policyError(
  type: 'read' | 'write',
  inputPath: string,
  resolvedPath: string,
  allowedRoots: string[],
): ToolResponse {
  const suggestedRoot = path.dirname(resolvedPath);
  const exampleEnv = process.env.SAFE_DOCX_ALLOWED_ROOTS
    ? `SAFE_DOCX_ALLOWED_ROOTS="$SAFE_DOCX_ALLOWED_ROOTS${path.delimiter}${suggestedRoot}"`
    : `SAFE_DOCX_ALLOWED_ROOTS="${suggestedRoot}"`;
  return err(
    'PATH_NOT_ALLOWED',
    `Refusing to ${type} path outside allowed roots: ${inputPath} -> ${resolvedPath}`,
    [
      `Allowed roots: ${allowedRoots.join(', ')}.`,
      `To allow this path, restart the MCP server with ${exampleEnv}.`,
    ].join(' '),
  );
}

// Canonicalize a *write* target. Unlike a read, the final component may not exist yet, so we cannot
// simply `realpath` the whole path. The crux of the symlink-escape fix (issue #313) is that we must
// still resolve the final component when it *does* exist — including a dangling symlink — so the policy
// check judges where `fs.writeFile` will actually write, not where the link happens to live.
async function resolveWritePathCanonical(normalizedPath: string, seen = new Set<string>()): Promise<string> {
  // 1. Final component exists (regular file, directory, or symlink to an existing target): realpath
  //    resolves it fully — symmetric with enforceReadPathPolicy.
  try {
    return await fs.realpath(normalizedPath);
  } catch {
    // Fall through: the final component does not currently resolve.
  }

  // 2. Dangling final component that is itself a symlink. `realpath` throws here, but `fs.writeFile`
  //    would happily follow the broken link and create its target. Follow it ourselves so the policy
  //    check lands on the real write destination rather than the link's (in-root) location.
  let linkStat: import('node:fs').Stats | null = null;
  try {
    linkStat = await fs.lstat(normalizedPath);
  } catch {
    // Genuinely missing (not even a link): fall through to ancestor resolution.
  }
  if (linkStat?.isSymbolicLink()) {
    if (seen.has(normalizedPath)) {
      throw new Error(`Symlink cycle detected resolving: ${normalizedPath}`);
    }
    seen.add(normalizedPath);
    const target = path.resolve(path.dirname(normalizedPath), await fs.readlink(normalizedPath));
    return resolveWritePathCanonical(target, seen);
  }

  // 3. Genuinely-missing new file: resolve against the first existing ancestor (this also follows a
  //    symlinked parent directory via `realpath`). Preserves writing new files into existing dirs.
  let probe = path.dirname(normalizedPath);
  while (true) {
    try {
      const realAncestor = await fs.realpath(probe);
      const tail = path.relative(probe, normalizedPath);
      return path.join(realAncestor, tail);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error(`No existing ancestor found for path: ${normalizedPath}`);
      }
      probe = parent;
    }
  }
}

export async function enforceReadPathPolicy(inputPath: string): Promise<PathPolicyOutcome> {
  const normalizedPath = normalizePath(inputPath);
  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(normalizedPath);
  } catch (e: unknown) {
    return {
      ok: false,
      response: err('PATH_RESOLUTION_ERROR', `Failed to resolve path: ${errorMessage(e)}`),
    };
  }

  const allowedRoots = await resolveAllowedRoots();
  if (!allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return {
      ok: false,
      response: policyError('read', inputPath, resolvedPath, allowedRoots),
    };
  }
  return { ok: true, normalizedPath, resolvedPath, allowedRoots };
}

export async function enforceWritePathPolicy(inputPath: string): Promise<PathPolicyOutcome> {
  const normalizedPath = normalizePath(inputPath);
  let resolvedPath: string;
  try {
    resolvedPath = await resolveWritePathCanonical(normalizedPath);
  } catch (e: unknown) {
    return {
      ok: false,
      response: err('PATH_RESOLUTION_ERROR', `Failed to resolve output path: ${errorMessage(e)}`),
    };
  }

  const allowedRoots = await resolveAllowedRoots();
  if (!allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return {
      ok: false,
      response: policyError('write', inputPath, resolvedPath, allowedRoots),
    };
  }
  return { ok: true, normalizedPath, resolvedPath, allowedRoots };
}
