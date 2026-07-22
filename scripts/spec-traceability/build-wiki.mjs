#!/usr/bin/env node
/**
 * build-wiki.mjs — citation-driven, 1-hop ECMA-376 / [MS-OE376] mini-wiki.
 *
 * Scope rule (per user 2026-05-28): include pages for sections that safe-docx
 * directly cites via @conformance tags / registry entries / .conformance()
 * helpers (the "seed" set), plus pages for sections those seed pages
 * cross-reference. Do NOT recurse further — 2-hop references stay as
 * non-navigable mentions.
 *
 * Output content is VERBATIM from MS-OE376 (after whitespace normalization).
 * A verbatim-check pass runs at the end and reports any drift. AI/LLM
 * augmentation is NOT used for prose content in this PoC.
 *
 * Local-dev tool. Output gitignored. Eventual production home is
 * test-renderer, mirroring its product-first URL pattern
 * (/safe-docx/spec/<section-id>/).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CONFIG = {
  registry: path.join(REPO_ROOT, 'spec-compliance/registry/ecma-376.md'),
  packagesDir: path.join(REPO_ROOT, 'packages'),
  msOe376Docx: path.join(os.homedir(), 'Downloads/[MS-OE376]-220816.docx'),
  wmlXsd: path.join(REPO_ROOT, 'spec-compliance/ecma-376/schemas/transitional/wml.xsd'),
  out: path.join(REPO_ROOT, 'out/spec-traceability/wiki'),
  cache: path.join(REPO_ROOT, 'scripts/spec-traceability/.cache'),
};

// -------------------------------------------------------------------------
// 1. Citation discovery
// -------------------------------------------------------------------------

/** Parse the registry markdown for `[ECMA-PARTn-section-...]` IDs. */
function discoverRegistryCitations() {
  const text = fs.readFileSync(CONFIG.registry, 'utf8');
  const out = [];
  const re = /^##\s*\[(ECMA-PART(\d+)-([\d-]+))\]\s*(.*)$/gm;
  let m;
  while ((m = re.exec(text))) {
    out.push({
      stableId: m[1],
      part: Number(m[2]),
      section: m[3].replace(/-/g, '.'),
      title: m[4].trim(),
      source: 'registry',
    });
  }
  return out;
}

/** Walk packages/** for `@conformance ECMA-376 edition N, Part N § X.Y.Z` JSDoc tags. */
function discoverJsdocCitations() {
  const out = [];
  const re = /@conformance\s+ECMA-376\s+edition\s+(\d+),\s*Part\s+(\d+)\s*§?\s*([\d.]+)/g;
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'allure-results') continue;
        walk(full);
      } else if (/\.(ts|mjs|js)$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let m;
        while ((m = re.exec(text))) {
          out.push({
            edition: Number(m[1]),
            part: Number(m[2]),
            section: m[3],
            file: path.relative(REPO_ROOT, full),
            source: 'jsdoc',
          });
        }
      }
    }
  }
  walk(CONFIG.packagesDir);
  return out;
}

/** Walk packages/** for `.conformance({ spec, edition, part, section })` calls. */
function discoverTestHelperCitations() {
  const out = [];
  const re = /\.conformance\(\{\s*spec:\s*['"]ECMA-376['"],\s*edition:\s*(\d+),\s*part:\s*(\d+),\s*section:\s*['"]([\d.]+)['"]\s*\}/g;
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'allure-results') continue;
        walk(full);
      } else if (/\.test\.ts$/.test(ent.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let m;
        while ((m = re.exec(text))) {
          out.push({
            edition: Number(m[1]),
            part: Number(m[2]),
            section: m[3],
            file: path.relative(REPO_ROOT, full),
            source: 'test',
          });
        }
      }
    }
  }
  walk(CONFIG.packagesDir);
  return out;
}

