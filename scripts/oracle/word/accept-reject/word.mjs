// AppleScript driver for Microsoft Word 16 for Mac: Accept All / Reject All on one document.
//
// Files are staged inside Word's sandbox container, so Word opens and saves them without the
// "Grant File Access" prompt that otherwise stalls automation. Each call is bounded twice (an
// AppleScript `with timeout` and a child-process timeout); a timed-out call kills only the
// osascript process it spawned. Word itself is never quit, and only documents under this run's
// directory are ever closed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY_SCRIPT = path.join(HERE, 'applescript', 'apply.applescript');
const CLOSE_SCRIPT = path.join(HERE, 'applescript', 'close-run.applescript');
const PROBE_SCRIPT = path.join(HERE, 'applescript', 'probe.applescript');
/** Bump when the AppleScript changes in a way that could change Word's output (invalidates the cache). */
export const SCRIPT_VERSION = 'apply-v1';
export const WORD_APP = '/Applications/Microsoft Word.app';

/** Run osascript with a hard child-process timeout. Never throws. */
export function runOsascript(args, timeoutSeconds) {
  return new Promise((resolve) => {
    const child = spawn('osascript', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSeconds * 1000);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut }); });
  });
}

/** Word's version from its Info.plist (no Apple Event), or null when Word is not installed. */
export function wordVersion(app = WORD_APP) {
  const plist = path.join(app, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return null;
  const out = spawnSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : 'unknown';
}

/**
 * Probe whether this process may automate Word. Returns null when it may, else the osascript
 * result for `classifyOsascriptFailure`.
 */
export async function probeWordAutomation(timeoutSeconds = 90) {
  const result = await runOsascript([PROBE_SCRIPT], timeoutSeconds);
  return result.code === 0 ? null : { ...result, timeoutSeconds };
}

export async function closeRunDocuments(runDir) {
  const prefix = runDir.endsWith('/') ? runDir : `${runDir}/`;
  return runOsascript([CLOSE_SCRIPT, prefix], 45);
}

/**
 * A `WordDriver` (see word-accept-reject-oracle.ts) backed by AppleScript and an on-disk cache.
 * @param {object} o
 * @param {string} o.runDir      staging directory for this run, inside Word's container
 * @param {string} o.cacheDir    cache of Word outputs, inside Word's container
 * @param {string} o.version     Word version (part of the cache key)
 * @param {boolean} o.refresh    ignore cached outputs
 * @param {number} o.timeoutSeconds per-call bound
 * @param {object} o.oracle      the docx-core oracle module (classifyOsascriptFailure, WordAutomationError, packageContentHash, projectDocx)
 * @param {(line: string) => void} [o.log]
 * @param {typeof runOsascript} [o.osascript] injectable for tests
 * @param {number} [o.retryDelayMs]
 */
export function createWordDriver({ runDir, cacheDir, version, refresh, timeoutSeconds, oracle, log = () => {}, osascript = runOsascript, retryDelayMs = 3000 }) {
  let seq = 0;
  return async ({ caseId, mode, input }) => {
    const contentHash = await oracle.packageContentHash(input);
    const key = createHash('sha256').update(`${contentHash}|${mode}|${version}|${SCRIPT_VERSION}`).digest('hex');
    const cached = path.join(cacheDir, `${key}.docx`);
    if (!refresh && existsSync(cached)) {
      const output = await readFile(cached);
      // A cached output must be fully resolved; anything else (e.g. written by an older runner) is
      // discarded and Word runs again.
      if ((await oracle.projectDocx(output).catch(() => null))?.revisionsRemaining === 0) return { output, cached: true, seconds: 0 };
      log(`  ${caseId} ${mode}: discarding an unusable cached Word output`);
      await rm(cached, { force: true });
    }

    const started = Date.now();
    let lastFailure;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      seq += 1;
      const stem = `${String(seq).padStart(3, '0')}-${caseId}-${mode}${attempt > 1 ? `-try${attempt}` : ''}`;
      const inPath = path.join(runDir, `${stem}-in.docx`);
      const outPath = path.join(runDir, `${stem}-word.docx`);
      await writeFile(inPath, input);
      const result = await osascript([APPLY_SCRIPT, inPath, mode, outPath, String(timeoutSeconds)], timeoutSeconds + 15);
      if (result.code === 0 && result.stdout === 'OK' && existsSync(outPath)) {
        const output = await readFile(outPath);
        // Never cache an output that still carries revisions: the oracle reports it as UNRESOLVED.
        if ((await oracle.projectDocx(output)).revisionsRemaining === 0) {
          await mkdir(cacheDir, { recursive: true });
          const partial = `${cached}.partial-${process.pid}`;
          await copyFile(outPath, partial);
          await rename(partial, cached);
        }
        return { output, cached: false, seconds: (Date.now() - started) / 1000 };
      }
      lastFailure = oracle.classifyOsascriptFailure({ ...result, timeoutSeconds });
      if (lastFailure.kind === 'PERMISSION' || lastFailure.kind === 'UNAVAILABLE' || attempt === 2) break;
      log(`  ${caseId} ${mode}: ${lastFailure.kind} (${lastFailure.message}); closing this run's documents and retrying once`);
      await osascript([CLOSE_SCRIPT, `${runDir}/`], 45);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
    throw new oracle.WordAutomationError(lastFailure);
  };
}

export async function removeRunDir(runDir) {
  await rm(runDir, { recursive: true, force: true });
}
