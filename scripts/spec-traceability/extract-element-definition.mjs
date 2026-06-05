#!/usr/bin/env node
/**
 * extract-element-definition.mjs — first-cut PoC for ECMA-376 spec traceability.
 *
 * Pairs an XSD element with its [MS-OE376] (Office Implementation Information
 * for ECMA-376 Standards Support) section and emits a single interactive HTML
 * page. The [MS-OE376] document is structured DOCX, so anchoring is
 * deterministic (Heading3 + literal regex) rather than heuristic.
 *
 * See ./README.md for the rationale, the 2nd-edition Part-numbering wrinkle,
 * and the issue-#227 follow-up.
 *
 * Local-dev tool only. Output is gitignored. Not invoked from CI.
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

const DEFAULTS = {
  xsd: path.join(REPO_ROOT, 'spec-compliance/ecma-376/schemas/transitional/wml.xsd'),
  msOe376Docx: path.join(os.homedir(), 'Downloads/[MS-OE376]-220816.docx'),
  element: 'p',
  // MS-OE376 uses 2nd-edition Part numbering: WordprocessingML = Part 4.
  // Vendored XSDs are 5th-edition (Part 1 §17). Mapping for <w:p>: Part 4 §2.3.1.22 ↔ Part 1 §17.3.1.22.
  part: 4,
  // Default to the WordprocessingML run-level/paragraph element family.
  sectionPrefix: '2.3',
  out: path.join(REPO_ROOT, 'out/spec-traceability/poc'),
  cache: path.join(REPO_ROOT, 'scripts/spec-traceability/.cache'),
  groupDepth: 2,
};

const PROSE_LEMMAS = {
  pPr: ['paragraph properties', 'paragraph property'],
  rPr: ['run properties', 'run property'],
  r: ['run', 'runs', 'text run'],
  t: ['text content'],
  hyperlink: ['hyperlink', 'hyperlinks'],
  fldSimple: ['simple field'],
  subDoc: ['subdocument'],
  customXml: ['custom xml'],
  smartTag: ['smart tag'],
  sdt: ['structured document tag'],
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = m[2] ?? 'true';
    if (key === 'groupDepth' || key === 'part') out[key] = Number(val);
    else out[key] = val;
  }
  return out;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Stage 1: XSD slice (unchanged from prior PoC) ----------------------

function extractXsdSlice({ xsd, element, groupDepth }) {
  const xsdSource = fs.readFileSync(xsd, 'utf8');
  const doc = new DOMParser().parseFromString(xsdSource, 'application/xml');
  const elementDecl = findNamed(doc, 'element', element);
  if (!elementDecl) throw new Error(`<xsd:element name="${element}"> not found in ${xsd}`);
  const typeName = elementDecl.getAttribute('type');
  if (!typeName) throw new Error(`<xsd:element name="${element}"> has no @type`);
  const localTypeName = stripPrefix(typeName);
  const complexType = findNamed(doc, 'complexType', localTypeName);
  if (!complexType) throw new Error(`<xsd:complexType name="${localTypeName}"> not found`);
  return {
    element,
    type: localTypeName,
    attributes: collectAttributes(complexType),
    children: collectChildren(doc, complexType, groupDepth),
    xsdSourceSnippet: complexType.toString(),
  };
}

function findNamed(doc, localName, nameAttr) {
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

function collectAttributes(complexType) {
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

function collectChildren(doc, container, groupDepth) {
  const seen = new Set();
  const out = [];
  function walk(node, provenance, depthRemaining) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1 || c.namespaceURI !== XSD_NS) continue;
      switch (c.localName) {
        case 'element': {
          const name = c.getAttribute('name');
          if (!name) continue;
          const key = name + '|' + provenance.join('>');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            name,
            type: c.getAttribute('type') || '',
            minOccurs: c.getAttribute('minOccurs') || '1',
            maxOccurs: c.getAttribute('maxOccurs') || '1',
            provenance: provenance.join(' > '),
          });
          break;
        }
        case 'group': {
          const ref = c.getAttribute('ref');
          if (ref && depthRemaining > 0) {
            const groupNode = findNamed(doc, 'group', stripPrefix(ref));
            if (groupNode) walk(groupNode, [...provenance, `group:${stripPrefix(ref)}`], depthRemaining - 1);
          }
          break;
        }
        case 'sequence':
        case 'choice':
        case 'all':
          walk(c, provenance, depthRemaining);
          break;
      }
    }
  }
  walk(container, ['direct'], groupDepth);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// --- Stage 2: Materialize MS-OE376 document.xml -------------------------

async function materializeMsOe376({ msOe376Docx, cache }) {
  fs.mkdirSync(cache, { recursive: true });
  const zipBytes = fs.readFileSync(msOe376Docx);
  const zip = await JSZip.loadAsync(zipBytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error(`word/document.xml not found in ${msOe376Docx}`);
  const xmlBytes = await entry.async('nodebuffer');
  const sha = crypto.createHash('sha256').update(xmlBytes).digest('hex').slice(0, 16);
  const cached = path.join(cache, `ms-oe376-document-${sha}.xml`);
  if (!fs.existsSync(cached)) fs.writeFileSync(cached, xmlBytes);
  return cached;
}

// --- Stage 3: Parse document.xml → flat paragraph list ------------------

function parseDocXml(documentXmlPath) {
  const xml = fs.readFileSync(documentXmlPath, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const bodies = doc.getElementsByTagNameNS(W_NS, 'body');
  if (bodies.length === 0) throw new Error('No <w:body> in document.xml');
  const body = bodies[0];
  const paragraphs = [];
  let idx = 0;
  for (let i = 0; i < body.childNodes.length; i++) {
    const n = body.childNodes[i];
    if (n.nodeType !== 1 || n.namespaceURI !== W_NS || n.localName !== 'p') continue;
    paragraphs.push({
      idx: idx++,
      style: getParagraphStyle(n),
      text: getParagraphText(n),
    });
  }
  return paragraphs;
}

function getParagraphStyle(pNode) {
  const ppr = firstChildNS(pNode, W_NS, 'pPr');
  if (!ppr) return '';
  const pStyle = firstChildNS(ppr, W_NS, 'pStyle');
  if (!pStyle) return '';
  return pStyle.getAttributeNS(W_NS, 'val') || pStyle.getAttribute('w:val') || '';
}

function firstChildNS(node, ns, localName) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === localName) return c;
  }
  return null;
}

function getParagraphText(pNode) {
  // Concat <w:t> text; insert literal "\t" for <w:tab>, " " for <w:br>; ignore everything else.
  let out = '';
  const walker = (n) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI !== W_NS) continue;
      if (c.localName === 't') out += c.textContent;
      else if (c.localName === 'tab') out += '\t';
      else if (c.localName === 'br') out += ' ';
      else walker(c);
    }
  };
  walker(pNode);
  return out;
}

// --- Stage 4: Group paragraphs into sections by Heading3 ----------------

const HEADING3_RE = /^Part\s+(\d+)\s+Section\s+([\d.]+),\s+(\S+)\s+\((.+)\)$/;

function groupSections(paragraphs) {
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
        headingParagraph: p,
      };
    } else if (cur) {
      cur.bodyParagraphs.push(p);
    }
  }
  if (cur) sections.push(cur);
  return sections.filter((s) => s.part !== null && s.element !== null);
}

// --- Stage 5: Match candidates by element + part + section prefix -------

function findCandidates(sections, { element, part, sectionPrefix }) {
  const matches = sections.filter(
    (s) => s.part === part && s.element === element && s.section.startsWith(sectionPrefix)
  );
  // Tie-break by lexicographic section number (canonical form is usually the smaller one).
  matches.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));
  // Other matches in different section ranges (Part match, element match, prefix miss) — surface as candidates.
  const others = sections.filter(
    (s) => s.element === element && (s.part !== part || !s.section.startsWith(sectionPrefix))
  );
  return { winners: matches, others };
}

// --- Stage 6: Resolve cross-references to shared notes blocks -----------

// Matches: "see the notes for oMath, §7.1.2.77(d)." — with optional (letter)
const XREF_RE = /see the notes for (\S+?),?\s*§([\d.]+)(?:\(([a-z])\))?/i;

function resolveCrossReference(section, allSections) {
  for (const p of section.bodyParagraphs) {
    const m = p.text.match(XREF_RE);
    if (!m) continue;
    const [, targetElement, targetSection, letter] = m;
    const target = allSections.find(
      (s) => s.element === targetElement && s.section === targetSection
    );
    if (!target) continue;
    if (letter) {
      // The notes inside the target are labelled "a.   ", "b.   ", etc. Find the labelled block,
      // then collect paragraphs until the next label or section end.
      const labelStart = new RegExp(`^${letter}\\.\\s`);
      const startIdx = target.bodyParagraphs.findIndex((p) => labelStart.test(p.text.trim()));
      if (startIdx < 0) {
        return { target, letter, sourceParagraph: p.text, paragraphs: target.bodyParagraphs };
      }
      const nextLabel = /^[a-z]\.\s/;
      const collected = [target.bodyParagraphs[startIdx]];
      for (let i = startIdx + 1; i < target.bodyParagraphs.length; i++) {
        if (nextLabel.test(target.bodyParagraphs[i].text.trim())) break;
        collected.push(target.bodyParagraphs[i]);
      }
      return { target, letter, sourceParagraph: p.text, paragraphs: collected };
    }
    return { target, letter: null, sourceParagraph: p.text, paragraphs: target.bodyParagraphs };
  }
  return null;
}

// --- Stage 7: Emit interactive HTML -------------------------------------

function annotateXsdMentions(text, xsdSlice) {
  const tokens = [];
  for (const child of xsdSlice.children) {
    if (child.name.length >= 2) tokens.push({ ref: child.name, surface: child.name });
    for (const lemma of PROSE_LEMMAS[child.name] || []) {
      tokens.push({ ref: child.name, surface: lemma });
    }
  }
  if (tokens.length === 0) return escapeHtml(text);
  tokens.sort((a, b) => b.surface.length - a.surface.length);
  const surfaceToRef = new Map();
  for (const t of tokens) {
    const k = t.surface.toLowerCase();
    if (!surfaceToRef.has(k)) surfaceToRef.set(k, t.ref);
  }
  const big = new RegExp(
    `\\b(${tokens.map((t) => escapeRe(t.surface)).join('|')})\\b`,
    'gi'
  );
  return escapeHtml(text).replace(big, (m) => {
    const ref = surfaceToRef.get(m.toLowerCase()) || m;
    return `<span data-xsd-ref="${escapeHtml(ref)}">${m}</span>`;
  });
}

function renderParagraph(p, xsdSlice) {
  const styleClass = `style-${(p.style || 'Normal').toLowerCase()}`;
  const annotated = annotateXsdMentions(p.text, xsdSlice);
  return `      <p class="${escapeHtml(styleClass)}" data-style="${escapeHtml(p.style || 'Normal')}" data-source-idx="${p.idx}">${annotated}</p>`;
}

function renderSection(section, xsdSlice) {
  if (section.bodyParagraphs.length === 0) {
    return '      <p class="empty"><em>(no body paragraphs in this section)</em></p>';
  }
  return section.bodyParagraphs.map((p) => renderParagraph(p, xsdSlice)).join('\n');
}

function emitHtml({ winners, others, xref }, xsdSlice, args) {
  if (winners.length === 0) throw new Error(`No MS-OE376 section matched element="${args.element}" part=${args.part} prefix="${args.sectionPrefix}".`);
  const primary = winners[0];
  fs.mkdirSync(args.out, { recursive: true });
  const dataId = `MSOE376-PART${primary.part}-${primary.section.replace(/\./g, '-')}`;

  const childRows = xsdSlice.children
    .map((c) =>
      `        <tr><td><code>${escapeHtml(c.name)}</code></td>` +
      `<td><code>${escapeHtml(c.type)}</code></td>` +
      `<td><code>${escapeHtml(c.minOccurs)}..${escapeHtml(c.maxOccurs)}</code></td>` +
      `<td><span class="prov">${escapeHtml(c.provenance)}</span></td></tr>`
    )
    .join('\n');
  const attrRows = xsdSlice.attributes
    .map((a) =>
      `        <tr><td><code>${escapeHtml(a.name)}</code></td>` +
      `<td><code>${escapeHtml(a.type)}</code></td>` +
      `<td>${escapeHtml(a.use)}</td></tr>`
    )
    .join('\n');

  const extraWinners = winners.slice(1).map(
    (s) => `      <li><strong>Part ${s.part} §${escapeHtml(s.section)}</strong> ${escapeHtml(s.description)}</li>`
  ).join('\n');
  const othersHtml = others.slice(0, 5).map(
    (s) => `      <li><strong>Part ${s.part} §${escapeHtml(s.section)}</strong> ${escapeHtml(s.description)}</li>`
  ).join('\n');

  const xrefHtml = xref
    ? `  <section class="xref">
    <h2>Resolved cross-reference</h2>
    <p class="xref-meta">From: <em>${escapeHtml(xref.sourceParagraph)}</em></p>
    <p class="xref-meta">To: <strong>${escapeHtml(xref.target.rawHeading)}</strong>${xref.letter ? ` — note (<code>${escapeHtml(xref.letter)}</code>)` : ''}</p>
${xref.paragraphs.map((p) => renderParagraph(p, xsdSlice)).join('\n')}
  </section>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>w:${escapeHtml(xsdSlice.element)} — [MS-OE376] Part ${primary.part} §${escapeHtml(primary.section)}</title>
  <style>
    body { font: 15px/1.55 -apple-system, system-ui, sans-serif; max-width: 820px; margin: 2em auto; padding: 0 1em; color: #222; }
    h1 { font-size: 1.4em; margin-bottom: .25em; }
    h2 { font-size: 1.1em; margin-top: 1.5em; }
    code { background: #f4f4f6; padding: 0 .25em; border-radius: 3px; }
    table { border-collapse: collapse; margin: .5em 0 1em; width: 100%; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e5ea; padding: .35em .5em; text-align: left; vertical-align: top; }
    th { background: #fafafa; }
    .prov { font-size: 11px; color: #666; }
    details { margin: 1em 0; }
    summary { cursor: pointer; }
    [data-xsd-ref] { background: #fffbcc; border-bottom: 1px dashed #c4a000; cursor: help; }
    [data-xsd-ref]:hover { background: #fff39a; }
    .style-definition-field { margin: .4em 0; padding-left: 1.5em; text-indent: -1.5em; }
    .style-definition-field2 { margin: .4em 0 .8em 1.5em; padding: .35em .6em; background: #eef4ff; border-left: 3px solid #5a8fd6; }
    .style-tableheadertext { font-weight: 600; margin-top: .8em; }
    .style-tablebodytext { font-family: ui-monospace, monospace; font-size: 12px; margin: 0 0 0 1em; }
    .xref { margin: 1.5em 0; padding: .8em 1em; background: #f9f9fb; border: 1px solid #e0e0e8; border-radius: 4px; }
    .xref-meta { font-size: 12px; color: #555; margin: .25em 0; }
    .modal { position: fixed; bottom: 1em; right: 1em; max-width: 320px; background: #fff; border: 1px solid #ccc; padding: .75em 1em; box-shadow: 0 2px 12px rgba(0,0,0,.1); font-size: 13px; display: none; }
    .modal.show { display: block; }
    .badge { display: inline-block; font-size: 11px; background: #eef; color: #224; padding: 1px 6px; border-radius: 3px; margin-left: .5em; }
    pre { background: #f4f4f6; padding: .75em; overflow-x: auto; font-size: 12px; line-height: 1.4; }
    footer { margin-top: 2em; font-size: 12px; color: #666; }
    .legend { font-size: 12px; color: #444; }
  </style>
</head>
<body>
  <h1><code>&lt;w:${escapeHtml(xsdSlice.element)}&gt;</code> — [MS-OE376] Part ${primary.part} §${escapeHtml(primary.section)} <span class="badge">PoC</span></h1>
  <p class="legend">
    Heading: <strong>${escapeHtml(primary.element)} (${escapeHtml(primary.description)})</strong> ·
    Stable ID: <code>${escapeHtml(dataId)}</code> ·
    XSD type: <code>${escapeHtml(xsdSlice.type)}</code>
  </p>
  <p class="legend">
    [MS-OE376] uses 2nd-edition ECMA-376 Part numbering. WordprocessingML lives in Part 4 §2.3.1.x here;
    the same element is at Part 1 §17.3.1.x in the 5th-edition XSDs vendored under <code>spec-compliance/</code>.
  </p>
  <section data-msoe376-id="${escapeHtml(dataId)}">
    <h2>Microsoft notes (verbatim from [MS-OE376])</h2>
${renderSection(primary, xsdSlice)}
  </section>
${xrefHtml}
  <section>
    <h2>XSD structure (depth ${args.groupDepth} through groups)</h2>
    <h3>Children</h3>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Cardinality</th><th>Provenance</th></tr></thead>
      <tbody>
${childRows || '        <tr><td colspan="4"><em>(none)</em></td></tr>'}
      </tbody>
    </table>
    <h3>Attributes</h3>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Use</th></tr></thead>
      <tbody>
${attrRows || '        <tr><td colspan="3"><em>(none)</em></td></tr>'}
      </tbody>
    </table>
    <details>
      <summary>Raw XSD complexType source</summary>
      <pre>${escapeHtml(xsdSlice.xsdSourceSnippet)}</pre>
    </details>
  </section>
  <section>
    <h2>Other MS-OE376 sections for <code>${escapeHtml(args.element)}</code></h2>
    <h3>Same Part &amp; element, different section range</h3>
    <ul>
${othersHtml || '      <li><em>(none)</em></li>'}
    </ul>
    ${extraWinners ? `<h3>Additional matches in the same range</h3>\n    <ul>\n${extraWinners}\n    </ul>` : ''}
  </section>
  <div id="modal" class="modal"></div>
  <footer>
    Generated by <code>scripts/spec-traceability/extract-element-definition.mjs</code>.
    See <code>scripts/spec-traceability/README.md</code>. Issue #227.
  </footer>
  <script>
    const modal = document.getElementById('modal');
    document.querySelectorAll('[data-xsd-ref]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        modal.textContent = 'XSD child: ' + el.dataset.xsdRef;
        modal.classList.add('show');
      });
      el.addEventListener('mouseleave', () => modal.classList.remove('show'));
    });
  </script>
</body>
</html>
`;
  const outPath = path.join(args.out, `w-${args.element}.html`);
  fs.writeFileSync(outPath, html);
  return { outPath, primary };
}

// --- Driver --------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  process.stdout.write(`[1/6] XSD slice for <w:${args.element}>…\n`);
  const xsdSlice = extractXsdSlice(args);
  process.stdout.write(`      type=${xsdSlice.type}, children=${xsdSlice.children.length}, attrs=${xsdSlice.attributes.length}\n`);

  process.stdout.write(`[2/6] Materializing [MS-OE376] document.xml…\n`);
  const docXmlPath = await materializeMsOe376(args);
  process.stdout.write(`      cached at ${path.relative(REPO_ROOT, docXmlPath)}\n`);

  process.stdout.write(`[3/6] Parsing document.xml…\n`);
  const paragraphs = parseDocXml(docXmlPath);
  process.stdout.write(`      ${paragraphs.length} <w:p> in body\n`);

  process.stdout.write(`[4/6] Grouping into Heading3 sections…\n`);
  const sections = groupSections(paragraphs);
  process.stdout.write(`      ${sections.length} parseable Heading3 sections\n`);

  process.stdout.write(`[5/6] Locating element + resolving cross-references…\n`);
  const { winners, others } = findCandidates(sections, args);
  if (winners.length === 0) {
    process.stderr.write(`No section matched element="${args.element}" part=${args.part} prefix="${args.sectionPrefix}".\n`);
    if (others.length > 0) {
      process.stderr.write(`Did you mean one of these?\n`);
      for (const s of others.slice(0, 5)) {
        process.stderr.write(`  Part ${s.part} §${s.section} — ${s.description}\n`);
      }
    }
    process.exit(2);
  }
  const primary = winners[0];
  const xref = resolveCrossReference(primary, sections);
  process.stdout.write(`      primary: Part ${primary.part} §${primary.section} ${primary.description}\n`);
  if (xref) {
    process.stdout.write(`      x-ref: → ${xref.target.rawHeading}${xref.letter ? ` (${xref.letter})` : ''}\n`);
  }

  process.stdout.write(`[6/6] Emitting HTML…\n`);
  const { outPath } = emitHtml({ winners, others, xref }, xsdSlice, args);
  process.stdout.write(`      wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

main().catch((err) => {
  process.stderr.write(err.stack + '\n');
  process.exit(1);
});
