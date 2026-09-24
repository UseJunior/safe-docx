#!/usr/bin/env node
import { runCli } from './cli/index.js';

runCli(process.argv).catch((err) => {
  // A CliCommandFailure has already written its structured error to stderr;
  // print only the summary line, never a stack trace.
  const summaryOnly = err instanceof Error && err.name === 'CliCommandFailure';
  // eslint-disable-next-line no-console
  console.error(summaryOnly ? err.message : err);
  // Set the exit code instead of calling process.exit(): on macOS, pipe-backed
  // stdio is asynchronous and an immediate exit can truncate the structured
  // error a caller is parsing from stderr.
  process.exitCode = 1;
});
