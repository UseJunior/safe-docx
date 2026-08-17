import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const required = ['SAFE_DOCX_WORD_ORACLE_ORIGINAL', 'SAFE_DOCX_WORD_ORACLE_REVISED', 'SAFE_DOCX_WORD_ORACLE_OUTPUT', 'SAFE_DOCX_WORD_ORACLE_CERT', 'SAFE_DOCX_WORD_ORACLE_KEY'];
const missing = required.filter(name => !process.env[name]);

test('gated real-Word comparison produces a successful attributable artifact', { skip: missing.length ? `set ${missing.join(', ')}` : false, timeout: 600_000 }, async () => {
  const args = [
    'scripts/oracle/word/cli.mjs', '--original', process.env.SAFE_DOCX_WORD_ORACLE_ORIGINAL,
    '--revised', process.env.SAFE_DOCX_WORD_ORACLE_REVISED, '--output', process.env.SAFE_DOCX_WORD_ORACLE_OUTPUT,
    '--cert', process.env.SAFE_DOCX_WORD_ORACLE_CERT, '--key', process.env.SAFE_DOCX_WORD_ORACLE_KEY,
  ];
  await execFileAsync(process.execPath, args, { timeout: 590_000 });
  const manifest = JSON.parse(await readFile(`${process.env.SAFE_DOCX_WORD_ORACLE_OUTPUT}.word-oracle.json`, 'utf8'));
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.word.wordApiDesktop11, true);
  assert.match(manifest.output.sha256, /^[0-9a-f]{64}$/);
});