/** Canonical seed set: dedupe (edition, part, section) and aggregate sources. */
function buildSeedSet() {
  const all = [
    ...discoverRegistryCitations().map((r) => ({
      edition: 5, part: r.part, section: r.section, sources: [{ kind: 'registry', stableId: r.stableId, title: r.title }],
    })),
    ...discoverJsdocCitations().map((j) => ({
      edition: j.edition, part: j.part, section: j.section, sources: [{ kind: 'jsdoc', file: j.file }],
    })),
    ...discoverTestHelperCitations().map((t) => ({
      edition: t.edition, part: t.part, section: t.section, sources: [{ kind: 'test', file: t.file }],
    })),
  ];
  const merged = new Map();
  for (const c of all) {
    const key = `e${c.edition}-p${c.part}-${c.section}`;
    if (!merged.has(key)) merged.set(key, { ...c, sources: [...c.sources] });
    else merged.get(key).sources.push(...c.sources);
  }
  return [...merged.values()];
}

// -------------------------------------------------------------------------
// 2. MS-OE376 ingestion (mirrors extract-element-definition.mjs)
// -------------------------------------------------------------------------

async function loadMsOe376Sections() {
  fs.mkdirSync(CONFIG.cache, { recursive: true });
  const zipBytes = fs.readFileSync(CONFIG.msOe376Docx);
  const zip = await JSZip.loadAsync(zipBytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml not found');
  const xmlBytes = await entry.async('nodebuffer');
  const sha = crypto.createHash('sha256').update(xmlBytes).digest('hex').slice(0, 16);
  const cached = path.join(CONFIG.cache, `ms-oe376-document-${sha}.xml`);
  if (!fs.existsSync(cached)) fs.writeFileSync(cached, xmlBytes);
  const doc = new DOMParser().parseFromString(fs.readFileSync(cached, 'utf8'), 'application/xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const paragraphs = [];
  let idx = 0;
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    if (n.nodeType !== 1 || n.namespaceURI !== W_NS || n.localName !== 'p') continue;
    paragraphs.push({
      idx: idx++,
      style: getPStyle(n),
      text: getParagraphText(n),
    });
  }
  const sections = groupHeading3Sections(paragraphs);
  return { sections, paragraphCount: paragraphs.length };
}

function getPStyle(pNode) {
  for (let i = 0; i < pNode.childNodes.length; i++) {
    const c = pNode.childNodes[i];
    if (c.nodeType === 1 && c.localName === 'pPr' && c.namespaceURI === W_NS) {
      for (let j = 0; j < c.childNodes.length; j++) {
        const cc = c.childNodes[j];
        if (cc.nodeType === 1 && cc.localName === 'pStyle' && cc.namespaceURI === W_NS) {
          return cc.getAttributeNS(W_NS, 'val') || cc.getAttribute('w:val') || '';
        }
      }
    }
  }
  return '';
}

function getParagraphText(pNode) {
  let out = '';
  const walker = (n) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType !== 1 || c.namespaceURI !== W_NS) continue;
      if (c.localName === 't') out += c.textContent;
      else if (c.localName === 'tab') out += '\t';
      else if (c.localName === 'br') out += ' ';
      else walker(c);
    }
  };
  walker(pNode);
  return out;
}

const HEADING3_RE = /^Part\s+(\d+)\s+Section\s+([\d.]+),\s+(\S+)\s+\((.+)\)$/;

function groupHeading3Sections(paragraphs) {
  const sections = [];
  let cur = null;
  for (const p of paragraphs) {
    if (p.style === 'Heading3') {
      if (cur) sections.push(cur);
      const m = p.text.trim().match(HEADING3_RE);
      cur = {
        rawHeading: p.text.trim(),
        part: m ? Number(m[1]) : null,
        section: m ? m[2] : null,
        element: m ? m[3] : null,
        description: m ? m[4] : null,
        bodyParagraphs: [],
      };
    } else if (cur) {
      cur.bodyParagraphs.push(p);
    }
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.part !== null && s.element !== null);
}

// -------------------------------------------------------------------------
// 3. Seed → MS-OE376 mapping
// -------------------------------------------------------------------------

/**
 * Safe-docx cites use 5th-edition Part 1 (or Part 4) numbering: §17.X.Y.
 * MS-OE376 uses 2nd-edition Part 4 numbering: §2.X.Y. The chapter prefix
 * shifts (17→2), the rest stays.
 *
 * For a seed §17.X.Y (5th-ed), look up MS-OE376 at Part 4 §2.X.Y. If the
 * section number has more components after the chapter, those carry over.
 * Either an exact match or any sub-sections (§2.X.Y.Z) qualify — sub-sections
 * are surfaced as a "category" page.
 */
