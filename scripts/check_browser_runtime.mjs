/** Browser import-graph guard and execution smoke. No Node polyfills are provided. */
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { createHash as nodeHash } from 'node:crypto';
import nodePath from 'node:path';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hash, createHash } from '../packages/docx-core/dist/runtime/hash.js';
import { posix } from '../packages/docx-core/dist/runtime/posix.js';

// Differential checks include both padding boundaries, multi-block data, UTF-8,
// unpaired surrogates, binary subarrays and incremental updates.
for (const algorithm of ['sha256', 'sha1']) {
  for (const length of [0,1,55,56,63,64,65,119,120,127,128,1024,1000000]) {
    const bytes = Uint8Array.from({ length: length + 6 }, (_, i) => (i * 131 + length) % 256).subarray(3, length + 3);
    assert.equal(hash(bytes, algorithm), nodeHash(algorithm).update(bytes).digest('hex'));
  }
  for (const text of ['', 'abc', 'ﬁve\0dollars 😀 漢字', '\ud800', '\udfff']) {
    assert.equal(hash(text, algorithm), nodeHash(algorithm).update(text).digest('hex'));
    assert.equal(createHash(algorithm).update(text).update('\0').update(new Uint8Array([255, 0])).digest('hex'),
      nodeHash(algorithm).update(text).update('\0').update(new Uint8Array([255, 0])).digest('hex'));
  }
}
for (const path of ['', '.', '..', '/', '//', '//a', '///a', 'a/', 'a//b', '../a/../b/', '/a/../../b', '.hidden', 'a/..', 'a/b.xml.rels', 'word/_rels/document.xml.rels']) {
  for (const method of ['normalize', 'dirname', 'basename', 'extname']) {
    assert.equal(posix[method](path), nodePath.posix[method](path), `${method}(${path})`);
  }
  for (const other of ['word/document.xml', '../media/image.png', '', '/', 'word/']) {
    assert.equal(posix.join(path, other), nodePath.posix.join(path, other));
    assert.equal(posix.relative(path, other), nodePath.posix.relative('/' + path, '/' + other));
  }
}

const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const result = await build({
  stdin: { contents: `import * as core from '@usejunior/docx-core';
    import * as compare from '@usejunior/docx-compare';
    import { importRelationshipTarget } from './packages/docx-compare/dist/tagged/relationshipIdCollision.js';
    globalThis.runtime = { core, compare, importRelationshipTarget };`, resolveDir: process.cwd() },
  platform: 'browser', format: 'iife', bundle: true, write: false, metafile: true,
  // Check every reachable import even if tree shaking could hide it today.
  treeShaking: false,
  plugins: [{ name: 'forbid-node-builtins', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (builtins.has(args.path)) throw new Error(`Node built-in in browser graph: ${args.path} imported by ${args.importer}`);
    });
  } }],
});
const context = createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, setTimeout, clearTimeout, console });
context.imageFixture = new Uint8Array(await readFile('tests/test_documents/open-agreements/mutual-nda.docx'));
if (process.argv[2]) context.realFixture = new Uint8Array(await readFile(process.argv[2]));
context.self = context;
context.window = context;
runInContext(result.outputFiles[0].text, context);
await runInContext(`(async () => {
  if (typeof Buffer !== 'undefined' || typeof process !== 'undefined' || typeof require !== 'undefined') throw Error('Node global leaked');
  const {core, compare} = runtime;
  const spec = text => ({sections: [{blocks: [{kind: 'paragraph', runs: [{kind:'text', text}]}]}]});
  const original = await core.generateDocx(spec('Original contract text.'));
  const doc = await core.DocxDocument.load(original);
  doc.insertParagraphBookmarks('browser');
  const id = doc.readParagraphs().paragraphs[0].id;
  doc.replaceText({targetParagraphId:id, findText:'Original', replaceText:'Revised'});
  const edited = (await doc.toBuffer()).buffer;
  const reopened = await core.DocxDocument.load(edited);
  if (!reopened.readParagraphs().paragraphs[0].text.includes('Revised')) throw Error('Edit lost');
  const revised = await core.generateDocx(spec('Revised contract text.'));
  const result = await compare.compareDocuments(original, revised, {author:'Browser', date:null});
  const zip = await core.DocxArchive.load(result.document);
  const xml = await zip.getDocumentXml();
  if (!xml.includes('w:ins') || !xml.includes('w:del')) throw Error('Missing redline');
  if (!compare.acceptAllChanges(xml).includes('Revised')) throw Error('Accept failed');
  if (!compare.rejectAllChanges(xml).includes('Original')) throw Error('Reject failed');
  // Exercise binary relationship imports and auxiliary XML decoding with a real image-bearing DOCX.
  const mediaArchive = await core.DocxArchive.load(imageFixture);
  const mediaPath = mediaArchive.listFiles().find(path => path.startsWith('word/media/') && !path.endsWith('/'));
  const media = await mediaArchive.getFileBuffer(mediaPath);
  const changedMedia = new Uint8Array(media.length + 1);
  changedMedia.set(media);
  changedMedia[media.length] = 1;
  mediaArchive.setFile(mediaPath, changedMedia);
  await compare.compareDocuments(imageFixture, await mediaArchive.save(), {author:'Browser image'});
  const importedTarget = await runtime.importRelationshipTarget(
    await core.DocxArchive.load(imageFixture), 'word/header1.xml',
    {target:'media/image1.png', targetMode:null}, mediaArchive, 'word/header1.xml');
  if (importedTarget === 'media/image1.png') throw Error('Image collision reused changed bytes');
  const importedBytes = await mediaArchive.getFileBuffer('word/' + importedTarget);
  if (importedBytes.length !== media.length || !importedBytes.every((byte, index) => byte === media[index])) throw Error('Imported image bytes changed');
  const stillChanged = await mediaArchive.getFileBuffer(mediaPath);
  if (stillChanged.length !== changedMedia.length) throw Error('Existing image bytes changed');
  console.log('PASS: image-bearing real DOCX compares changed binary payloads without Buffer methods.');
  if (typeof realFixture !== 'undefined') {
    const real = await core.DocxDocument.load(realFixture);
    real.insertParagraphBookmarks('runtime-smoke');
    const paragraph = real.readParagraphs().paragraphs[0];
    real.replaceText({targetParagraphId:paragraph.id, findText:paragraph.text, replaceText:paragraph.text + ' Runtime smoke.'});
    const changed = (await real.toBuffer()).buffer;
    const comparison = await compare.compareDocuments(realFixture, changed, {author:'Runtime smoke', date:null});
    const realXml = await (await core.DocxArchive.load(comparison.document)).getDocumentXml();
    if (!realXml.includes('w:ins') || !compare.acceptAllChanges(realXml).includes('Runtime smoke.')) throw Error('Real DOCX comparison lost edit');
    if (compare.rejectAllChanges(realXml).includes('Runtime smoke.')) throw Error('Real DOCX reject retained edit');
    console.log('PASS: real DOCX browser edit/save/compare accept/reject (' + realFixture.length + ' input bytes).');
  }
  return {original:original.length, edited:edited.length, compared:result.document.length};
})()`, context);
console.log('PASS: browser bundle excludes Node built-ins; generation, edit/save/reopen and compare accept/reject execute without Node globals.');
console.log('PASS: SHA-256/SHA-1 bytes match node:crypto; POSIX package paths match node:path.');
