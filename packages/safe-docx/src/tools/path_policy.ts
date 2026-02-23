import fs from 'node:fs/promises';
import { errorCode, errorMessage } from "../error_utils.js";
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

async function canonicalizePath(inputPath: string): Promise<string> {
  const normalized = normalizePath(inputPath);
  try {
    return await fs.realpath(normalized);
  } catch {
    return normalized;
  }
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
    : [process.env.HOME ?? '', os.tmpdir()].filter((entry) => entry.length > 0);

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
  return err(
    'PATH_NOT_ALLOWED',
    `Refusing to ${type} path outside allowed roots: ${inputPath} -> ${resolvedPath}`,
    `Allowed roots: ${allowedRoots.join(', ')}. Configure SAFE_DOCX_ALLOWED_ROOTS if needed.`,
  );
}

async function resolveWritePathWithExistingAncestor(normalizedPath: string): Promise<string> {
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
    resolvedPath = await resolveWritePathWithExistingAncestor(normalizedPath);
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
