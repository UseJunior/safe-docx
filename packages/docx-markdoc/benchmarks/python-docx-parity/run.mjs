#!/usr/bin/env node
/**
 * Greenfield parity benchmark: `docx-markdoc create` vs a python-docx renderer.
 *
 * Renders one synthetic board consent both ways and scores seven axes:
 * Word-clean, PDF fidelity, style correctness, determinism, read-back
 * equality, brownfield editability, and authoring effort.
 *
 *   npm run build -w @usejunior/docx-markdoc
 *   node packages/docx-markdoc/benchmarks/python-docx-parity/run.mjs <out-dir> [--word-probe <probe.sh>]
 *
 * Needs `uv` (python-docx is fetched pinned per run), LibreOffice and
 * pdftotext for the PDF axis, and xmllint for the schema check. A missing tool
 * marks that axis `not_run`; it is never scored as a pass.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { parseXml } from '@usejunior/docx-core';
import {
  compileMarkdoc,
  createDocumentFromMarkdoc,
  importDocxToMarkdoc,
  readCreatedDocx,
} from '../../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const args = process.argv.slice(2);
const outDir = path.resolve(args[0] ?? path.join(os.tmpdir(), 'greenfield-parity'));
const probeIndex = args.indexOf('--word-probe');
const wordProbe = probeIndex >= 0 ? args[probeIndex + 1] : undefined;
mkdirSync(outDir, { recursive: true });

const PYTHON_DOCX = 'python-docx==1.2.0';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const which = (tool) => spawnSync('which', [tool], { encoding: 'utf8' }).status === 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- builders
async function buildSafeDocx() {
  const created = await createDocumentFromMarkdoc(readFileSync(path.join(here, 'resolution.mdoc'), 'utf8'));
  return created.docx;
}

function buildPython(target) {
  execFileSync('uv', ['run', '-q', '--with', PYTHON_DOCX, 'python', path.join(here, 'python_docx_baseline.py'), path.join(here, 'resolution.legacy.mdoc'), target], { stdio: 'pipe' });
  return readFileSync(target);
}

// ------------------------------------------------------- expected projections
/** Independent projection of the legacy source, mirroring what the python renderer promises. */
function legacyProjection() {
  const raw = readFileSync(path.join(here, 'resolution.legacy.mdoc'), 'utf8');
  const body = raw.split('---\n').slice(2).join('---\n');
  const strip = (text) => text.replace(/\\\n/g, '\n').replace(/\*\*/g, '').replace(/\*/g, '');
  const out = [];
  for (const block of body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    // The synthetic legacy source uses three fixed layout markers; none carries text.
    if (block.startsWith('<!-- ') && block.endsWith(' -->')) continue;
    const signer = /^<signer>(.+?) \| (.+?)<\/signer>$/.exec(block);
    if (signer) { out.push(`${'_'.repeat(30)}\n${signer[1]}\t${signer[2]}`); continue; }
    if (block.startsWith('|')) {
      for (const line of block.split('\n')) {
        if (/^\|[\s:|-]+\|$/.test(line)) continue;
        for (const cell of line.replace(/^\||\|$/g, '').split('|')) out.push(strip(cell.trim()));
      }
      continue;
    }
    out.push(strip(block.replace(/^#+ |^> |^<center>|<\/center>$|^<legend>|<\/legend>$/g, '')));
  }
  return out;
}

// ------------------------------------------------------------------ axes
function schemaCheck(docxPath) {
  if (!which('xmllint')) return { status: 'not_run', detail: 'xmllint missing' };
  const result = spawnSync('node', [path.join(repo, 'scripts/check_emitted_document_schema.mjs'), docxPath], { encoding: 'utf8' });
  return { status: result.status === 0 ? 'pass' : 'fail', detail: (result.stdout + result.stderr).trim().split('\n').at(-1) };
}

function wordCheck(docxPath) {
  if (!wordProbe || !existsSync(wordProbe)) return { status: 'not_run', detail: 'pass --word-probe <word-fidelity-check probe.sh> on macOS with Word' };
  const result = spawnSync(wordProbe, [docxPath], { encoding: 'utf8', timeout: 180_000 });
  const line = (result.stdout + result.stderr).split('\n').find((l) => l.includes(path.basename(docxPath))) ?? (result.stdout + result.stderr).trim();
  // Only a repair/recovery dialog naming this file is a fidelity failure. A probe that cannot get a read
  // (Word busy, ghost documents, sandbox prompts) is indeterminate, never a pass and never this file's failure.
  const status = /DIALOG ::/.test(line) ? 'fail' : /clean/.test(line) && !/INDETERMINATE|NO DOCUMENT LOADED/.test(line) ? 'pass' : 'indeterminate';
  return { status, detail: line.trim() };
}

function renderPdf(docxPath) {
  if (!which('soffice') || !which('pdftotext')) return null;
  const profile = mkdtempSync(path.join(os.tmpdir(), 'parity-lo-'));
  try {
    execFileSync('soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', path.dirname(docxPath), docxPath], { stdio: 'pipe', timeout: 180_000 });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  const pdf = docxPath.replace(/\.docx$/, '.pdf');
  const pages = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).split('\f').filter((p) => p.trim());
  if (which('pdftoppm')) execFileSync('pdftoppm', ['-r', '60', '-png', pdf, pdf.replace(/\.pdf$/, '-page')]);
  return { pdf, pages };
}

/** Every read-back paragraph appears in the PDF text, in order; each page carries its footer. */
function pdfFidelity(rendered, readback) {
  if (!rendered) return { status: 'not_run', detail: 'LibreOffice or pdftotext missing' };
  const collapse = (text) => text.replace(/\s+/g, ' ').trim();
  const text = collapse(rendered.pages.join(' '));
  let cursor = 0;
  const missing = [];
  for (const paragraph of readback.paragraphs.map(collapse).filter(Boolean)) {
    const found = text.indexOf(paragraph, cursor);
    if (found === -1) missing.push(paragraph.slice(0, 50));
    else cursor = found + paragraph.length;
  }
  const footers = readback.footers.map((footer) => (footer ?? []).filter((line) => line !== '<PAGE>'));
  const pageFooterOk = rendered.pages.length === 2
    && /\n\s*1\s*$/.test(rendered.pages[0].trimEnd() + '\n') === true
    && footers[1]?.every((line) => collapse(rendered.pages[1]).includes(collapse(line)));
  const ok = missing.length === 0 && rendered.pages.length === 2 && pageFooterOk;
  return { status: ok ? 'pass' : 'fail', detail: `${rendered.pages.length} pages; ${missing.length} paragraphs missing in order${missing.length ? ` (${missing.join(' | ')})` : ''}; page-1 number + page-2 footer ${pageFooterOk ? 'ok' : 'wrong'}` };
}

async function styleChecks(docx) {
  const zip = await JSZip.loadAsync(docx);
  const parse = async (name) => (zip.file(name) ? parseXml(await zip.file(name).async('string')) : null);
  const document = await parse('word/document.xml');
  const styles = await parse('word/styles.xml');
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS(W, tag));
  const attr = (el, name) => el?.getAttributeNS(W, name) || el?.getAttribute(`w:${name}`) || null;
  const styleById = new Map(byTag(styles, 'style').map((style) => [attr(style, 'styleId'), style]));
  const bodyParagraphs = byTag(document, 'p');
  const runText = (p) => byTag(p, 't').map((t) => t.textContent).join('');
  const docLevelFonts = [...byTag(styles, 'rPrDefault'), ...(styleById.get('Normal') ? [styleById.get('Normal')] : [])]
    .flatMap((el) => byTag(el, 'rFonts'))
    .some((fonts) => ['ascii', 'hAnsi', 'eastAsia', 'cs'].every((slot) => attr(fonts, slot) === 'Times New Roman'));
  const directFontRuns = byTag(document, 'r').filter((run) => byTag(run, 'rFonts').length > 0).length;
  const headingTexts = ['Approval of the Widget Plan', 'Issuance of Shares', 'General Authority'];
  const headingParagraphs = bodyParagraphs.filter((p) => headingTexts.some((h) => runText(p).endsWith(h)));
  const headingStyled = headingParagraphs.length === 3 && headingParagraphs.every((p) => {
    const id = attr(byTag(p, 'pStyle')[0], 'val');
    const name = id ? attr(byTag(styleById.get(id) ?? styles, 'name')[0], 'val') : null;
    return /^heading [1-9]$/i.test(name ?? '');
  });
  const numbered = bodyParagraphs.filter((p) => byTag(p, 'numPr').length > 0).length;
  const literalNumbers = bodyParagraphs.filter((p) => /^(\d+\.|\([a-z]\))\s/.test(runText(p))).length;
  const emptyParagraphs = bodyParagraphs.filter((p) => !runText(p).trim() && byTag(p, 'tab').length === 0 && !p.parentNode?.localName?.includes('tc')).length;
  const highlighted = byTag(document, 'highlight').length > 0;
  const tabStop = byTag(document, 'tab').some((tab) => tab.parentNode?.localName === 'tabs')
    || byTag(styles, 'tabs').length > 0;
  const headerRow = byTag(document, 'tblHeader').length > 0;
  const checks = {
    'house font pinned once at document level (all 4 rFonts channels)': docLevelFonts,
    'body runs carry no direct font (formatting lives in styles)': directFontRuns === 0,
    'headings use Word heading styles (navigation pane, TOC)': headingStyled,
    'clauses and sub-clauses use real numbering (renumber on edit)': numbered >= 5 && literalNumbers === 0,
    'no empty spacer paragraphs': emptyParagraphs === 0,
    'fill-ins highlighted': highlighted,
    'signer dates aligned by a tab stop': tabStop,
    'table header row repeats across pages': headerRow,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { status: passed === Object.keys(checks).length ? 'pass' : 'partial', score: `${passed}/${Object.keys(checks).length}`, checks, detail: `${directFontRuns} runs with direct fonts; ${numbered} numbered paragraphs; ${literalNumbers} literal numbers; ${emptyParagraphs} empty paragraphs` };
}

function readbackEquality(readback, expected) {
  const mismatch = expected.findIndex((paragraph, index) => readback.paragraphs[index] !== paragraph);
  const lengthOk = expected.length === readback.paragraphs.length;
  const ok = mismatch === -1 && lengthOk;
  return {
    status: ok ? 'pass' : 'fail',
    detail: ok ? `${expected.length} paragraphs equal` : `first mismatch at ${mismatch === -1 ? expected.length : mismatch + 1}: expected ${JSON.stringify(expected[mismatch] ?? null)}, read ${JSON.stringify(readback.paragraphs[mismatch === -1 ? expected.length : mismatch] ?? null)}`,
  };
}

/**
 * Import into the brownfield flow and make two realistic edits, each of which
 * must compile to a redline whose only revision is the edit:
 *   1. in-run: "carry out these resolutions" -> "carry out and perform these resolutions";
 *   2. fill-in boundary: "reserves [Number]" -> "reserves up to [Number]".
 * Edit 2 is retried with the documented `format-source` hint when the bare
 * edit fails closed; the axis records whether the hint was needed.
 */
async function brownfield(docx) {
  const imported = await importDocxToMarkdoc(docx);
  const edits = [
    { name: 'in-run', target: 'carry out these resolutions', replacement: 'carry out and perform these resolutions', inserted: 'and perform ', hint: 'each officer is authorized' },
    { name: 'fill-in boundary', target: 'The Widget Plan reserves ', replacement: 'The Widget Plan reserves up to ', inserted: 'up to ', hint: 'The Widget Plan reserves' },
  ];
  const outcomes = [];
  for (const edit of edits) {
    const block = imported.markdoc.split('\n\n').find((chunk) => chunk.startsWith('{% para ') && chunk.includes(edit.target));
    if (!block) { outcomes.push({ edit: edit.name, ok: false, detail: 'target paragraph not anchored' }); continue; }
    const header = /^\{% para (id="[^"]+" fingerprint="[^"]+" style="[^"]+") %\}\n([\s\S]*)\n\{% \/para %\}$/.exec(block);
    const before = header[2];
    const after = before.replace(edit.target, edit.replacement);
    const attempt = async (hint) => {
      const attrs = `${header[1]} edit="benchmark-edit" format="inherit-source-paragraph"${hint ? ` format-source="${hint}"` : ''}`;
      const revised = imported.markdoc.replace(block, `{% change ${attrs} %}\n{% before %}\n${before}\n{% /before %}\n{% after %}\n${after}\n{% /after %}\n{% /change %}`);
      const result = await compileMarkdoc(imported.anchoredSource, revised, { date: new Date('2026-10-07T00:00:00Z') });
      const tracked = parseXml(await (await JSZip.loadAsync(result.tracked)).file('word/document.xml').async('string'));
      const insertions = Array.from(tracked.getElementsByTagNameNS(W, 'ins'))
        .flatMap((ins) => Array.from(ins.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '')).join('');
      const deletions = tracked.getElementsByTagNameNS(W, 'del').length;
      return { ok: result.certificate.deliveryReady && insertions.trim() === edit.inserted.trim() && deletions === 0, insertions, deletions };
    };
    try {
      const bare = await attempt();
      outcomes.push({ edit: edit.name, ok: bare.ok, hint: false, detail: `inserted ${JSON.stringify(bare.insertions)}, ${bare.deletions} deletions` });
    } catch (error) {
      if (error.code !== 'MIXED_FORMATTING_REQUIRES_DETAIL') { outcomes.push({ edit: edit.name, ok: false, detail: `${error.code}: ${error.message}` }); continue; }
      try {
        const hinted = await attempt(edit.hint);
        outcomes.push({ edit: edit.name, ok: hinted.ok, hint: true, detail: `needed format-source; inserted ${JSON.stringify(hinted.insertions)}, ${hinted.deletions} deletions` });
      } catch (retry) {
        outcomes.push({ edit: edit.name, ok: false, hint: true, detail: `${retry.code}: ${retry.message}` });
      }
    }
  }
  const ok = outcomes.every((outcome) => outcome.ok);
  const hinted = outcomes.filter((outcome) => outcome.hint).map((outcome) => outcome.edit);
  return {
    status: ok ? (hinted.length ? 'pass*' : 'pass') : 'fail',
    detail: `${imported.source.paragraphs} paragraphs anchored; ${outcomes.map((o) => `${o.edit}: ${o.ok ? 'ok' : 'FAIL'}${o.hint ? ' (format-source)' : ''} – ${o.detail}`).join('; ')}`,
    outcomes,
  };
}

function effort() {
  const meaningful = (file, comment) => readFileSync(path.join(here, file), 'utf8').split('\n').filter((line) => line.trim() && !line.trim().startsWith(comment)).length;
  const pythonCode = readFileSync(path.join(here, 'python_docx_baseline.py'), 'utf8').replace(/"""[\s\S]*?"""/, '');
  const pythonLines = pythonCode.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).length;
  return {
    safeDocx: { sourceLines: meaningful('resolution.mdoc', '<!--'), rendererLines: 0, note: 'renderer is the published `docx-markdoc create` CLI' },
    python: { sourceLines: meaningful('resolution.legacy.mdoc', '\u0000'), rendererLines: pythonLines, note: 'renderer script copied into each matter' },
  };
}

// ------------------------------------------------------------------- main
const results = { generatedAt: 'not recorded (keeps the results file deterministic)', tools: { pythonDocx: PYTHON_DOCX }, safeDocx: {}, python: {} };
const sdPath = path.join(outDir, 'safe-docx.docx');
const pyPath = path.join(outDir, 'python-docx.docx');

const sd1 = await buildSafeDocx();
writeFileSync(sdPath, sd1);
const hasUv = which('uv');
const py1 = hasUv ? buildPython(pyPath) : null;
await sleep(2_500); // zip timestamps have 2-second granularity; give the clock a chance to show through
const sd2 = await buildSafeDocx();
const py2 = hasUv ? buildPython(path.join(outDir, 'python-docx-second.docx')) : null;

for (const [side, docx, second, docxPath, expected] of [
  ['safeDocx', sd1, sd2, sdPath, null],
  ['python', py1, py2, pyPath, legacyProjection()],
]) {
  if (!docx) { results[side] = { status: 'not_run', detail: 'uv missing' }; continue; }
  const readback = await readCreatedDocx(docx);
  const rendered = renderPdf(docxPath);
  const projection = expected ?? (await createDocumentFromMarkdoc(readFileSync(path.join(here, 'resolution.mdoc'), 'utf8'))).lowering.projection.paragraphs;
  results[side] = {
    wordClean: { schema: schemaCheck(docxPath), word: wordCheck(docxPath) },
    pdfFidelity: pdfFidelity(rendered, readback),
    styleCorrectness: await styleChecks(docx),
    determinism: { status: sha(docx) === sha(second) ? 'pass' : 'fail', detail: `${sha(docx).slice(0, 12)} vs ${sha(second).slice(0, 12)}` },
    readbackEquality: readbackEquality(readback, projection),
    brownfieldEdit: await brownfield(docx),
  };
}
results.authoringEffort = effort();
writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const cell = (value) => (value?.score ? `${value.status} (${value.score})` : value?.status ?? 'n/a');
const rows = [
  ['Word opens clean: XSD', (r) => cell(r.wordClean?.schema)],
  ['Word opens clean: Word for Mac', (r) => cell(r.wordClean?.word)],
  ['PDF fidelity (LibreOffice)', (r) => cell(r.pdfFidelity)],
  ['Style correctness', (r) => cell(r.styleCorrectness)],
  ['Determinism (byte-identical rebuild)', (r) => cell(r.determinism)],
  ['Read-back text equality', (r) => cell(r.readbackEquality)],
  ['Brownfield edit → clean redline', (r) => cell(r.brownfieldEdit)],
];
const lines = ['| Axis | safe-docx `create` | python-docx |', '|---|---|---|', ...rows.map(([label, get]) => `| ${label} | ${get(results.safeDocx)} | ${get(results.python)} |`)];
const e = results.authoringEffort;
lines.push(`| Authoring effort (source lines + renderer lines) | ${e.safeDocx.sourceLines} + ${e.safeDocx.rendererLines} | ${e.python.sourceLines} + ${e.python.rendererLines} |`);
console.log(lines.join('\n'));
console.log('\n`pass*` = passed, but at least one edit needed the documented `format-source` hint. `indeterminate` = the Word probe could not get a read; neither pass nor fail.');
console.log(`Details: ${path.join(outDir, 'results.json')}`);
