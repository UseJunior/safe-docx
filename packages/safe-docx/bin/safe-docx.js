#!/usr/bin/env node
import { runCli } from '@usejunior/docx-mcp';

runCli(process.argv).catch((err) => {
  // A CliCommandFailure has already written its structured error to stderr;
  // print only the summary line, never a stack trace.
  const summaryOnly = err instanceof Error && err.name === 'CliCommandFailure';
  // eslint-disable-next-line no-console
  console.error(summaryOnly ? err.message : err);
  process.exit(1);
});
