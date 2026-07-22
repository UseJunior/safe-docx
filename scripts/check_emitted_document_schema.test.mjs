import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { applyMcePreprocessing } from './check_emitted_document_schema.mjs';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function project(xml) {
  const result = applyMcePreprocessing(xml);
  assert.equal(result.parseError, undefined);
  return new DOMParser().parseFromString(result.xml, 'application/xml');
}

test('root ignorable namespaces apply by URI across prefix aliases', () => {
  const document = project(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" ` +
    `xmlns:ext="urn:test:root" mc:Ignorable="ext">` +
    `<w:body><w:p xmlns:alias="urn:test:root" alias:flag="drop">` +
    `<alias:payload/><w:r><w:t>keep</w:t></w:r></w:p></w:body></w:document>`,
  );

  assert.equal(document.getElementsByTagNameNS('urn:test:root', 'payload').length, 0);
  assert.equal(document.getElementsByTagNameNS(W_NS, 'p')[0].getAttributeNS('urn:test:root', 'flag'), null);
  assert.equal(document.getElementsByTagNameNS(W_NS, 't')[0].textContent, 'keep');
});

test('local ignorable declarations use effective descendant scope', () => {
  const document = project(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}"><w:body><w:p>` +
    `<w:sdt xmlns:local="urn:test:local" mc:Ignorable="local" local:flag="drop">` +
    `<w:sdtPr><local:payload/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>keep</w:t></w:r></w:sdtContent>` +
    `</w:sdt></w:p></w:body></w:document>`,
  );

  const control = document.getElementsByTagNameNS(W_NS, 'sdt')[0];
  assert.ok(control);
  assert.equal(control.getAttributeNS('urn:test:local', 'flag'), null);
  assert.equal(document.getElementsByTagNameNS('urn:test:local', 'payload').length, 0);
  assert.equal(document.getElementsByTagNameNS(W_NS, 't')[0].textContent, 'keep');
});

test('descendant prefix shadowing adds the locally resolved namespace without losing inherited scope', () => {
  const document = project(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" ` +
    `xmlns:ext="urn:test:outer" mc:Ignorable="ext"><w:body>` +
    `<w:p><w:sdt xmlns:ext="urn:test:inner" mc:Ignorable="ext">` +
    `<w:sdtPr><ext:inner/></w:sdtPr><w:sdtContent><w:r><w:t>keep</w:t></w:r></w:sdtContent>` +
    `</w:sdt></w:p></w:body></w:document>`,
  );

  assert.equal(document.getElementsByTagNameNS('urn:test:inner', 'inner').length, 0);
  assert.equal(document.getElementsByTagNameNS(W_NS, 'sdt').length, 1);
});

test('an unbound local mc:Ignorable token fails preprocessing', () => {
  const result = applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}">` +
    `<w:body><w:p mc:Ignorable="missing"><w:r><w:t>bad</w:t></w:r></w:p></w:body></w:document>`,
  );
  assert.match(result.parseError, /unbound prefix 'missing'/);
});
