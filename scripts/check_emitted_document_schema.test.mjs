import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const BODY = '<w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body>';
const gateScript = fileURLToPath(new URL('./check_emitted_document_schema.mjs', import.meta.url));

/** Run the gate on one document.xml instance; returns its exit status and output. */
function runGate(documentXml) {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-schema-gate-test-'));
  try {
    const file = join(dir, 'document.xml');
    writeFileSync(file, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${documentXml}`);
    const result = spawnSync(process.execPath, [gateScript, file], { encoding: 'utf-8' });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the gate accepts a root whose namespace declarations and Ignorable tokens each appear once', () => {
  const gate = runGate(
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}" xmlns:mc="${MC_NS}" xmlns:wps="${WPS_NS}" ` +
    `mc:Ignorable="w14 wps">${BODY}</w:document>`,
  );
  assert.equal(gate.status, 0, gate.output);
});

test('the gate rejects the doubled w14 Ignorable token a duplicated fixture root leaves in compared output (#1484)', () => {
  // The comparison's parser drops the second xmlns:w14/xmlns:mc of a
  // duplicated fixture root but keeps its Ignorable value, so this is the
  // root the redline carries.
  const gate = runGate(
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}" xmlns:mc="${MC_NS}" xmlns:wps="${WPS_NS}" ` +
    `mc:Ignorable="w14 w14 wps">${BODY}</w:document>`,
  );
  assert.equal(gate.status, 1, gate.output);
  assert.match(gate.output, /mc:Ignorable repeats token 'w14' on w:document/);
});

test('the gate rejects a root that declares xmlns:w14 and xmlns:mc twice', () => {
  const gate = runGate(
    `<w:document xmlns:w="${W_NS}" xmlns:w14="${W14_NS}" xmlns:mc="${MC_NS}" ` +
    `xmlns:w14="${W14_NS}" xmlns:mc="${MC_NS}" mc:Ignorable="w14 w14">${BODY}</w:document>`,
  );
  assert.equal(gate.status, 1, gate.output);
  assert.match(gate.output, /Attribute xmlns:w14 redefined/);
});

test('the gate rejects one expanded attribute name carried twice through two prefixes even when preprocessing removes it', () => {
  // Namespaces in XML 1.0 §6.3: a and b bind one URI, so w:p has the
  // attribute {urn:test:dup}k twice. mc:Ignorable drops that namespace, so the
  // preprocessed projection alone would validate.
  const gate = runGate(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:a="urn:test:dup" xmlns:b="urn:test:dup" ` +
    `mc:Ignorable="a"><w:body><w:p a:k="1" b:k="2"><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  assert.equal(gate.status, 1, gate.output);
  assert.match(gate.output, /namespace error : Namespaced Attribute k in 'urn:test:dup' redefined/);
});

test('an Ignorable prefix bound to the Markup Compatibility namespace fails preprocessing', () => {
  const result = applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" mc:Ignorable="mc">${BODY}</w:document>`,
  );
  assert.match(result.parseError, /mc:Ignorable names the Markup Compatibility namespace \(prefix 'mc'\)/);
});

test('MustUnderstand and ProcessContent tokens are checked inside content that preprocessing removes', () => {
  const unboundMustUnderstand = applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:ext="urn:test:ext" mc:Ignorable="ext">` +
    `<w:body><w:p><ext:payload mc:MustUnderstand="missing"/><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
  );
  assert.match(unboundMustUnderstand.parseError, /mc:MustUnderstand names unbound prefix 'missing' on ext:payload/);

  const notIgnorable = applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:ext="urn:test:ext" ` +
    `mc:ProcessContent="ext:payload">${BODY}</w:document>`,
  );
  assert.match(notIgnorable.parseError, /mc:ProcessContent token 'ext:payload' on w:document names a namespace that is not ignorable here/);

  const malformed = applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:ext="urn:test:ext" ` +
    `mc:Ignorable="ext" mc:ProcessContent="ext">${BODY}</w:document>`,
  );
  assert.match(malformed.parseError, /mc:ProcessContent token 'ext' on w:document is not prefix:localName or prefix:\*/);
});

test('Ignorable and ProcessContent accept aliased prefixes for an already-ignorable namespace', () => {
  // ECMA-376 Part 3 Annex A.1.2 and A.1.4: lexically different tokens that
  // resolve to a namespace already declared ignorable are conformant.
  const document = project(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:i1="urn:test:i1" mc:Ignorable="i1">` +
    `<w:body><w:p xmlns:alias="urn:test:i1" mc:Ignorable="alias i1" mc:ProcessContent="alias:* i1:wrap">` +
    `<w:r><w:t>keep</w:t></w:r></w:p></w:body></w:document>`,
  );
  assert.equal(document.getElementsByTagNameNS(W_NS, 't')[0].textContent, 'keep');
});

test('the predefined xml and xmlns prefixes need no declaration in an MCE list', () => {
  for (const attributes of [
    'mc:MustUnderstand="xml"',
    'mc:Ignorable="xml"',
    'mc:MustUnderstand="xmlns"',
    'mc:Ignorable="xmlns" mc:ProcessContent="xmlns:*"',
  ]) {
    const result = applyMcePreprocessing(
      `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" ${attributes}>${BODY}</w:document>`,
    );
    assert.equal(result.parseError, undefined, attributes);
  }
});

test('a ProcessContent local part must be an NCName or exactly *', () => {
  const withToken = (token) => applyMcePreprocessing(
    `<w:document xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:ext="urn:test:ext" ` +
    `mc:Ignorable="ext" mc:ProcessContent="${token}">${BODY}</w:document>`,
  );
  for (const token of ['ext:1bad', 'ext:**', 'ext:a*']) {
    assert.match(withToken(token).parseError, /is not prefix:localName or prefix:\*/, token);
  }
  for (const token of ['ext:*', 'ext:wrap', 'ext:élément-2', 'ext:_x.y']) {
    assert.equal(withToken(token).parseError, undefined, token);
  }
});

test('the gate attributes a failure only to its own instance when one input path prefixes another', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-schema-gate-names-'));
  try {
    writeFileSync(join(dir, 'prefix.xml'), `<w:document xmlns:w="${W_NS}">${BODY}</w:document>`);
    writeFileSync(
      join(dir, 'prefix.xml:tail.xml'),
      `<w:document xmlns:w="${W_NS}" xmlns:a="urn:test:dup" xmlns:b="urn:test:dup">` +
      `<w:body><w:p a:k="1" b:k="2"><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = spawnSync(process.execPath, [gateScript, dir], { encoding: 'utf-8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /INVALID: prefix\.xml:tail\.xml\n/);
    assert.doesNotMatch(result.stderr, /INVALID: prefix\.xml\n/);
    assert.match(result.stderr, /1 of 2 document\.xml instances failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
