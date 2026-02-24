#!/usr/bin/env node
import { runCompareCli } from './dist/cli/compare-two.js';

runCompareCli(process.argv.slice(2))
  .then((result) => {
    if ('help' in result && result.help) {
      console.log(result.text);
      return;
    }
    console.log(JSON.stringify(result));
  })
  .catch((err) => {
    console.error(err?.message ?? String(err));
    process.exit(1);
  });
