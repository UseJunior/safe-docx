import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyRenderedMarkup } from './render.js';
import type { PrivateCorpusManifest, PrivateCorpusSummary, RendererTools } from './types.js';

const execFileAsync = promisify(execFile);

let worktreeRoot: Promise<string | null> | undefined;

async function safeDocxWorktree(): Promise<string | null> {
  worktreeRoot ??= execFileAsync('git', ['rev-parse', '--show-toplevel'])
    .then((result) => path.resolve(String(result.stdout).trim()))
    .catch(() => null);
  return worktreeRoot;
}

async function isInsideSafeDocxWorktree(file: string): Promise<boolean> {
  const root = await safeDocxWorktree();
  const resolved = path.resolve(file);
  return root !== null && (resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

async function ignoredByGit(file: string): Promise<boolean> {
  // A manifest stored outside this worktree cannot be committed to this
  // repository. This supports a fully local corpus while retaining the stricter
  // ignored-path requirement for manifests and outputs inside Safe DOCX.
  if (!(await isInsideSafeDocxWorktree(file))) return true;
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', file]);
    return true;
  } catch { return false; }
}

async function trackedByGit(file: string): Promise<boolean> {
  if (!(await isInsideSafeDocxWorktree(file))) return false;
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', file]);
    return true;
  } catch { return false; }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function runPrivateCorpus(manifestPath: string, tools?: RendererTools): Promise<PrivateCorpusSummary> {
  const resolvedManifest = path.resolve(manifestPath);
  if (!(await ignoredByGit(resolvedManifest))) throw new Error('Private corpus manifest must be a gitignored local path.');
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8')) as PrivateCorpusManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.cases)) throw new Error('Private corpus manifest must use version 1 with cases.');
  const outputDir = path.resolve(path.dirname(resolvedManifest), manifest.outputDir);
  if (!(await ignoredByGit(outputDir))) throw new Error('Private corpus output directory must be gitignored.');
  if (path.resolve(outputDir).includes(`${path.sep}fixtures${path.sep}`)) throw new Error('Private corpus outputs may not be written beneath tracked fixtures.');
  await mkdir(outputDir, { recursive: true });
  const cases: PrivateCorpusSummary['cases'] = [];
  for (const entry of manifest.cases) {
    const trackedDocxPath = path.resolve(path.dirname(resolvedManifest), entry.trackedDocxPath);
    const expectedMarkupTextPath = path.resolve(path.dirname(resolvedManifest), entry.expectedMarkupTextPath);
    if (await trackedByGit(trackedDocxPath) || await trackedByGit(expectedMarkupTextPath)) {
      throw new Error('Private corpus inputs must not be Git-tracked artifacts.');
    }
    const tracked = await readFile(trackedDocxPath);
    const trackedSha256 = sha256(tracked);
    if (trackedSha256 !== entry.expectedTrackedSha256) {
      cases.push({ label: entry.label, trackedSha256, status: 'fail', reason: 'tracked SHA-256 mismatch' });
      continue;
    }
    if (!entry.requireRender) {
      cases.push({ label: entry.label, trackedSha256, status: 'not_run', reason: 'renderer not required for this case' });
      continue;
    }
    const expectedMarkupText = await readFile(expectedMarkupTextPath, 'utf8');
    const result = await verifyRenderedMarkup({ trackedDocxPath, expectedMarkupText, outputDir: path.join(outputDir, sha256(Buffer.from(entry.label)).slice(0, 16)), tools });
    // Tool output can contain local paths or document text. Persist only this
    // bounded category so a corpus summary remains safely non-substantive.
    cases.push({ label: entry.label, trackedSha256, status: result.status, reason: result.status === 'not_run' ? 'renderer unavailable' : result.status === 'fail' ? 'renderer check failed' : undefined });
  }
  const summary: PrivateCorpusSummary = { version: 1, cases };
  // The summary intentionally contains labels, hashes, statuses, and bounded
  // tool reasons only. It never includes source, PDF, or DOCX substantive text.
  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
