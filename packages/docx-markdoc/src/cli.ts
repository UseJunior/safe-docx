#!/usr/bin/env node
import { runCli } from './cli-run.js';

// The command logic lives in cli-run.ts so tests can run it in-process; this
// file only connects it to the process. It has no entry guard on purpose: a
// guard comparing import.meta.url with argv[1] fails through the
// node_modules/.bin symlink, and nothing imports this file.
runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  // runCli prints its own failures; this is only reached by a defect in it.
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