function mapSeedToMsOe376(seed, allSections) {
  if (!seed.section.startsWith('17.')) return { match: null, subsections: [], note: `non-17 section (${seed.section}); mapping skipped` };
  const targetSection = '2.' + seed.section.slice('17.'.length);
  const exact = allSections.find((s) => s.part === 4 && s.section === targetSection);
  const subsections = allSections.filter(
    (s) => s.part === 4 && s.section !== targetSection && s.section.startsWith(targetSection + '.')
  );
  return {
    match: exact || null,
    subsections,
    targetSection,
    note: exact
      ? `direct match`
      : subsections.length > 0
        ? `category page (${subsections.length} sub-sections)`
        : `no MS-OE376 entry at §${targetSection} or below`,
  };
}

// -------------------------------------------------------------------------
// 4. 1-hop cross-reference expansion
// -------------------------------------------------------------------------

const XREF_RE = /see the notes for (\S+?),?\s*§([\d.]+)(?:\(([a-z])\))?/gi;

/**
 * Walk every body paragraph in a section, harvest all cross-references.
 * Returns: [{ targetElement, targetSection, letter, sourceText }, ...]
 */
function harvestCrossRefs(section) {
  const refs = [];
  for (const p of section.bodyParagraphs) {
    let m;
    XREF_RE.lastIndex = 0;
    while ((m = XREF_RE.exec(p.text))) {
      refs.push({
        targetElement: m[1].replace(/[.,;]$/, ''),
        targetSection: m[2],
        letter: m[3] || null,
        sourceText: p.text,
      });
    }
  }
  return refs;
}

function resolveXref(xref, allSections) {
  return allSections.find(
    (s) => s.element === xref.targetElement && s.section === xref.targetSection
  ) || null;
}

// -------------------------------------------------------------------------
// 5. XSD slice (reuses logic from extract-element-definition.mjs)
// -------------------------------------------------------------------------

function loadXsdDoc() {
  const xsdSource = fs.readFileSync(CONFIG.wmlXsd, 'utf8');
  return new DOMParser().parseFromString(xsdSource, 'application/xml');
}

function extractXsdSliceForElement(xsdDoc, elementName, groupDepth = 2) {
  const elementDecl = findXsdNamed(xsdDoc, 'element', elementName);
  if (!elementDecl) return null;
  const typeName = elementDecl.getAttribute('type');
  if (!typeName) return null;
  const localTypeName = stripPrefix(typeName);
  const complexType = findXsdNamed(xsdDoc, 'complexType', localTypeName);
  if (!complexType) return null;
  return {
    element: elementName,
    type: localTypeName,
    attributes: collectXsdAttributes(complexType),
    children: collectXsdChildren(xsdDoc, complexType, groupDepth),
  };
}

function findXsdNamed(doc, localName, nameAttr) {
  const all = doc.getElementsByTagNameNS(XSD_NS, localName);
  for (let i = 0; i < all.length; i++) {
    if (all[i].getAttribute('name') === nameAttr) return all[i];
  }
  return null;
}

function stripPrefix(qname) {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
}

function collectXsdAttributes(complexType) {
  const result = [];
  const attrs = complexType.getElementsByTagNameNS(XSD_NS, 'attribute');
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i].parentNode !== complexType) continue;
    result.push({
      name: attrs[i].getAttribute('name') || attrs[i].getAttribute('ref') || '',
      type: attrs[i].getAttribute('type') || '',
      use: attrs[i].getAttribute('use') || 'optional',
    });
  }
  return result.sort((x, y) => x.name.localeCompare(y.name));
}

