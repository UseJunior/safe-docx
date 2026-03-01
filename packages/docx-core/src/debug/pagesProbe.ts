import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type PagesProbeStatus =
  | 'opened_ok'
  | 'crashed'
  | 'exited_early'
  | 'launch_failed'
  | 'indeterminate_pages_already_running'
  | 'file_not_found'
  | 'not_supported';

export interface PagesProbeOptions {
  settleMs?: number;
  launchWaitMs?: number;
  pollMs?: number;
  crashReportGraceMs?: number;
  closeBefore?: boolean;
  quitAfter?: boolean;
  crashReportsDir?: string;
}

export interface PagesProbeResult {
  filePath: string;
  status: PagesProbeStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pagesWasRunningAtStart: boolean;
  pagesRunningAfter: boolean;
  newCrashReports: string[];
  notes: string[];
  error?: string;
}

const DEFAULT_SETTLE_MS = 12_000;
const DEFAULT_LAUNCH_WAIT_MS = 8_000;
const DEFAULT_POLL_MS = 300;
const DEFAULT_CRASH_REPORT_GRACE_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPagesRunning(): Promise<boolean> {
  try {
    await execFile('pgrep', ['-x', 'Pages']);
    return true;
  } catch {
    return false;
  }
}

async function quitPages(): Promise<void> {
  try {
    await execFile('osascript', ['-e', 'tell application "Pages" to quit']);
  } catch {
    // Ignore if Pages is not running or AppleScript unavailable.
  }
}

async function waitForPagesStopped(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPagesRunning())) {
      return true;
    }
    await sleep(DEFAULT_POLL_MS);
  }
  return !(await isPagesRunning());
}

async function waitForPagesStarted(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPagesRunning()) {
      return true;
    }
    await sleep(DEFAULT_POLL_MS);
  }
  return await isPagesRunning();
}

/**
 * List Pages crash reports in the diagnostic reports directory.
 *
 * Matches filenames starting with `pages_`, `pages.`, or `pages-` (case-insensitive)
 * to cover macOS naming variations across versions:
 * - macOS 14 and earlier: `Pages_YYYY-MM-DD-HHMMSS_machinename.ips`
 * - macOS 15+: `Pages-YYYY-MM-DD-HHMMSS.ips`
 */
async function listPagesCrashReports(crashReportsDir?: string): Promise<Map<string, number>> {
  const dir = crashReportsDir ?? path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
  const reportMap = new Map<string, number>();

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return reportMap;
  }

  for (const name of entries) {
    const lower = name.toLowerCase();
    if (!lower.startsWith('pages_') && !lower.startsWith('pages.') && !lower.startsWith('pages-')) {
      continue;
    }
    if (!lower.endsWith('.ips') && !lower.endsWith('.crash')) {
      continue;
    }

    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      reportMap.set(fullPath, stat.mtimeMs);
    } catch {
      // Ignore disappearing files.
    }
  }

  return reportMap;
}

function collectNewCrashReports(
  baseline: Map<string, number>,
  current: Map<string, number>,
  startedAtMs: number,
): string[] {
  const threshold = startedAtMs - 1_000;
  const newReports: string[] = [];

  for (const [filePath, mtimeMs] of current.entries()) {
    const baselineMtime = baseline.get(filePath);
    if (baselineMtime == null) {
      if (mtimeMs >= threshold) {
        newReports.push(filePath);
      }
      continue;
    }

    if (mtimeMs > baselineMtime && mtimeMs >= threshold) {
      newReports.push(filePath);
    }
  }

  newReports.sort((a, b) => a.localeCompare(b));
  return newReports;
}

