import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash as nodeHash } from 'node:crypto';
import { expect } from 'vitest';
import { testAllure } from '../src/testing/allure-test.js';
import { hash, createHash } from '../src/runtime/hash.js';

const TEST_FEATURE = 'add-portable-docx-runtime';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

test.openspec('Browser execution without polyfills')('runs core edits and compare with the complete browser import graph', () => {
  const stdout = execFileSync(process.execPath, ['scripts/check_browser_runtime.mjs'], {
    cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8', timeout: 30_000,
  });
  expect(stdout).toContain('PASS: browser bundle excludes Node built-ins');
});

test.openspec('Stable digest identity')('preserves Unicode and byte-view digests for both identity algorithms', () => {
  for (const algorithm of ['sha256', 'sha1'] as const) {
    const mutable = new Uint8Array([1, 2]);
    const digest = createHash(algorithm).update(mutable);
    mutable[0] = 3;
    expect(digest.digest('hex')).toBe(nodeHash(algorithm).update(new Uint8Array([1, 2])).digest('hex'));
    expect(hash(['a', mutable], algorithm)).toBe(nodeHash(algorithm).update('a').update(mutable).digest('hex'));
    for (const value of ['ﬁngerprint 😀\0', new Uint8Array([1, 2, 255, 0]).subarray(1)]) {
      expect(hash(value, algorithm)).toBe(nodeHash(algorithm).update(value).digest('hex'));
    }
  }
});