function collectXsdChildren(doc, container, groupDepth) {
  const seen = new Set();
  const out = [];
  function walk(node, prov, depth) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1 || c.namespaceURI !== XSD_NS) continue;
      switch (c.localName) {
        case 'element': {
          const name = c.getAttribute('name');
          if (!name) continue;
          const key = name + '|' + prov.join('>');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            name, type: c.getAttribute('type') || '',
            provenance: prov.join(' > '),
          });
          break;
        }
        case 'group': {
          const ref = c.getAttribute('ref');
          if (ref && depth > 0) {
            const g = findXsdNamed(doc, 'group', stripPrefix(ref));
            if (g) walk(g, [...prov, `group:${stripPrefix(ref)}`], depth - 1);
          }
          break;
        }
        case 'sequence':
        case 'choice':
        case 'all':
          walk(c, prov, depth);
          break;
      }
    }
  }
  walk(container, ['direct'], groupDepth);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// -------------------------------------------------------------------------
// 6. Page rendering
// -------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugForSection(part, section) {
  return `part${part}-${section.replace(/\./g, '-')}`;
}

/** Build the per-section page (MS-OE376 prose + XSD slice + cross-refs). */
function renderSectionPage({
  pageKind, // 'seed' | '1-hop'
  seed,     // (only for seed pages)
  section,  // MS-OE376 section, may be null
  subsections, // []  (for category pages)
  msoeMapping, // { match, subsections, targetSection, note }
  xsdSlice,
  inScopeSlugs, // Set of slugs for cross-ref linking
  allSections,
}) {
  const part = section?.part || (seed ? 4 : '?');
  const sectionNum = section?.section || msoeMapping?.targetSection || '?';
  const slug = slugForSection(part, sectionNum);
  const title = section
    ? `${section.element} (${section.description}) — Part ${part} §${sectionNum}`
    : `§${seed.section} — no MS-OE376 entry`;

  const proseHtml = renderProseHtml(section, subsections, inScopeSlugs, allSections);
  const xsdHtml = xsdSlice ? renderXsdHtml(xsdSlice) : '';

  const seedSourcesHtml = seed && seed.sources
    ? `<section class="sources">
    <h2>Cited by safe-docx</h2>
    <ul>
${seed.sources.map((s) => {
  if (s.kind === 'registry') return `      <li>registry → <code>[${escapeHtml(s.stableId)}]</code> ${escapeHtml(s.title)}</li>`;
  if (s.kind === 'jsdoc') return `      <li>JSDoc <code>@conformance</code> in <code>${escapeHtml(s.file)}</code></li>`;
  if (s.kind === 'test') return `      <li>test helper <code>.conformance(...)</code> in <code>${escapeHtml(s.file)}</code></li>`;
  return `      <li>${escapeHtml(JSON.stringify(s))}</li>`;
}).join('\n')}
    </ul>
  </section>`
    : '';

  const noteHtml = msoeMapping?.note
    ? `<p class="meta"><strong>MS-OE376 coverage:</strong> ${escapeHtml(msoeMapping.note)}.${
        seed ? ` Cited as 5th-ed Part ${seed.part} §${seed.section}; mapped to 2nd-ed Part 4 §${msoeMapping.targetSection || '?'}.` : ''
      }</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${commonStyle()}
</head><body>
<nav><a href="index.html">← wiki index</a></nav>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Page kind: <strong>${escapeHtml(pageKind)}</strong> · Slug: <code>${escapeHtml(slug)}</code></p>
${noteHtml}
${seedSourcesHtml}
<section class="prose">
  <h2>${section ? 'MS-OE376 notes (verbatim)' : 'No MS-OE376 entry at this section'}</h2>
${proseHtml}
</section>
${xsdHtml}
<footer>Generated by scripts/spec-traceability/build-wiki.mjs · issue #227</footer>
</body></html>
`;
}

