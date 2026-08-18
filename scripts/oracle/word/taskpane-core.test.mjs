import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCurrentDocumentUrl, connectionFromDocumentUrl, diagnosticFor, parseJobUrl } from './taskpane-core.mjs';

test('accepts only a local HTTPS bridge embedded in the task-pane URL', () => {
  const value = 'https://localhost:38491/taskpane.html#bridge=https%3A%2F%2Flocalhost%3A43123&job=abc&token=secret';
  assert.deepEqual(parseJobUrl(value), { bridge: 'https://localhost:43123', jobId: 'abc', token: 'secret' });
  assert.throws(() => parseJobUrl(value.replace('https%3A%2F%2Flocalhost', 'https%3A%2F%2Fexample.com')), /loopback/);
  assert.throws(() => parseJobUrl(value.replace('https://localhost:38491', 'http://localhost:38491')), /exact/);
});

test('derives the one-job loopback connection from a staged document URL', () => {
  const connection = connectionFromDocumentUrl('file:///tmp/safe-docx-word-oracle--p43123--j657d7133-f504-45cf-aef4-a04394615230--tMkt4qFNf8wjhgbUU_NnF9at63wEdfGlxy29853mcJZo--original.docx');
  assert.deepEqual(connection, { bridge: 'https://localhost:43123', jobId: '657d7133-f504-45cf-aef4-a04394615230', token: 'Mkt4qFNf8wjhgbUU_NnF9at63wEdfGlxy29853mcJZo' });
  assert.equal(connectionFromDocumentUrl('file:///tmp/ordinary.docx'), null);
});

test('redacts error details to bounded diagnostics', () => {
  const result = diagnosticFor({ code: 'X'.repeat(100), message: 'Y'.repeat(1200) });
  assert.equal(result.code.length, 80);
  assert.equal(result.message.length, 1000);
});

test('refuses to compare unless the active document has the unique staged filename', () => {
  assert.doesNotThrow(() => assertCurrentDocumentUrl('file:///private/tmp/job-123-original.docx', 'job-123-original.docx'));
  assert.throws(
    () => assertCurrentDocumentUrl('file:///private/tmp/section-original.docx', 'job-123-table-original.docx'),
    error => error.code === 'WRONG_CURRENT_DOCUMENT',
  );
  assert.throws(() => assertCurrentDocumentUrl('', 'job-original.docx'), error => error.code === 'CURRENT_DOCUMENT_UNVERIFIED');
});
