import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordOracleJob, normalizeCompareOptions, sha256 } from './protocol.mjs';

const zipLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const host = { host: 'Word', platform: 'Mac', version: '16.99', wordApiDesktop12: true };
const original = { sha256: 'a'.repeat(64), bytes: 7, stagedFileName: 'job-original.docx' };

test('normalizes only supported comparison options', () => {
  assert.deepEqual(normalizeCompareOptions({ compareFormatting: false, authorName: 'Oracle' }), {
    compareTarget: 'Current', compareFormatting: false, authorName: 'Oracle',
  });
  assert.throws(() => normalizeCompareOptions({ compareFormatting: 'yes' }), error => error.code === 'INVALID_OPTIONS');
});

test('one job enforces authentication, ordering, and terminal state', () => {
  const job = new WordOracleJob({ revisedBytes: zipLike, original, options: {} });
  assert.throws(() => job.authorize('wrong'), error => error.code === 'UNAUTHORIZED');
  job.authorize(job.token);
  const claim = job.claim({ jobId: job.jobId, host });
  assert.equal(Buffer.from(claim.revisedBase64, 'base64').compare(zipLike), 0);
  assert.throws(() => job.claim({ jobId: job.jobId, host }), error => error.code === 'INVALID_STATE');
  assert.throws(
    () => job.uploadSlice({ jobId: job.jobId, index: 1, total: 2, data: zipLike.toString('base64') }),
    error => error.code === 'OUT_OF_ORDER_SLICE',
  );
  job.uploadSlice({ jobId: job.jobId, index: 0, total: 1, data: zipLike.toString('base64') });
  assert.deepEqual(job.complete({ jobId: job.jobId }), zipLike);
  assert.equal(job.status, 'succeeded');
  assert.throws(() => job.authorize(job.token), error => error.code === 'JOB_TERMINAL');
});

test('rejects oversized revised and result payloads', () => {
  assert.throws(() => new WordOracleJob({ revisedBytes: Buffer.alloc(9), original, options: {}, maxDocxBytes: 8 }), error => error.code === 'PAYLOAD_TOO_LARGE');
  const job = new WordOracleJob({ revisedBytes: zipLike, original, options: {}, maxDocxBytes: 8 });
  job.claim({ jobId: job.jobId, host });
  assert.throws(
    () => job.uploadSlice({ jobId: job.jobId, index: 0, total: 1, data: Buffer.alloc(9).toString('base64') }),
    error => error.code === 'PAYLOAD_TOO_LARGE',
  );
});

test('hashes bytes deterministically', () => {
  assert.equal(sha256(Buffer.from('safe-docx')), '494be122cb9e7e454b0ba2ed2b710d22304353b527410a735b06bd8ffc2e5437');
});

test('expiration is terminal and carries an attributable timeout diagnostic', () => {
  const job = new WordOracleJob({ revisedBytes: zipLike, original, options: {} });
  job.expire();
  assert.equal(job.status, 'expired');
  assert.deepEqual(job.failure, {
    code: 'TIMEOUT', message: 'Word did not complete the comparison before the configured timeout',
  });
});