function renderProseHtml(section, subsections, inScopeSlugs, allSections) {
  if (section) {
    const paras = section.bodyParagraphs.length
      ? section.bodyParagraphs.map((p) => {
          const text = annotateCrossRefs(p.text, inScopeSlugs, allSections);
          return `      <p class="style-${escapeHtml((p.style || 'normal').toLowerCase())}">${text}</p>`;
        }).join('\n')
      : '      <p><em>(no body paragraphs)</em></p>';
    let subHtml = '';
    if (subsections.length > 0) {
      subHtml = `<h3>Sub-sections in this category</h3>\n<ul>\n${
        subsections.map((s) => {
          const slug = slugForSection(s.part, s.section);
          const inScope = inScopeSlugs.has(slug);
          const label = `Part ${s.part} §${s.section}, ${s.element} (${s.description})`;
          return inScope
            ? `      <li><a href="${escapeHtml(slug)}.html">${escapeHtml(label)}</a></li>`
            : `      <li class="oos">${escapeHtml(label)} <span class="oos-tag">out of wiki scope</span></li>`;
        }).join('\n')
      }\n</ul>`;
    }
    return paras + (subHtml ? '\n' + subHtml : '');
  }
  // No direct MS-OE376 entry: list any subsections.
  if (subsections.length > 0) {
    return `      <p>This section has no top-level MS-OE376 entry. Sub-sections under it:</p>\n<ul>\n${
      subsections.map((s) => {
        const slug = slugForSection(s.part, s.section);
        const inScope = inScopeSlugs.has(slug);
        const label = `Part ${s.part} §${s.section}, ${s.element} (${s.description})`;
        return inScope
          ? `      <li><a href="${escapeHtml(slug)}.html">${escapeHtml(label)}</a></li>`
          : `      <li class="oos">${escapeHtml(label)} <span class="oos-tag">out of wiki scope</span></li>`;
      }).join('\n')
    }\n</ul>`;
  }
  return `      <p><em>MS-OE376 has no entry at or below this section number. The XSD remains authoritative.</em></p>`;
}

function annotateCrossRefs(text, inScopeSlugs, allSections) {
  // Replace "see the notes for X, §Y.Z(letter)" with a link if Y.Z is in-scope, else gray it out.
  return escapeHtml(text).replace(
    /(see the notes for )(\S+?)(,?\s*§)([\d.]+)(?:(\()([a-z])(\)))?/gi,
    (_, prefix, elem, mid, sectionNum, op, letter, cp) => {
      elem = elem.replace(/[.,;]$/, '');
      const target = allSections.find((s) => s.element === elem && s.section === sectionNum);
      if (target) {
        const slug = slugForSection(target.part, target.section);
        if (inScopeSlugs.has(slug)) {
          const letterFrag = letter ? `${op}${letter}${cp}` : '';
          return `${prefix}<a href="${slug}.html"><code>${elem}</code>${mid}${sectionNum}${letterFrag}</a>`;
        }
      }
      const letterFrag = letter ? `${op}${letter}${cp}` : '';
      return `${prefix}<span class="oos"><code>${elem}</code>${mid}${sectionNum}${letterFrag}<span class="oos-tag">2-hop, out of wiki scope</span></span>`;
    }
  );
}

function renderXsdHtml(xsdSlice) {
  const childRows = xsdSlice.children.map((c) =>
    `      <tr><td><code>${escapeHtml(c.name)}</code></td><td><code>${escapeHtml(c.type)}</code></td><td><span class="prov">${escapeHtml(c.provenance)}</span></td></tr>`
  ).join('\n');
  const attrRows = xsdSlice.attributes.map((a) =>
    `      <tr><td><code>${escapeHtml(a.name)}</code></td><td><code>${escapeHtml(a.type)}</code></td><td>${escapeHtml(a.use)}</td></tr>`
  ).join('\n');
  return `<section class="xsd">
  <h2>XSD slice — <code>${escapeHtml(xsdSlice.type)}</code></h2>
  <h3>Children</h3>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Provenance</th></tr></thead>
    <tbody>
${childRows || '      <tr><td colspan="3"><em>(none)</em></td></tr>'}
    </tbody>
  </table>
  <h3>Attributes</h3>
  <table>
    <thead><tr><th>Name</th><th>Type</th><th>Use</th></tr></thead>
    <tbody>
${attrRows || '      <tr><td colspan="3"><em>(none)</em></td></tr>'}
    </tbody>
  </table>
</section>`;
}

