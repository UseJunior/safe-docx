#!/usr/bin/env node
/**
 * Deterministic synthetic reproduction for the quadratic-memory comparison blowup.
 *
 * `computeAtomLcs` (packages/docx-compare/src/baselines/atomizer/atomLcs.ts) allocates a
 * full `(n+1) x (m+1)` nested-array dynamic-programming matrix, where n and m are the
 * text-atom counts of the two documents. The allocation is unconditional — no size cap
 * and no linear-space (Hirschberg) fallback — so a SINGLE paragraph carrying a few
 * thousand atoms drives a comparison (self-comparison included) into V8 heap exhaustion
 * ("Ineffective mark-compacts near heap limit / JavaScript heap out of memory"), a
 * denial-of-service on ordinary Word-authored content.
 *
 * This file emits a self-contained DOCX with ONE paragraph of `--atoms` space-separated
 * invented tokens (no real or customer text). It carries no revision markup — the blowup
 * is in alignment, not in tracked-change handling. Discovered via the LibreOffice
 * docx-fuzzer seed `moz1333610-1.docx` (a ~200 KB single-paragraph crash-report dump);
 * the token content there is irrelevant, only the atom count matters.
 *
 * Usage:
 *   node scripts/corpus/generate_oom_repro.mjs [--atoms N] [--out path.docx]
 *
 * Measured thresholds (self-comparison, inplace mode):
 *   - ~1500 atoms  completes in well under 100 ms;
 *   - ~12000 atoms exhausts a 2 GB worker heap;
 *   - the originating fuzzer seed (~6000 atoms across 53 runs) exhausts the default
 *     ~4 GB heap.
 * Doubling the atom count roughly triples wall time — the O(n*m) signature.
 *
 * Suggested acceptance check once a fix lands (linear-space DP or a bounded refusal):
 *   node --max-old-space-size=2048 -e "compareDocuments(buf, buf)"  // must NOT OOM
 * with `--atoms 12000`: the fix should make large atom counts either compare in bounded
 * memory or fail closed with an actionable error — never exhaust the heap.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/874
 */
import { writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const args = process.argv.slice(2);
const atomCount = Number(args[args.indexOf('--atoms') + 1] ?? 12000);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

// Deterministic invented tokens: a small vocabulary repeated, which also stresses the
// repeated-text alignment path (equal atoms are the worst case for the traceback).
const VOCAB = ['lorem', 'ipsum', 'dolor', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'eiusmod', 'tempor'];
const tokens = Array.from({ length: atomCount }, (_, i) => VOCAB[i % VOCAB.length] + (i % 97));
const bodyText = tokens.join(' ');

const documentXml =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t xml:space="preserve">' + bodyText + '</w:t></w:r></w:p><w:sectPr/></w:body>' +
  '</w:document>';

const zip = new JSZip();
zip.file('[Content_Types].xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>');
zip.file('_rels/.rels',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>');
zip.file('word/_rels/document.xml.rels',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
zip.file('word/document.xml', documentXml);

const buf = await zip.generateAsync({ type: 'nodebuffer' });
if (outPath) {
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath} (${buf.length} bytes, ${atomCount} atoms)`);
} else {
  process.stdout.write(buf);
}
