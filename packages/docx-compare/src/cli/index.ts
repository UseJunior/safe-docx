#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runCompareCli } from './compare-two.js';

export async function runCli(argv = process.argv): Promise<void> {
  const result = await runCompareCli(argv.slice(2));
  if ('help' in result && result.help) {
    // eslint-disable-next-line no-console
    console.log(result.text);
    return;
  }

  // Warnings go to stderr so stdout stays a single JSON line for callers that
  // parse it, while a human running the CLI still sees them (#1029).
  for (const warning of result.warnings ?? []) {
    // eslint-disable-next-line no-console
    console.error(warning);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

// npm installs bins as node_modules/.bin symlinks, so argv[1] must be
// realpath-resolved before comparing against import.meta.url (which node
// always resolves to the real dist file). See #398.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  runCli(process.argv).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err?.message ?? String(err));
    process.exit(1);
  });
}