export async function runPagesOpenabilityProbe(
  filePath: string,
  options: PagesProbeOptions = {},
): Promise<PagesProbeResult> {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const launchWaitMs = options.launchWaitMs ?? DEFAULT_LAUNCH_WAIT_MS;
  const crashReportGraceMs = options.crashReportGraceMs ?? DEFAULT_CRASH_REPORT_GRACE_MS;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const notes: string[] = [];

  if (process.platform !== 'darwin') {
    return {
      filePath,
      status: 'not_supported',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pagesWasRunningAtStart: false,
      pagesRunningAfter: false,
      newCrashReports: [],
      notes: ['Pages probing is only supported on macOS.'],
    };
  }

  try {
    await fs.access(filePath);
  } catch {
    return {
      filePath,
      status: 'file_not_found',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pagesWasRunningAtStart: false,
      pagesRunningAfter: false,
      newCrashReports: [],
      notes: ['Target file does not exist or is not readable.'],
    };
  }

  const pagesWasRunningAtStart = await isPagesRunning();
  if (pagesWasRunningAtStart && !options.closeBefore) {
    return {
      filePath,
      status: 'indeterminate_pages_already_running',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pagesWasRunningAtStart,
      pagesRunningAfter: true,
      newCrashReports: [],
      notes: ['Pages is already running; rerun with closeBefore=true for deterministic crash probing.'],
    };
  }

  if (options.closeBefore) {
    await quitPages();
    const stopped = await waitForPagesStopped(4_000);
    if (!stopped) {
      notes.push('Pages did not stop cleanly before probe.');
    }
  }

  const baselineReports = await listPagesCrashReports(options.crashReportsDir);

  try {
    await execFile('open', ['-a', 'Pages', filePath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      filePath,
      status: 'launch_failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pagesWasRunningAtStart,
      pagesRunningAfter: await isPagesRunning(),
      newCrashReports: [],
      notes,
      error: message,
    };
  }

  const started = await waitForPagesStarted(launchWaitMs);
  if (!started) {
    const currentReports = await listPagesCrashReports(options.crashReportsDir);
    const newReports = collectNewCrashReports(baselineReports, currentReports, startedAtMs);
    const status: PagesProbeStatus = newReports.length > 0 ? 'crashed' : 'launch_failed';

    return {
      filePath,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      pagesWasRunningAtStart,
      pagesRunningAfter: false,
      newCrashReports: newReports,
      notes,
      error: started ? undefined : 'Pages process did not appear after launch.',
    };
  }

  const settleStart = Date.now();
  let pagesRunningAfter = true;
  while (Date.now() - settleStart < settleMs) {
    pagesRunningAfter = await isPagesRunning();
    if (!pagesRunningAfter) {
      break;
    }
    await sleep(options.pollMs ?? DEFAULT_POLL_MS);
  }

  const currentReports = await listPagesCrashReports(options.crashReportsDir);
  let newCrashReports = collectNewCrashReports(baselineReports, currentReports, startedAtMs);

  if (!pagesRunningAfter && newCrashReports.length === 0 && crashReportGraceMs > 0) {
    const graceStart = Date.now();
    while (Date.now() - graceStart < crashReportGraceMs) {
      await sleep(options.pollMs ?? DEFAULT_POLL_MS);
      const refreshed = await listPagesCrashReports(options.crashReportsDir);
      newCrashReports = collectNewCrashReports(baselineReports, refreshed, startedAtMs);
      if (newCrashReports.length > 0) {
        notes.push('Crash report detected during post-exit grace window.');
        break;
      }
    }
  }

  let status: PagesProbeStatus;
  if (newCrashReports.length > 0) {
    status = 'crashed';
  } else if (!pagesRunningAfter) {
    status = 'exited_early';
    notes.push('Pages exited before settle window without a detected crash report.');
  } else {
    status = 'opened_ok';
  }

  if (options.quitAfter) {
    await quitPages();
    await waitForPagesStopped(4_000);
    pagesRunningAfter = await isPagesRunning();
  }

  return {
    filePath,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    pagesWasRunningAtStart,
    pagesRunningAfter,
    newCrashReports,
    notes,
  };
}
