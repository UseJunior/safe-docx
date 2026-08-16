#!/usr/bin/env node
/**
 * OOXML feature classifier for the differential-testing corpus.
 *
 * Derives a per-document feature index (revision markup, notes, comments,
 * content controls, fields, drawings, math, structural counts, package-shape
 * observations) so corpus sampling can be stratified by feature instead of
 * testing only simple body-text documents. External corpora (Common-Crawl
 * derived collections in particular) carry no OOXML feature labels; this
 * derived index is this repository's own work product and is the only thing
 * about those documents that is committed — never document bytes, and never
 * revision-author names (only the count of distinct authors).
 *
 * Usage:
 *   node scripts/corpus/classify_docx_features.mjs <file-or-dir> [...more] [--json out.json]
 *
 * Also importable: `classifyDocxBuffer(buffer)` returns the feature record.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const W_STRICT_NS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

/** Count non-overlapping regex matches. */
function count(text, re) {
  const m = text.match(new RegExp(re, 'g'));
  return m ? m.length : 0;
}

/**
 * Classify one DOCX package buffer. Never throws: unreadable packages come
 * back as `{ readable: false, error }` so deliberately-corrupt corpora can be
 * indexed alongside well-formed ones.
 */
export async function classifyDocxBuffer(buffer) {
  const record = {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
    readable: true,
  };
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    return { ...record, readable: false, error: String(error?.message ?? error).slice(0, 200) };
  }

  const names = Object.keys(zip.files);
  record.zipEntryCount = names.length;
  const odd = names.filter(
    (n) => n.startsWith('/') || n.includes('..') || n.includes('\\') || /[\u0000-\u001f]/.test(n),
  );
  if (odd.length > 0) record.oddZipEntryNames = odd.length;
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) { record.duplicateZipEntries = true; break; }
    seen.add(n);
  }

  async function text(name) {
    const f = zip.file(name);
    if (!f) return null;
    try { return await f.async('string'); } catch { return null; }
  }

  const contentTypes = await text('[Content_Types].xml');
  const doc = await text('word/document.xml');
  if (doc == null) {
    return { ...record, readable: false, error: 'missing word/document.xml' };
  }

  record.strict =
    doc.includes(W_STRICT_NS) || (contentTypes ?? '').includes('purl.oclc.org/ooxml');

  // Revision markup (document body only; header/footer/notes revisions counted separately).
  record.features = {
    ins: count(doc, '<w:ins[ >/]'),
    del: count(doc, '<w:del[ >/]'),
    move: count(doc, '<w:moveFrom[ >/]|<w:moveTo[ >/]'),
    rPrChange: count(doc, '<w:rPrChange[ >]'),
    pPrChange: count(doc, '<w:pPrChange[ >]'),
    sectPrChange: count(doc, '<w:sectPrChange[ >]'),
    tblRowChange: count(doc, '<w:trPr[^>]*>[\\s\\S]*?<w:(ins|del)[ />]') > 0 ? 1 : 0,
    footnoteRefs: count(doc, '<w:footnoteReference[ />]'),
    endnoteRefs: count(doc, '<w:endnoteReference[ />]'),
    commentRefs: count(doc, '<w:commentReference[ />]'),
    sdt: count(doc, '<w:sdt>'),
    fldSimple: count(doc, '<w:fldSimple[ >]'),
    instrText: count(doc, '<w:instrText[ >]'),
    hyperlinks: count(doc, '<w:hyperlink[ >]'),
    bookmarks: count(doc, '<w:bookmarkStart[ />]'),
    textBoxes: count(doc, '<w:txbxContent[ >]'),
    math: count(doc, '<m:oMath[ >]'),
    vml: count(doc, '<v:shape[ >]|<v:group[ >]|<v:rect[ >]|<v:oval[ >]|<v:line[ >]'),
    drawings: count(doc, '<w:drawing[ >]'),
    altContent: count(doc, '<mc:AlternateContent[ >]'),
    tabs: count(doc, '<w:tab[ />]'),
    breaks: count(doc, '<w:br[ />]'),
  };

  record.counts = {
    paragraphs: count(doc, '<w:p[ />]|<w:p>'),
    runs: count(doc, '<w:r[ >]|<w:r>'),
    tables: count(doc, '<w:tbl>'),
    rows: count(doc, '<w:tr[ >]|<w:tr>'),
    cells: count(doc, '<w:tc>|<w:tc[ >]'),
    sections: count(doc, '<w:sectPr[ >]|<w:sectPr>'),
  };

  // Distinct revision authors — COUNT only, never the names themselves.
  const authors = new Set();
  for (const m of doc.matchAll(/w:author="([^"]*)"/g)) authors.add(m[1]);
  record.revisionAuthorCount = authors.size;

  // Namespace redeclarations beyond the root element.
  const rootEnd = doc.indexOf('>', doc.indexOf('<w:document'));
  record.nsRedeclarations = rootEnd >= 0 ? count(doc.slice(rootEnd + 1), 'xmlns:') : 0;

  // Side parts and relationships.
  const has = (n) => Boolean(zip.file(n));
  record.parts = {
    footnotes: has('word/footnotes.xml'),
    endnotes: has('word/endnotes.xml'),
    comments: has('word/comments.xml'),
    commentsExtended: has('word/commentsExtended.xml'),
    numbering: has('word/numbering.xml'),
    styles: has('word/styles.xml'),
    settings: has('word/settings.xml'),
    headers: names.filter((n) => /^word\/header\d*\.xml$/.test(n)).length,
    footers: names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).length,
    embeddedObjects: names.filter((n) => n.startsWith('word/embeddings/')).length,
    media: names.filter((n) => n.startsWith('word/media/')).length,
  };
  const rels = await text('word/_rels/document.xml.rels');
  record.relationshipCount = rels ? count(rels, '<Relationship[ >]') : 0;
  record.externalRelationships = rels ? count(rels, 'TargetMode="External"') : 0;

  // Strata labels for sampling.
  const strata = [];
  const f = record.features;
  if (f.ins + f.del + f.move + f.rPrChange + f.pPrChange > 0) strata.push('tracked-changes');
  if (f.move > 0) strata.push('moves');
  if (f.footnoteRefs + f.endnoteRefs > 0) strata.push('notes');
  if (f.commentRefs > 0) strata.push('comments');
  if (f.sdt > 0) strata.push('content-controls');
  if (f.fldSimple + f.instrText > 0) strata.push('fields');
  if (f.textBoxes > 0) strata.push('text-boxes');
  if (f.math > 0) strata.push('math');
  if (f.vml > 0) strata.push('vml');
  if (f.drawings > 0) strata.push('drawings');
  if (record.counts.tables > 0) strata.push('tables');
  if (record.counts.sections > 1) strata.push('multi-section');
  if (record.parts.headers + record.parts.footers > 0) strata.push('headers-footers');
  if (record.strict) strata.push('iso-strict');
  if (record.parts.embeddedObjects > 0) strata.push('embedded-objects');
  if (strata.length === 0) strata.push('plain-body');
  record.strata = strata;
  return record;
}

function* walk(root) {
  const st = statSync(root);
  if (st.isFile()) { yield root; return; }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(docx|docm)$/i.test(entry.name)) yield p;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  let outPath = null;
  if (jsonIdx >= 0) { outPath = args[jsonIdx + 1]; args.splice(jsonIdx, 2); }
  if (args.length === 0) {
    console.error('Usage: classify_docx_features.mjs <file-or-dir> [...] [--json out.json]');
    process.exit(2);
  }
  const results = [];
  for (const root of args) {
    for (const file of walk(root)) {
      const rec = await classifyDocxBuffer(readFileSync(file));
      results.push({ path: file, ...rec });
    }
  }
  const payload = JSON.stringify(results, null, 2);
  if (outPath) writeFileSync(outPath, payload);
  else console.log(payload);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch { return false; }
})();
if (invokedDirectly) await main();
