#!/usr/bin/env node
/**
 * Validate emitted word/document.xml files against the vendored ECMA-376
 * Transitional WML schema (issue #214 CI gate).
 *
 * Inputs are directories or files:
 *   - a directory is scanned (non-recursively) for *.xml and *.docx entries
 *   - a *.xml file is validated as a document.xml instance
 *   - a *.docx file has its word/document.xml extracted and validated
 *
 * The corpus is produced by running the docx-core test suite with
 * SDX_SCHEMA_CORPUS_DIR set (see src/primitives/schema-corpus-capture.ts):
 *
 *   SDX_SCHEMA_CORPUS_DIR=.tmp/schema-corpus npm run test:run -w @usejunior/docx-core
 *   node scripts/check_emitted_document_schema.mjs --self-test .tmp/schema-corpus
 *
 * Flags:
 *   --self-test            first prove the harness can both accept a known-good
 *                          and reject a known-bad instance (guards against a
 *                          broken schema wrapper silently passing everything)
 *   --allow-empty          do not fail when the inputs yield zero instances
 *   --known-failures FILE  JSON array of { id, issue, match, reason } entries
 *                          pinning known engine-bug error classes. An invalid
 *                          instance whose every error line contains some
 *                          entry's `match` substring is reported but does not
 *                          fail the gate; an entry that matches nothing warns
 *                          (the bug is probably fixed — remove the entry).
 *                          Classes, not file hashes: emitted XML embeds
 *                          revision timestamps, so content hashes churn.
 *
 * Requires xmllint (libxml2). The script fails loudly when xmllint is
 * missing — a gate that silently skips is not a gate.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER_XSD = join(repoRoot, 'spec-compliance/ecma-376/validation/wml-document-transitional.xsd');

const KNOWN_GOOD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body>
</w:document>`;

// Invalid: CT_Body forbids a bare w:r child, and w:p forbids a w:body child.
const KNOWN_BAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:r><w:t>bad</w:t></w:r></w:body>
</w:document>`;

function fail(message) {
  console.error(`check_emitted_document_schema: ${message}`);
  process.exit(1);
}

function requireXmllint() {
  const probe = spawnSync('xmllint', ['--version'], { encoding: 'utf-8' });
  if (probe.error) {
    fail(
      'xmllint not found. Install libxml2 (macOS: bundled with the OS; ' +
        'Debian/Ubuntu: apt-get install libxml2-utils) and re-run.'
    );
  }
}

/** Run xmllint over a batch of instance files. Returns per-file errors. */
function validateBatch(files) {
  const failures = [];
  const CHUNK = 100;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const result = spawnSync(
      'xmllint',
      ['--noout', '--nonet', '--schema', WRAPPER_XSD, ...chunk],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
    );
    if (result.error) fail(`xmllint failed to run: ${result.error.message}`);
    if (result.status === 0) continue;
    // stderr carries both "<file> validates" and per-file error lines; keep
    // everything except the "validates" confirmations.
    const stderr = (result.stderr ?? '').split('\n');
    let chunkFailures = 0;
    for (const file of chunk) {
      const lines = stderr.filter(
        (line) =>
          line.startsWith(file) && !line.endsWith(' validates') && !line.endsWith(' fails to validate')
      );
      if (lines.length > 0) {
        failures.push({ file, lines });
        chunkFailures += 1;
      }
    }
    if (chunkFailures === 0) {
      // Non-zero exit with no parseable per-file errors (e.g. schema compile
      // failure) must still fail the gate, with full output for diagnosis.
      fail(`xmllint exited ${result.status} without per-file errors:\n${result.stderr}`);
    }
  }
  return failures;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'sdx-schema-selftest-'));
  try {
    const goodPath = join(dir, 'known-good.xml');
    const badPath = join(dir, 'known-bad.xml');
    writeFileSync(goodPath, KNOWN_GOOD);
    writeFileSync(badPath, KNOWN_BAD);
    const failures = validateBatch([goodPath, badPath]);
    const failedFiles = failures.map((f) => f.file);
    if (failedFiles.includes(goodPath)) {
      fail(`self-test: known-good instance did not validate:\n${failures.map((f) => f.lines.join('\n')).join('\n')}`);
    }
    if (!failedFiles.includes(badPath)) {
      fail('self-test: known-bad instance validated — the schema wrapper is not enforcing anything');
    }
    console.log('self-test passed: known-good validates, known-bad is rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/**
 * Markup Compatibility and Extensibility (ECMA-376 Part 3) preprocessing.
 *
 * Word-emitted documents carry extension markup (w14:paraId, wp14 anchor
 * attributes, ...) in namespaces the root declares via mc:Ignorable. A
 * conformant consumer removes ignorable markup before structural validation;
 * the WML XSD alone cannot express this, so we preprocess here:
 *   - resolve each mc:Ignorable prefix to its namespace URI
 *   - drop attributes and elements in those namespaces
 *   - drop all mc-namespace attributes (mc:Ignorable itself)
 *   - resolve mc:AlternateContent to its mc:Fallback content
 *
 * Returns the input unchanged when no mc markup is present, so plain
 * documents are validated byte-for-byte as emitted.
 */
function applyMcePreprocessing(xml) {
  if (!xml.includes(MC_NS)) return { xml };
  let doc;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (error) {
    // Not even well-formed. Surface as a gate failure with the parser's
    // message instead of crashing the whole run.
    return { parseError: String(error?.message ?? error).split('\n')[0] };
  }
  const root = doc.documentElement;
  if (!root) return { xml };

  const ignorableNs = new Set();
  const ignorable = root.getAttributeNS(MC_NS, 'Ignorable');
  if (ignorable) {
    for (const prefix of ignorable.trim().split(/\s+/)) {
      const ns = root.lookupNamespaceURI(prefix);
      if (ns) ignorableNs.add(ns);
    }
  }

  const visit = (element) => {
    if (element.namespaceURI === MC_NS && element.localName === 'AlternateContent') {
      const fallback = Array.from(element.childNodes).find(
        (n) => n.namespaceURI === MC_NS && n.localName === 'Fallback'
      );
      const parent = element.parentNode;
      if (fallback) {
        for (const child of Array.from(fallback.childNodes)) {
          parent.insertBefore(child, element);
          if (child.nodeType === 1) visit(child);
        }
      }
      parent.removeChild(element);
      return;
    }
    if (element.namespaceURI && ignorableNs.has(element.namespaceURI)) {
      element.parentNode.removeChild(element);
      return;
    }
    for (const attr of Array.from(element.attributes ?? [])) {
      if (attr.namespaceURI === MC_NS || (attr.namespaceURI && ignorableNs.has(attr.namespaceURI))) {
        element.removeAttributeNode(attr);
      }
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child);
    }
  };
  visit(root);
  return { xml: new XMLSerializer().serializeToString(doc) };
}

async function collectInstances(inputs, scratchDir) {
  const xmlFiles = [];
  const docxFiles = [];
  for (const input of inputs) {
    const path = resolve(input);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      fail(`input not found: ${path}`);
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry.endsWith('.xml')) xmlFiles.push(join(path, entry));
        else if (entry.endsWith('.docx')) docxFiles.push(join(path, entry));
      }
    } else if (path.endsWith('.docx')) {
      docxFiles.push(path);
    } else {
      xmlFiles.push(path);
    }
  }
  for (const docxPath of docxFiles) {
    const zip = await JSZip.loadAsync(readFileSync(docxPath));
    const part = zip.file('word/document.xml');
    if (!part) fail(`${docxPath}: missing word/document.xml`);
    const extracted = join(scratchDir, `${basename(docxPath, '.docx')}.document.xml`);
    writeFileSync(extracted, await part.async('string'));
    xmlFiles.push(extracted);
  }
  // MCE preprocessing: validate the post-MCE projection, written to scratch
  // under the same basename so failures still identify the source instance.
  return xmlFiles.map((file) => {
    const xml = readFileSync(file, 'utf-8');
    const result = applyMcePreprocessing(xml);
    if (result.parseError) {
      return { path: file, name: basename(file), parseError: result.parseError };
    }
    if (result.xml === xml) return { path: file, name: basename(file) };
    const projected = join(scratchDir, basename(file));
    writeFileSync(projected, result.xml);
    return { path: projected, name: basename(file) };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const runSelfTest = args.includes('--self-test');
  const allowEmpty = args.includes('--allow-empty');
  const knownFailuresIdx = args.indexOf('--known-failures');
  const knownFailuresPath = knownFailuresIdx >= 0 ? args[knownFailuresIdx + 1] : null;
  const inputs = args.filter(
    (arg, i) => !arg.startsWith('--') && (knownFailuresIdx < 0 || i !== knownFailuresIdx + 1)
  );

  const knownFailures = knownFailuresPath
    ? JSON.parse(readFileSync(knownFailuresPath, 'utf-8'))
    : [];

  requireXmllint();
  try {
    statSync(WRAPPER_XSD);
  } catch {
    fail(`validation entry schema missing: ${WRAPPER_XSD}`);
  }
  if (runSelfTest) selfTest();

  if (inputs.length === 0) {
    if (runSelfTest) return;
    fail('no inputs given (pass directories/files, or --self-test)');
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'sdx-schema-corpus-'));
  try {
    const instances = await collectInstances(inputs, scratchDir);
    if (instances.length === 0) {
      if (allowEmpty) {
        console.log('no document.xml instances found (allowed by --allow-empty)');
        return;
      }
      fail('no document.xml instances found — the corpus capture produced nothing');
    }

    const failures = instances
      .filter((inst) => inst.parseError)
      .map((inst) => ({ name: inst.name, lines: [`not well-formed: ${inst.parseError}`] }));
    const validatable = instances.filter((inst) => !inst.parseError);
    const byPath = new Map(validatable.map((inst) => [inst.path, inst.name]));
    for (const { file, lines } of validateBatch(validatable.map((inst) => inst.path))) {
      failures.push({ name: byPath.get(file) ?? basename(file), lines });
    }

    const unexpected = [];
    const usedEntries = new Set();
    let pinnedCount = 0;
    for (const failure of failures) {
      const entryFor = (line) => knownFailures.find((entry) => line.includes(entry.match));
      const entries = failure.lines.map(entryFor);
      if (failure.lines.length > 0 && entries.every(Boolean)) {
        pinnedCount += 1;
        for (const entry of entries) usedEntries.add(entry.id);
        const ids = [...new Set(entries.map((entry) => `${entry.id} (${entry.issue})`))];
        console.log(`pinned known failure: ${failure.name} — ${ids.join(', ')}`);
      } else {
        unexpected.push(failure);
      }
    }
    for (const entry of knownFailures) {
      if (!usedEntries.has(entry.id)) {
        console.warn(
          `WARNING: known-failure entry '${entry.id}' (${entry.issue}) matched nothing — probably fixed; remove it from the baseline`
        );
      }
    }

    if (unexpected.length > 0) {
      for (const { name, lines } of unexpected) {
        console.error(`\nINVALID: ${name}`);
        for (const line of lines.slice(0, 20)) console.error(`  ${line}`);
        if (lines.length > 20) console.error(`  … ${lines.length - 20} more errors in this instance`);
      }
      fail(`${unexpected.length} of ${instances.length} document.xml instances failed schema validation`);
    }
    const knownNote = pinnedCount > 0 ? ` (${pinnedCount} instances pinned to known engine bugs)` : '';
    console.log(
      `${instances.length - pinnedCount} of ${instances.length} document.xml instances validate against the Transitional WML schema${knownNote}`
    );
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

await main();
