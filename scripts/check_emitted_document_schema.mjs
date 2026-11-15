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
 * Each instance is first checked for well-formedness as emitted, before
 * any Markup Compatibility preprocessing rewrites it: libxml2 (the parser
 * LibreOffice reads OOXML with) must report no error, so a repeated
 * attribute or namespace declaration, or two prefixes that make one element
 * carry the same expanded attribute name, fails the gate even when the
 * preprocessed projection would be clean (issue #1484).
 *
 * Requires xmllint (libxml2). The script fails loudly when xmllint is
 * missing — a gate that silently skips is not a gate.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
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

// Not namespace-well-formed (Namespaces in XML 1.0 §6.3): a and b bind one
// URI, so w:p carries the expanded attribute name {urn:sdx:selftest}k twice.
// mc:Ignorable drops that namespace, so only the as-emitted check sees it.
const KNOWN_NOT_WELL_FORMED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:a="urn:sdx:selftest" xmlns:b="urn:sdx:selftest" mc:Ignorable="a">
  <w:body><w:p a:k="1" b:k="2"><w:r><w:t>bad</w:t></w:r></w:p></w:body>
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

/**
 * Run libxml2 over a batch of instance files exactly as emitted, without a
 * schema. Returns per-file well-formedness errors. libxml2 reports a
 * namespace error (Namespaces in XML 1.0 §6.3, two prefixes bound to one URI
 * giving an element the same expanded attribute name twice) without a
 * non-zero exit, so the error lines decide, not the exit status. Warnings
 * do not fail the gate.
 */
export function checkWellFormedBatch(files) {
  const failures = [];
  const CHUNK = 100;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const result = spawnSync('xmllint', ['--noout', '--nonet', ...chunk], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) fail(`xmllint failed to run: ${result.error.message}`);
    const stderr = (result.stderr ?? '').split('\n');
    let chunkFailures = 0;
    for (const file of chunk) {
      const lines = stderr.filter((line) => line.startsWith(`${file}:`) && / error : /.test(line));
      if (lines.length > 0) {
        failures.push({ file, lines: lines.map((line) => `not well-formed: ${line}`) });
        chunkFailures += 1;
      }
    }
    if (result.status !== 0 && chunkFailures === 0) {
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
    const notWellFormedPath = join(dir, 'known-not-well-formed.xml');
    writeFileSync(goodPath, KNOWN_GOOD);
    writeFileSync(badPath, KNOWN_BAD);
    writeFileSync(notWellFormedPath, KNOWN_NOT_WELL_FORMED);
    const notWellFormed = checkWellFormedBatch([goodPath, notWellFormedPath]).map((f) => f.file);
    if (notWellFormed.includes(goodPath)) {
      fail('self-test: known-good instance failed the well-formedness check');
    }
    if (!notWellFormed.includes(notWellFormedPath)) {
      fail('self-test: a repeated expanded attribute name passed the well-formedness check');
    }
    const failures = validateBatch([goodPath, badPath]);
    const failedFiles = failures.map((f) => f.file);
    if (failedFiles.includes(goodPath)) {
      fail(`self-test: known-good instance did not validate:\n${failures.map((f) => f.lines.join('\n')).join('\n')}`);
    }
    if (!failedFiles.includes(badPath)) {
      fail('self-test: known-bad instance validated — the schema wrapper is not enforcing anything');
    }
    console.log('self-test passed: known-good validates, known-bad and known-not-well-formed are rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

// NCName (Namespaces in XML 1.0 §4): an XML 1.0 Name (XML 1.0 §2.3,
// productions [4] and [4a]) without a colon.
const NC_NAME_START_CHAR =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NC_NAME_CHAR = `${NC_NAME_START_CHAR}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
const NC_NAME = new RegExp(`^[${NC_NAME_START_CHAR}][${NC_NAME_CHAR}]*$`, 'u');

/**
 * The namespace `prefix` is bound to in scope at `element`, or null. The
 * `xml` and `xmlns` prefixes are bound by definition and need no
 * declaration (Namespaces in XML 1.0 §3), which xmldom's lookup does not
 * report.
 */
function resolvePrefix(element, prefix) {
  if (prefix === 'xml') return XML_NS;
  if (prefix === 'xmlns') return XMLNS_NS;
  return element.lookupNamespaceURI(prefix);
}

/**
 * Check every element's Markup Compatibility attributes against ECMA-376
 * Part 3 (5th edition, 2015) §7.2–§7.4, and throw on the first violation:
 *   - mc:Ignorable and mc:MustUnderstand: each prefix is bound to an
 *     in-scope namespace that is not the Markup Compatibility namespace
 *     (§7.2, §7.4).
 *   - mc:ProcessContent: each token is `prefix:localName` or `prefix:*`, the
 *     prefix is bound to an in-scope namespace other than the Markup
 *     Compatibility namespace, and that namespace is declared ignorable at
 *     the same element or an ancestor (§7.3).
 *   - No list repeats a token. This rule is the gate's, not Part 3's: §7.2
 *     does not forbid a repeat, and LibreOffice loads one. No producer needs
 *     it, though, and a repeated `w14` is what a root that declared `w14`
 *     twice leaves after a parser drops the second declaration (#1484), so
 *     the gate treats it as an emitter defect.
 *
 * Runs over the whole tree before preprocessing, so markup inside content
 * that preprocessing removes is still checked.
 */
export function checkMarkupCompatibilityAttributes(root) {
  const visit = (element, inheritedIgnorableNs) => {
    const ignorableNs = new Set(inheritedIgnorableNs);
    // Ignorable first: ProcessContent may name a namespace declared ignorable
    // on the same element.
    for (const name of ['Ignorable', 'MustUnderstand', 'ProcessContent']) {
      if (!element.hasAttributeNS(MC_NS, name)) continue;
      const seen = new Set();
      for (const token of element.getAttributeNS(MC_NS, name).trim().split(/\s+/).filter(Boolean)) {
        if (seen.has(token)) {
          throw new Error(`mc:${name} repeats token '${token}' on ${element.tagName}`);
        }
        seen.add(token);
        let prefix = token;
        if (name === 'ProcessContent') {
          const match = /^([^:]+):([^:]+)$/.exec(token);
          if (!match || !NC_NAME.test(match[1]) || (match[2] !== '*' && !NC_NAME.test(match[2]))) {
            throw new Error(
              `mc:ProcessContent token '${token}' on ${element.tagName} is not prefix:localName or prefix:*`
            );
          }
          prefix = match[1];
        } else if (!NC_NAME.test(prefix)) {
          throw new Error(`mc:${name} token '${token}' on ${element.tagName} is not a namespace prefix`);
        }
        const namespaceUri = resolvePrefix(element, prefix);
        if (!namespaceUri) {
          throw new Error(`mc:${name} names unbound prefix '${prefix}' on ${element.tagName}`);
        }
        if (namespaceUri === MC_NS) {
          throw new Error(
            `mc:${name} names the Markup Compatibility namespace (prefix '${prefix}') on ${element.tagName}`
          );
        }
        if (name === 'Ignorable') ignorableNs.add(namespaceUri);
        if (name === 'ProcessContent' && !ignorableNs.has(namespaceUri)) {
          throw new Error(
            `mc:ProcessContent token '${token}' on ${element.tagName} names a namespace that is not ignorable here`
          );
        }
      }
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child, ignorableNs);
    }
  };
  visit(root, new Set());
}

/**
 * Markup Compatibility and Extensibility (ECMA-376 Part 3) preprocessing.
 *
 * Word-emitted documents carry extension markup (w14:paraId, wp14 anchor
 * attributes, ...) in namespaces declared via effective mc:Ignorable scope. A
 * conformant consumer removes ignorable markup before structural validation;
 * the WML XSD alone cannot express this, so we preprocess here:
 *   - resolve each mc:Ignorable prefix to its namespace URI
 *   - drop attributes and elements in those namespaces
 *   - drop all mc-namespace attributes (mc:Ignorable itself)
 *   - resolve mc:AlternateContent to its mc:Fallback content
 *
 * Returns the input unchanged when no mc markup is present, so plain
 * documents are validated byte-for-byte as emitted. The decision is made on
 * the parsed DOM (namespace-aware), never on substring probing.
 */
export function applyMcePreprocessing(xml) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (error) {
    // Not even well-formed. Surface as a gate failure with the parser's
    // message instead of crashing the whole run.
    return { parseError: `not well-formed: ${String(error?.message ?? error).split('\n')[0]}` };
  }
  const root = doc.documentElement;
  if (!root) return { xml };
  try {
    checkMarkupCompatibilityAttributes(root);
  } catch (error) {
    return { parseError: `markup compatibility: ${String(error?.message ?? error).split('\n')[0]}` };
  }

  let changed = false;
  const visit = (element, inheritedIgnorableNs) => {
    const ignorableNs = new Set(inheritedIgnorableNs);
    const ignorable = element.getAttributeNS(MC_NS, 'Ignorable');
    if (ignorable) {
      // checkMarkupCompatibilityAttributes has proved every prefix bound.
      for (const prefix of ignorable.trim().split(/\s+/).filter(Boolean)) {
        ignorableNs.add(resolvePrefix(element, prefix));
      }
    }
    if (element.namespaceURI === MC_NS && element.localName === 'AlternateContent') {
      const fallback = Array.from(element.childNodes).find(
        (n) => n.namespaceURI === MC_NS && n.localName === 'Fallback'
      );
      const parent = element.parentNode;
      if (fallback) {
        for (const child of Array.from(fallback.childNodes)) {
          parent.insertBefore(child, element);
          if (child.nodeType === 1) visit(child, ignorableNs);
        }
      }
      parent.removeChild(element);
      changed = true;
      return;
    }
    if (element.namespaceURI && ignorableNs.has(element.namespaceURI)) {
      element.parentNode.removeChild(element);
      changed = true;
      return;
    }
    for (const attr of Array.from(element.attributes ?? [])) {
      if (attr.namespaceURI === MC_NS || (attr.namespaceURI && ignorableNs.has(attr.namespaceURI))) {
        element.removeAttributeNode(attr);
        changed = true;
      }
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) visit(child, ignorableNs);
    }
  };
  visit(root, new Set());
  if (!changed) return { xml };
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
  // Every instance is staged under a scratch name the gate controls,
  // instance-<n>.xml, so xmllint diagnostics are attributed by a path that
  // holds no colon or newline and is no other path's prefix. Staging also
  // keeps inputs that share a basename (every run's compared.docx) apart.
  // Reports name the source instead.
  const staged = [];
  const stagePath = () => join(scratchDir, `instance-${staged.length}.xml`);
  for (const file of xmlFiles) {
    const path = stagePath();
    copyFileSync(file, path);
    staged.push({ path, name: basename(file) });
  }
  for (const docxPath of docxFiles) {
    const zip = await JSZip.loadAsync(readFileSync(docxPath));
    const part = zip.file('word/document.xml');
    if (!part) fail(`${docxPath}: missing word/document.xml`);
    const path = stagePath();
    writeFileSync(path, await part.async('string'));
    const shown = relative(process.cwd(), docxPath);
    staged.push({ path, name: `${shown.startsWith('..') ? docxPath : shown} word/document.xml` });
  }
  // Well-formedness as emitted, before preprocessing can rewrite (and so
  // hide) a repeated attribute or namespace declaration.
  const notWellFormed = new Map(
    checkWellFormedBatch(staged.map(({ path }) => path)).map(({ file, lines }) => [file, lines])
  );
  // MCE preprocessing: validate the post-MCE projection, which replaces the
  // staged copy once the as-emitted bytes have been checked.
  return staged.map(({ path, name }) => {
    const wellFormedLines = notWellFormed.get(path);
    if (wellFormedLines) return { path, name, rejectedLines: wellFormedLines };
    const xml = readFileSync(path, 'utf-8');
    const result = applyMcePreprocessing(xml);
    if (result.parseError) return { path, name, rejectedLines: [result.parseError] };
    if (result.xml !== xml) writeFileSync(path, result.xml);
    return { path, name };
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
      .filter((inst) => inst.rejectedLines)
      .map((inst) => ({ name: inst.name, lines: inst.rejectedLines }));
    const validatable = instances.filter((inst) => !inst.rejectedLines);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
