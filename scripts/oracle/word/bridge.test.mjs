import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startBridge } from './bridge.mjs';
import { WordOracleJob } from './protocol.mjs';

test('HTTP bridge rejects missing credentials and accepts one authenticated job', async t => {
  const revised = Buffer.from([0x50, 0x4b, 0x03, 0x04, 8]);
  const output = Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]);
  const job = new WordOracleJob({ revisedBytes: revised, original: { sha256: 'a'.repeat(64), bytes: 5, stagedFileName: 'job-original.docx' }, options: {} });
  const bridge = await startBridge({ job, insecureForTests: true });
  t.after(() => bridge.close());

  const denied = await fetch(`${bridge.origin}/v1/job/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.jobId, host: {} }),
  });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error, 'UNAUTHORIZED');

  const headers = { authorization: `Bearer ${job.token}`, 'content-type': 'application/json' };
  const claimed = await post('/v1/job/claim', { jobId: job.jobId, host: { host: 'Word', wordApiDesktop12: true } });
  assert.equal(claimed.status, 200);
  assert.equal(Buffer.from((await claimed.json()).revisedBase64, 'base64').compare(revised), 0);
  assert.equal((await post('/v1/job/result/slice', { jobId: job.jobId, index: 0, total: 1, data: output.toString('base64') })).status, 200);
  assert.equal((await post('/v1/job/result/complete', { jobId: job.jobId })).status, 200);
  assert.equal(job.resultBytes.compare(output), 0);

  async function post(path, body) {
    return fetch(`${bridge.origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }
});
