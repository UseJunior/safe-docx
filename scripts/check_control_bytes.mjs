#!/usr/bin/env node
// Source-hygiene guard: no raw control bytes in tracked JS/TS source (#427).
//
// A raw control byte (anything below 0x20 other than tab/LF/CR) in a source
// file makes grep-family tools classify the whole file as binary and return
// EMPTY results with no warning — BSD grep and ripgrep both do this. In an
// agent-operated repo that failure mode is dangerous: a search that silently
// returns nothing reads as "symbol unused / pattern absent", which is the
// precondition for duplicated helpers or unsafe deletions. The byte itself is
// invisible in editors, so review never catches it (#377 shipped one).
//
// Legitimate uses of control characters in code (e.g. a NUL fingerprint
// separator) belong in escape form — '\u0000' produces the identical runtime
// string and keeps the file text.
//
// Pure text inspection — no network, no build. Wired into the workspace-lint
// required check. Exits non-zero with an actionable message.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
]);

const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: REPO_ROOT,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString('utf8')
  .split('\0')
  .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));

const findings = [];

for (const file of trackedFiles) {
  const absPath = path.join(REPO_ROOT, file);
  let bytes;
  try {
    bytes = fs.readFileSync(absPath);
  } catch {
    continue; // tracked but deleted in working tree
  }
  let line = 1;
  let col = 1;
  for (const byte of bytes) {
    if (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) {
      findings.push({ file, line, col, byte });
    }
    if (byte === 0x0a) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
}

if (findings.length > 0) {
  console.error('Raw control bytes found in tracked source files:\n');
  for (const { file, line, col, byte } of findings) {
    const hex = `0x${byte.toString(16).padStart(2, '0')}`;
    const escape = `\\u${byte.toString(16).padStart(4, '0')}`;
    console.error(`  ${file}:${line}:${col} — byte ${hex}; if intentional, write it as the '${escape}' escape instead`);
  }
  console.error(
    `\n${findings.length} raw control byte(s). These make grep/ripgrep treat the file as binary` +
      ' and silently return no matches — see #427.'
  );
  process.exit(1);
}

console.log(`check:control-bytes OK — ${trackedFiles.length} source files scanned, no raw control bytes.`);
