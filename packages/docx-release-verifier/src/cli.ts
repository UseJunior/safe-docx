#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRelease } from './verifier.js';
import type { ReleaseManifest } from './types.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = option('--manifest');
const reportPath = option('--report');
if (!manifestPath) {
  process.stderr.write('Usage: docx-release-verify --manifest manifest.json [--report certificate.json]\n');
  process.exitCode = 3;
} else {
  try {
    const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as ReleaseManifest;
    const certificate = await verifyRelease(manifest);
    const json = `${JSON.stringify(certificate, null, 2)}\n`;
    if (reportPath) await writeFile(resolve(reportPath), json);
    else process.stdout.write(json);
    process.exitCode = certificate.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
}
