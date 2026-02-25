#!/usr/bin/env node
import { runCli } from '@usejunior/docx-mcp';

runCli(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
