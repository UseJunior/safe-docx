import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { buildFixture, issue891Bodies } from './fixtures.mjs';

test('builds the four deterministic #891 Word-oracle inputs', async () => {
  assert.deepEqual(Object.keys(issue891Bodies), ['table-original.docx', 'table-revised.docx', 'section-original.docx', 'section-revised.docx']);
  for (const xml of Object.values(issue891Bodies)) {
    const zip = await JSZip.loadAsync(await buildFixture(xml));
    assert.equal(await zip.file('word/document.xml').async('string'), xml);
  }
});
