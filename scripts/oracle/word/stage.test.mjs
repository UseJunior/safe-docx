import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { ADDIN_ID, embedAutoOpenAddin, stagedFileName } from './stage.mjs';

async function minimalDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('embeds the documented auto-open webextension parts without changing document XML', async () => {
  const source = await minimalDocx();
  const before = await JSZip.loadAsync(source);
  const staged = await JSZip.loadAsync(await embedAutoOpenAddin(source));
  assert.equal(await staged.file('word/document.xml').async('string'), await before.file('word/document.xml').async('string'));
  assert.match(await staged.file('[Content_Types].xml').async('string'), /webextensiontaskpanes/);
  assert.match(await staged.file('_rels/.rels').async('string'), /webextensiontaskpanes/);
  assert.match(await staged.file('webextensions/taskpanes.xml').async('string'), /visibility="1"/);
  assert.match(await staged.file('webextensions/webextension1.xml').async('string'), new RegExp(ADDIN_ID));
  assert.match(await staged.file('webextensions/webextension1.xml').async('string'), /Office\.AutoShowTaskpaneWithDocument/);
});

test('creates a parseable unique staged filename carrying only one-job credentials', () => {
  const name = stagedFileName({ port: 43123, jobId: '657d7133-f504-45cf-aef4-a04394615230', token: 'Mkt4qFNf8wjhgbUU_NnF9at63wEdfGlxy29853mcJZo', originalFileName: 'original file.docx' });
  assert.equal(name, 'safe-docx-word-oracle--p43123--j657d7133-f504-45cf-aef4-a04394615230--tMkt4qFNf8wjhgbUU_NnF9at63wEdfGlxy29853mcJZo--original_file.docx');
});