function renderIndexPage(seeds, oneHops, mappings) {
  const seedRows = seeds.map((s) => {
    const map = mappings.get(`e${s.edition}-p${s.part}-${s.section}`);
    const slug = map?.match
      ? slugForSection(map.match.part, map.match.section)
      : map?.subsections?.length > 0
        ? slugForSection(4, map.targetSection)
        : `part${s.part}-${s.section.replace(/\./g, '-')}`;
    return `      <tr>
        <td><a href="${escapeHtml(slug)}.html">§${escapeHtml(s.section)}</a></td>
        <td>edition ${s.edition}, Part ${s.part}</td>
        <td>${escapeHtml(map?.note || '?')}</td>
        <td>${s.sources.length} ${s.sources.length === 1 ? 'site' : 'sites'}</td>
      </tr>`;
  }).join('\n');

  const oneHopRows = [...oneHops].map((info) => {
    const slug = slugForSection(info.section.part, info.section.section);
    return `      <tr>
        <td><a href="${escapeHtml(slug)}.html">§${escapeHtml(info.section.section)}</a></td>
        <td>${escapeHtml(info.section.element)} (${escapeHtml(info.section.description)})</td>
        <td>cited by §${escapeHtml(info.citedBy.join(', §'))}</td>
      </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>safe-docx spec wiki (PoC)</title>
${commonStyle()}
</head><body>
<h1>safe-docx ECMA-376 / [MS-OE376] mini-wiki</h1>
<p class="meta">
  Scope: every ECMA-376 section directly cited by safe-docx, plus every section those cite (1 hop).
  2-hop references appear in prose but are not navigable. Content is verbatim from MS-OE376 with
  whitespace normalization; the verbatim check runs at build time and reports any drift.
</p>
<section>
  <h2>Seed citations (${seeds.length})</h2>
  <p>Discovered from the conformance registry, <code>@conformance</code> JSDoc tags, and <code>.conformance(...)</code> test helpers.</p>
  <table>
    <thead><tr><th>Section</th><th>Edition / Part</th><th>MS-OE376 coverage</th><th>safe-docx mentions</th></tr></thead>
    <tbody>
${seedRows}
    </tbody>
  </table>
</section>
<section>
  <h2>1-hop expansions (${oneHops.size})</h2>
  <p>Cross-referenced from seed sections via the <em>"see the notes for X, §Y.Z"</em> pattern.</p>
  <table>
    <thead><tr><th>Section</th><th>Element (Description)</th><th>Cited from</th></tr></thead>
    <tbody>
${oneHopRows || '      <tr><td colspan="3"><em>(none yet)</em></td></tr>'}
    </tbody>
  </table>
</section>
<footer>Generated by scripts/spec-traceability/build-wiki.mjs · issue #227</footer>
</body></html>
`;
}

function commonStyle() {
  return `<style>
body { font: 15px/1.55 -apple-system, system-ui, sans-serif; max-width: 860px; margin: 2em auto; padding: 0 1em; color: #222; }
h1 { font-size: 1.5em; } h2 { font-size: 1.15em; margin-top: 1.6em; } h3 { font-size: 1em; margin-top: 1.2em; }
code { background: #f4f4f6; padding: 0 .25em; border-radius: 3px; }
.meta { font-size: 13px; color: #555; }
nav { font-size: 13px; margin-bottom: 1em; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: .5em 0 1em; }
th, td { border-bottom: 1px solid #e5e5ea; padding: .35em .5em; text-align: left; vertical-align: top; }
th { background: #fafafa; }
.prov { font-size: 11px; color: #666; }
.style-definition-field { margin: .4em 0; padding-left: 1.5em; text-indent: -1.5em; }
.style-definition-field2 { margin: .4em 0 .8em 1.5em; padding: .35em .6em; background: #eef4ff; border-left: 3px solid #5a8fd6; }
.oos { color: #999; }
.oos a { color: #999; pointer-events: none; }
.oos-tag { display: inline-block; font-size: 10px; background: #eee; padding: 1px 5px; border-radius: 3px; margin-left: .35em; }
footer { margin-top: 2em; font-size: 12px; color: #666; }
section.sources { margin-top: 1em; padding: .5em 1em; background: #fdfaf3; border: 1px solid #e8d9b0; border-radius: 4px; }
section.sources ul { margin: .25em 0; padding-left: 1.5em; }
section.xsd { margin-top: 1.5em; }
</style>`;
}

// -------------------------------------------------------------------------
// 7. Verbatim check (NFC + whitespace normalization)
// -------------------------------------------------------------------------

function normalizeForVerbatim(s) {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function verbatimCheckPage(htmlPath, expectedSection) {
  if (!expectedSection) return { kind: 'skip', reason: 'no source section to compare' };
  const html = fs.readFileSync(htmlPath, 'utf8');
  // Pull text out of <p class="style-..."> blocks in the prose section.
  const re = /<p class="style-[^"]*">([\s\S]*?)<\/p>/g;
  const renderedPieces = [];
  let m;
  while ((m = re.exec(html))) {
    renderedPieces.push(stripHtmlTags(m[1]));
  }
  const renderedNorm = renderedPieces.map(normalizeForVerbatim).filter(Boolean);
  const sourceNorm = expectedSection.bodyParagraphs.map((p) => normalizeForVerbatim(p.text)).filter(Boolean);

  const drifted = [];
  for (let i = 0; i < Math.max(renderedNorm.length, sourceNorm.length); i++) {
    const r = renderedNorm[i];
    const s = sourceNorm[i];
    if (r !== s) drifted.push({ idx: i, rendered: r?.slice(0, 100) || '(missing)', source: s?.slice(0, 100) || '(missing)' });
  }
  return drifted.length === 0
    ? { kind: 'pass', paragraphs: renderedNorm.length }
    : { kind: 'fail', drift: drifted };
}

function stripHtmlTags(html) {
  // Wiki-added annotation spans must be removed BEFORE generic tag stripping,
  // otherwise their inner text ("2-hop, out of wiki scope") leaks into the
  // verbatim comparison. Loop until stable: nested/adjacent angle brackets can
  // re-form a "<...>" that a single pass leaves behind.
  let out = html;
  let prev;
  do {
    prev = out;
    out = out
      .replace(/<span class="oos-tag">[^<]*<\/span>/g, '')
      .replace(/<[^>]+>/g, '');
  } while (out !== prev);
  // Decode entities; &amp; MUST be decoded last so an encoded sequence like
  // "&amp;lt;" resolves to the literal "&lt;" rather than being double-decoded
  // into "<".
  return out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// -------------------------------------------------------------------------
// 8. Driver
// -------------------------------------------------------------------------

async function main() {
  process.stdout.write('[1/6] Discovering safe-docx citations…\n');
  const seeds = buildSeedSet();
  process.stdout.write(`      ${seeds.length} unique (edition, part, section) seeds:\n`);
  for (const s of seeds) {
    process.stdout.write(`        - edition ${s.edition}, Part ${s.part}, §${s.section}  (${s.sources.length} mention${s.sources.length === 1 ? '' : 's'})\n`);
  }

  process.stdout.write('[2/6] Loading MS-OE376…\n');
  const { sections, paragraphCount } = await loadMsOe376Sections();
  process.stdout.write(`      ${sections.length} Heading3 sections across ${paragraphCount} body paragraphs\n`);

  process.stdout.write('[3/6] Mapping seeds to MS-OE376 entries…\n');
  const mappings = new Map();
  for (const seed of seeds) {
    const map = mapSeedToMsOe376(seed, sections);
    mappings.set(`e${seed.edition}-p${seed.part}-${seed.section}`, map);
    process.stdout.write(`      §${seed.section} → ${map.note}\n`);
  }

  process.stdout.write('[4/6] Expanding 1-hop cross-references…\n');
  const oneHopMap = new Map(); // slug → { section, citedBy: [seedSection, ...] }
  for (const seed of seeds) {
    const map = mappings.get(`e${seed.edition}-p${seed.part}-${seed.section}`);
    const candidateSections = [];
    if (map.match) candidateSections.push(map.match);
    candidateSections.push(...map.subsections);
    for (const candidate of candidateSections) {
      const refs = harvestCrossRefs(candidate);
      for (const xref of refs) {
        const target = resolveXref(xref, sections);
        if (!target) continue;
        const slug = slugForSection(target.part, target.section);
        if (!oneHopMap.has(slug)) oneHopMap.set(slug, { section: target, citedBy: [] });
        const entry = oneHopMap.get(slug);
        if (!entry.citedBy.includes(candidate.section)) entry.citedBy.push(candidate.section);
      }
    }
  }
  // Remove 1-hop entries that are themselves already seeds (avoid duplicate pages).
  const seedSlugs = new Set();
  for (const seed of seeds) {
    const map = mappings.get(`e${seed.edition}-p${seed.part}-${seed.section}`);
    if (map.match) seedSlugs.add(slugForSection(map.match.part, map.match.section));
  }
  for (const slug of [...oneHopMap.keys()]) {
    if (seedSlugs.has(slug)) oneHopMap.delete(slug);
  }
  process.stdout.write(`      ${oneHopMap.size} unique 1-hop sections after dedupe\n`);

  process.stdout.write('[5/6] Rendering wiki pages…\n');
  fs.mkdirSync(CONFIG.out, { recursive: true });
  const xsdDoc = loadXsdDoc();
  const inScopeSlugs = new Set([...seedSlugs, ...oneHopMap.keys()]);
  // Seed/category pages
  const writtenPages = [];
  for (const seed of seeds) {
    const map = mappings.get(`e${seed.edition}-p${seed.part}-${seed.section}`);
    const primarySection = map.match || (map.subsections.length > 0 ? null : null);
    const xsdSlice = primarySection ? extractXsdSliceForElement(xsdDoc, primarySection.element) : null;
    const html = renderSectionPage({
      pageKind: 'seed',
      seed,
      section: primarySection,
      subsections: map.subsections,
      msoeMapping: map,
      xsdSlice,
      inScopeSlugs,
      allSections: sections,
    });
    const slug = primarySection
      ? slugForSection(primarySection.part, primarySection.section)
      : map.subsections.length > 0
        ? slugForSection(4, map.targetSection)
        : `part${seed.part}-${seed.section.replace(/\./g, '-')}`;
    const out = path.join(CONFIG.out, `${slug}.html`);
    fs.writeFileSync(out, html);
    writtenPages.push({ slug, htmlPath: out, sourceSection: primarySection });
  }
  // 1-hop pages
  for (const [slug, info] of oneHopMap) {
    const xsdSlice = extractXsdSliceForElement(xsdDoc, info.section.element);
    const html = renderSectionPage({
      pageKind: '1-hop',
      seed: null,
      section: info.section,
      subsections: [],
      msoeMapping: { note: 'direct match (1-hop)', match: info.section, subsections: [], targetSection: info.section.section },
      xsdSlice,
      inScopeSlugs,
      allSections: sections,
    });
    const out = path.join(CONFIG.out, `${slug}.html`);
    fs.writeFileSync(out, html);
    writtenPages.push({ slug, htmlPath: out, sourceSection: info.section });
  }
  // Index
  const oneHops = new Set(oneHopMap.values());
  fs.writeFileSync(path.join(CONFIG.out, 'index.html'), renderIndexPage(seeds, oneHops, mappings));
  process.stdout.write(`      wrote ${writtenPages.length + 1} pages to ${path.relative(REPO_ROOT, CONFIG.out)}/\n`);

  process.stdout.write('[6/6] Verbatim check (NFC + whitespace normalization)…\n');
  let passed = 0, failed = 0, skipped = 0;
  for (const p of writtenPages) {
    const r = verbatimCheckPage(p.htmlPath, p.sourceSection);
    if (r.kind === 'pass') {
      passed++;
    } else if (r.kind === 'fail') {
      failed++;
      process.stdout.write(`      FAIL  ${p.slug} — ${r.drift.length} drifted paragraph${r.drift.length === 1 ? '' : 's'}\n`);
      for (const d of r.drift.slice(0, 2)) {
        process.stdout.write(`              [${d.idx}] rendered: ${d.rendered}\n`);
        process.stdout.write(`              [${d.idx}] source  : ${d.source}\n`);
      }
    } else {
      skipped++;
    }
  }
  process.stdout.write(`      verbatim: ${passed} pass, ${failed} fail, ${skipped} skip\n`);
  if (failed > 0) process.exit(3);
}

main().catch((e) => {
  process.stderr.write(e.stack + '\n');
  process.exit(1);
});
