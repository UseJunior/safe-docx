#!/usr/bin/env node
import { runCli } from './cli/index.js';

runCli(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
