import path from 'node:path';
import { runPagesOpenabilityProbe } from '../src/debug/pagesProbe.js';

interface CliOptions {
  filePath: string;
  settleSec: number;
  launchWaitSec: number;
  crashReportGraceSec: number;
  closeBefore: boolean;
  quitAfter: boolean;
  jsonOnly: boolean;
}

function parsePositiveNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Expected positive number for ${flag}, got '${value}'`);
  }
  return n;
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = '';
  let settleSec = 12;
  let launchWaitSec = 8;
  let crashReportGraceSec = 5;
  let closeBefore = false;
  let quitAfter = false;
  let jsonOnly = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--file' && next) {
      filePath = path.resolve(next);
      i++;
      continue;
    }
    if (arg === '--settle-sec' && next) {
      settleSec = parsePositiveNumber(next, '--settle-sec');
      i++;
      continue;
    }
    if (arg === '--launch-wait-sec' && next) {
      launchWaitSec = parsePositiveNumber(next, '--launch-wait-sec');
      i++;
      continue;
    }
    if (arg === '--crash-report-grace-sec' && next) {
      crashReportGraceSec = parsePositiveNumber(next, '--crash-report-grace-sec');
      i++;
      continue;
    }
    if (arg === '--close-before') {
      closeBefore = true;
      continue;
    }
    if (arg === '--quit-after') {
      quitAfter = true;
      continue;
    }
    if (arg === '--json-only') {
      jsonOnly = true;
      continue;
    }
  }

  if (!filePath) {
    throw new Error([
      'Usage: npx tsx packages/docx-core/scripts/probe_pages_openability.ts --file <docx> [options]',
      'Options:',
      '  --settle-sec <n>       Seconds to observe Pages after launch (default: 12)',
      '  --launch-wait-sec <n>  Seconds to wait for Pages process to appear (default: 8)',
      '  --crash-report-grace-sec <n> Seconds to keep checking crash reports after early exit (default: 5)',
      '  --close-before         Quit Pages before probing for deterministic result',
      '  --quit-after           Quit Pages after probe',
      '  --json-only            Emit only JSON output',
    ].join('\n'));
  }

  return {
    filePath,
    settleSec,
    launchWaitSec,
    crashReportGraceSec,
    closeBefore,
    quitAfter,
    jsonOnly,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  const result = await runPagesOpenabilityProbe(options.filePath, {
    settleMs: Math.round(options.settleSec * 1000),
    launchWaitMs: Math.round(options.launchWaitSec * 1000),
    crashReportGraceMs: Math.round(options.crashReportGraceSec * 1000),
    closeBefore: options.closeBefore,
    quitAfter: options.quitAfter,
  });

  if (!options.jsonOnly) {
    console.log(`Pages probe status: ${result.status}`);
    console.log(`File: ${result.filePath}`);
    console.log(`Duration: ${result.durationMs}ms`);
    if (result.newCrashReports.length > 0) {
      console.log('Crash reports:');
      for (const report of result.newCrashReports) {
        console.log(`- ${report}`);
      }
    }
    if (result.notes.length > 0) {
      console.log('Notes:');
      for (const note of result.notes) {
        console.log(`- ${note}`);
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'crashed' || result.status === 'launch_failed') {
    process.exitCode = 2;
  } else if (result.status === 'exited_early' || result.status === 'indeterminate_pages_already_running') {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
