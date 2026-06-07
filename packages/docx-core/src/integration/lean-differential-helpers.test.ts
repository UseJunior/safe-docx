/**
 * Lean↔TS Tier 2-helper differential harness (Tier 2.5, second increment).
 *
 * Runs the GENUINE Lean Tier 2 helpers — `Tier2.FieldStructure.validateFieldStructure`,
 * `Tier2.AcceptReject.accept`, `Tier2.AcceptReject.reject` (compiled to the
 * `leanHelperDifferential` executable from `verification/lean/DifferentialHelpers.lean`)
 * — against the production engine `validateFieldStructure`
 * (`packages/docx-core/src/baselines/atomizer/pipeline.ts`), `acceptAllChanges`, and
 * `rejectAllChanges` (`trackChangesAcceptorAst.ts`) over shared generated `Doc`s,
 * asserting agreement. This extends the LCS differential
 * (`lean-differential-lcs.test.ts`) to the accept/reject/validate surface the headline
 * `inv_field_001` theorem is actually about.
 *
 * The helpers take a serialized `document.xml` string (not a plain atom array), so this
 * harness adds a `Doc`→`document.xml` adapter (`renderDocToXml`) and, because the Lean
 * helpers return a structured `Doc` while the TS helpers return XML, compares
 * accept/reject on a canonical token projection (`docToTokens` / `xmlToTokens`) both
 * outputs reduce to. `validate` is a plain boolean.
 *
 * Wire protocol (one subprocess spawn amortized over the whole batch, chunked):
 *   stdin : { "cases":   [ { "doc": Doc } ] }
 *   stdout: { "results": [ { "validate": bool, "accept": Doc, "reject": Doc } ] }
 *
 * Faithful subset: the random generator stays inside the region where the Lean model and
 * the production engine provably agree — fldChar/instrText only in top-level runs;
 * delInstrText only in its one OOXML-legal home (inside a w:del, in an open pre-separate
 * field), where both engines agree; and every paragraph keeps a surviving top-level run.
 * Model gaps that live OUTSIDE that subset are pinned by explicit cases rather than hidden.
 * G1/G2 — the DeletedFieldCode locality constraint — are now CLOSED: the Lean model enforces
 * it (`add-lean-deleted-field-code-constraint`), so the two engines AGREE:
 *   G1  fldChar inside w:del            → Lean validate=false, TS validate=false  (agree)
 *   G2  delInstrText outside w:del      → Lean validate=false, TS validate=false  (agree)
 * G4 — the reject-side paragraph collapse — is also CLOSED, but as an ENGINE fidelity fix
 * rather than a Lean change: an ins-only paragraph whose paragraph MARK is untracked means text
 * inserted into a pre-existing paragraph, which Word/LibreOffice keep (empty) on reject. The TS
 * engine used to drop it via a content-based heuristic; reject is now purely mark-based, so it
 * keeps the empty paragraph, matching Lean (which never dropped it):
 *   G4  reject of an ins-only paragraph → Lean keeps an empty <w:p>, TS keeps empty <w:p>  (agree)
 * G3 — the accept-side paragraph collapse — is now also CLOSED, as a LEAN fidelity fix (the inverse
 * of G4): the old Lean `accept` OVER-DROPPED a paragraph whose body collapses to empty, while the TS
 * engine, LibreOffice, and Word all keep an empty <w:p> (an untracked paragraph mark is a pre-existing
 * paragraph). Lean `accept` was broadened to never drop, so the two engines now AGREE:
 *   G3  accept of an ins-wrappered      → Lean keeps an empty <w:p>, TS keeps empty <w:p>  (agree)
 *       paragraph that collapses to empty
 * One KNOWN gap remains, pinned as a characterization case (an ENGINE accept-side gap, the symmetric
 * analog of pre-#337 G4 — surfaced precisely by broadening Lean `accept`):
 *   G5  accept of a del-only paragraph  → Lean keeps an empty <w:p>, TS DROPS the paragraph
 *       whose mark is untracked           (closes when the TS engine accept path is made mark-based)
 *
 * Gating: when the executable is absent (a developer without the Lean toolchain, or an
 * un-built `.lake`), the suite is SKIPPED with a clear message so `npm test` stays green;
 * CI builds the exe so the comparison actually runs there.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { acceptAllChanges, rejectAllChanges } from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { validateFieldStructure } from '../baselines/atomizer/pipeline.js';
import { parseDocumentXml } from '../baselines/atomizer/xmlToWmlElement.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

// Named const (not an inline literal) so `scripts/validate_allure_test_labels.mjs` can
// map the `.openspec([LEAN-HELP-*])` tags deterministically to a feature.
const TEST_FEATURE = 'Lean Differential Harness (Tier 2 helpers)';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '17.16.5' });

const INTEGRATION_DIR = dirname(import.meta.url.replace('file://', ''));
const PROJECT_ROOT = join(INTEGRATION_DIR, '../../../..');
const LEAN_EXE = join(PROJECT_ROOT, 'verification/lean/.lake/build/bin/leanHelperDifferential');

// `LEAN_DIFF_EXHAUSTIVE=1` (the same flag the LCS harness honours, so one CI env var
// drives both) widens this into a larger RANDOMIZED sweep — not a true enumeration. The
// Doc grammar (wrappers, fields, nesting) makes exhaustive enumeration impractical, so we
// deliberately do not claim it; the fixed seed keeps the wider sweep reproducible.
const EXTENDED = process.env.LEAN_DIFF_EXHAUSTIVE === '1';
const SAMPLE_COUNT = EXTENDED ? 50_000 : 2000;
const LEAN_CHUNK = 10_000; // cases per subprocess spawn (memory-bounded batching)
const SPAWN_MAX_BUFFER = 256 * 1024 * 1024;
const TEST_TIMEOUT = EXTENDED ? 600_000 : 30_000;

// ---------------------------------------------------------------------------
// Wire types — the tagged-union JSON encoding of `Tier2.OoxmlModel.Doc`.
// ---------------------------------------------------------------------------

type WireFldChar = 'begin' | 'separate' | 'end';
type WireAtom =
  | { text: string }
  | { delText: string }
  | { instrText: string }
  | { delInstrText: string }
  | { fldChar: WireFldChar };
type WireBlock =
  | { run: { content: WireAtom[] } }
  | { ins: WireBlock[] }
  | { del: WireBlock[] }
  | { moveFrom: WireBlock[] }
  | { moveTo: WireBlock[] }
  | { other: { tag: string; children: WireBlock[] } };
type WireParagraph = { body: WireBlock[] };
type WireDoc = WireParagraph[];

interface HelperResult {
  validate: boolean;
  accept: WireDoc;
  reject: WireDoc;
}

/** Projected comparison surface for one case. */
interface Projection {
  validate: boolean;
  accept: string[];
  reject: string[];
}

interface Divergence {
  index: number;
  input: WireDoc;
  field: 'validate' | 'accept' | 'reject';
  ts: Projection;
  lean: Projection;
}

// Containers the engine descends through transparently — the OOXML referents of the
// Lean `other` block (it keeps them and recursively processes their children).
const OTHER_ALLOWLIST = ['w:hyperlink', 'w:sdtContent'] as const;

// ---------------------------------------------------------------------------
// Doc → document.xml adapter.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function atomToXml(a: WireAtom): string {
  if ('text' in a) return `<w:t xml:space="preserve">${esc(a.text)}</w:t>`;
  if ('delText' in a) return `<w:delText xml:space="preserve">${esc(a.delText)}</w:delText>`;
  if ('instrText' in a) return `<w:instrText xml:space="preserve">${esc(a.instrText)}</w:instrText>`;
  if ('delInstrText' in a) return `<w:delInstrText xml:space="preserve">${esc(a.delInstrText)}</w:delInstrText>`;
  return `<w:fldChar w:fldCharType="${a.fldChar}"/>`;
}

// Wrapper attributes are present for OOXML faithfulness; accept/reject key off tag names
// and the validator ignores them, so the exact values do not affect the comparison.
const WRAP_ATTRS = 'w:id="1" w:author="t" w:date="2020-01-01T00:00:00Z"';

function blockToXml(b: WireBlock): string {
  if ('run' in b) return `<w:r>${b.run.content.map(atomToXml).join('')}</w:r>`;
  if ('ins' in b) return `<w:ins ${WRAP_ATTRS}>${b.ins.map(blockToXml).join('')}</w:ins>`;
  if ('del' in b) return `<w:del ${WRAP_ATTRS}>${b.del.map(blockToXml).join('')}</w:del>`;
  if ('moveFrom' in b) return `<w:moveFrom ${WRAP_ATTRS}>${b.moveFrom.map(blockToXml).join('')}</w:moveFrom>`;
  if ('moveTo' in b) return `<w:moveTo ${WRAP_ATTRS}>${b.moveTo.map(blockToXml).join('')}</w:moveTo>`;
  return `<${b.other.tag}>${b.other.children.map(blockToXml).join('')}</${b.other.tag}>`;
}

function renderDocToXml(doc: WireDoc): string {
  const body = doc.map((p) => `<w:p>${p.body.map(blockToXml).join('')}</w:p>`).join('');
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

// ---------------------------------------------------------------------------
// Canonical token projection — Lean output Doc and TS output XML reduce to one
// order-preserving token grammar. Equal token streams ⇔ same paragraph / run /
// wrapper / atom structure (modulo the opaque markers + attributes the model abstracts).
// ---------------------------------------------------------------------------

function atomTokens(a: WireAtom): string {
  if ('text' in a) return `t:${a.text}`;
  if ('delText' in a) return `dt:${a.delText}`;
  if ('instrText' in a) return `it:${a.instrText}`;
  if ('delInstrText' in a) return `dit:${a.delInstrText}`;
  return `fc:${a.fldChar}`;
}

function blockTokens(b: WireBlock, out: string[]): void {
  if ('run' in b) {
    out.push('R[');
    for (const a of b.run.content) out.push(atomTokens(a));
    out.push(']');
  } else if ('ins' in b) {
    out.push('INS[');
    for (const c of b.ins) blockTokens(c, out);
    out.push(']');
  } else if ('del' in b) {
    out.push('DEL[');
    for (const c of b.del) blockTokens(c, out);
    out.push(']');
  } else if ('moveFrom' in b) {
    out.push('MF[');
    for (const c of b.moveFrom) blockTokens(c, out);
    out.push(']');
  } else if ('moveTo' in b) {
    out.push('MT[');
    for (const c of b.moveTo) blockTokens(c, out);
    out.push(']');
  } else {
    out.push(`OTHER:${b.other.tag}[`);
    for (const c of b.other.children) blockTokens(c, out);
    out.push(']');
  }
}

function docToTokens(doc: WireDoc): string[] {
  const out: string[] = [];
  for (const p of doc) {
    out.push('P[');
    for (const b of p.body) blockTokens(b, out);
    out.push(']');
  }
  return out;
}

function childElements(node: Element): Element[] {
  const result: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) result.push(child as Element);
  }
  return result;
}

const WRAP_TOKEN: Record<string, string> = {
  'w:ins': 'INS',
  'w:del': 'DEL',
  'w:moveFrom': 'MF',
  'w:moveTo': 'MT',
};
const SKIP_TAGS = new Set(['w:pPr', 'w:rPr']);

function xmlRunTokens(run: Element, out: string[]): void {
  out.push('R[');
  for (const child of childElements(run)) {
    const tag = child.tagName;
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'w:t') out.push(`t:${child.textContent ?? ''}`);
    else if (tag === 'w:delText') out.push(`dt:${child.textContent ?? ''}`);
    else if (tag === 'w:instrText') out.push(`it:${child.textContent ?? ''}`);
    else if (tag === 'w:delInstrText') out.push(`dit:${child.textContent ?? ''}`);
    else if (tag === 'w:fldChar') out.push(`fc:${child.getAttribute('w:fldCharType') ?? ''}`);
    else throw new Error(`unexpected run child <${tag}> in TS output`);
  }
  out.push(']');
}

function xmlBlockTokens(el: Element, out: string[]): void {
  const tag = el.tagName;
  if (SKIP_TAGS.has(tag)) return;
  if (tag === 'w:r') {
    xmlRunTokens(el, out);
    return;
  }
  if (tag in WRAP_TOKEN) {
    out.push(`${WRAP_TOKEN[tag]}[`);
    for (const child of childElements(el)) xmlBlockTokens(child, out);
    out.push(']');
    return;
  }
  if ((OTHER_ALLOWLIST as readonly string[]).includes(tag)) {
    out.push(`OTHER:${tag}[`);
    for (const child of childElements(el)) xmlBlockTokens(child, out);
    out.push(']');
    return;
  }
  throw new Error(`unexpected block <${tag}> in TS output`);
}

function xmlToTokens(xml: string): string[] {
  const root = parseDocumentXml(xml);
  const bodies = root.getElementsByTagName('w:body');
  const body = bodies.length > 0 ? (bodies[0] as Element) : root;
  const out: string[] = [];
  for (const p of childElements(body)) {
    if (p.tagName !== 'w:p') continue; // ignore w:sectPr etc. (not generated)
    out.push('P[');
    for (const child of childElements(p)) xmlBlockTokens(child, out);
    out.push(']');
  }
  return out;
}

// ---------------------------------------------------------------------------
// TS-side and Lean-side projections.
// ---------------------------------------------------------------------------

function tsProjection(doc: WireDoc): Projection {
  const xml = renderDocToXml(doc);
  return {
    validate: validateFieldStructure(xml),
    accept: xmlToTokens(acceptAllChanges(xml)),
    reject: xmlToTokens(rejectAllChanges(xml)),
  };
}

function leanProjection(r: HelperResult): Projection {
  return { validate: r.validate, accept: docToTokens(r.accept), reject: docToTokens(r.reject) };
}

/** Run the genuine Lean exe over a doc batch, spawning once per chunk. */
function leanHelperBatch(docs: WireDoc[]): HelperResult[] {
  const out: HelperResult[] = [];
  for (let i = 0; i < docs.length; i += LEAN_CHUNK) {
    const chunk = docs.slice(i, i + LEAN_CHUNK);
    const payload = JSON.stringify({ cases: chunk.map((doc) => ({ doc })) });
    const proc = spawnSync(LEAN_EXE, [], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: SPAWN_MAX_BUFFER,
    });
    if (proc.error) throw new Error(`leanHelperDifferential failed to spawn: ${proc.error.message}`);
    if (proc.status !== 0) throw new Error(`leanHelperDifferential exited ${proc.status}: ${proc.stderr}`);
    const parsed = JSON.parse(proc.stdout) as { results: HelperResult[] };
    out.push(...parsed.results);
  }
  return out;
}

function key(tokens: string[]): string {
  return JSON.stringify(tokens);
}

/** Compare TS vs Lean per case; collect divergences (empty array = full agreement). */
function findDivergences(docs: WireDoc[], leanResults: HelperResult[]): Divergence[] {
  const divergences: Divergence[] = [];
  for (let i = 0; i < docs.length; i++) {
    const ts = tsProjection(docs[i]!);
    const lean = leanProjection(leanResults[i]!);
    let field: Divergence['field'] | null = null;
    if (ts.validate !== lean.validate) field = 'validate';
    else if (key(ts.accept) !== key(lean.accept)) field = 'accept';
    else if (key(ts.reject) !== key(lean.reject)) field = 'reject';
    if (field !== null) divergences.push({ index: i, input: docs[i]!, field, ts, lean });
  }
  return divergences;
}

// ---------------------------------------------------------------------------
// Faithful-subset generator (Decision 5).
// ---------------------------------------------------------------------------

const textAtom: fc.Arbitrary<WireAtom> = fc.constantFrom('a', 'b').map((s) => ({ text: s }));
const delTextAtom: fc.Arbitrary<WireAtom> = fc.constantFrom('x', 'y').map((s) => ({ delText: s }));

const textRun: fc.Arbitrary<WireBlock> = fc
  .array(textAtom, { minLength: 1, maxLength: 2 })
  .map((content) => ({ run: { content } }));
const delRun: fc.Arbitrary<WireBlock> = fc
  .array(delTextAtom, { minLength: 1, maxLength: 2 })
  .map((content) => ({ run: { content } }));

const insBlock: fc.Arbitrary<WireBlock> = fc
  .array(textRun, { minLength: 1, maxLength: 2 })
  .map((children) => ({ ins: children }));
const delBlock: fc.Arbitrary<WireBlock> = fc
  .array(delRun, { minLength: 1, maxLength: 2 })
  .map((children) => ({ del: children }));
const moveFromBlock: fc.Arbitrary<WireBlock> = fc
  .array(delRun, { minLength: 1, maxLength: 2 })
  .map((children) => ({ moveFrom: children }));
const moveToBlock: fc.Arbitrary<WireBlock> = fc
  .array(textRun, { minLength: 1, maxLength: 2 })
  .map((children) => ({ moveTo: children }));
const otherBlock: fc.Arbitrary<WireBlock> = fc
  .record({ tag: fc.constantFrom(...OTHER_ALLOWLIST), children: fc.array(textRun, { minLength: 1, maxLength: 2 }) })
  .map((other) => ({ other }));

// Helpers to build top-level field fragments (always outside any wrapper, so G1/G2 cannot
// trigger). Both well-formed (validate=true) and malformed (validate=false) variants are
// generated; every malformed variant below is rejected by BOTH engines identically.
const fc_begin: WireBlock = { run: { content: [{ fldChar: 'begin' }] } };
const fc_sep: WireBlock = { run: { content: [{ fldChar: 'separate' }] } };
const fc_end: WireBlock = { run: { content: [{ fldChar: 'end' }] } };
const instr = (s: string): WireBlock => ({ run: { content: [{ instrText: s }] } });

// A `delInstrText` in its only OOXML-legal home: inside a `w:del`, in an open pre-separate
// field. Both engines agree here (Lean walks transparently through del; TS requires exactly
// insideDel + open-field), so this is the in-subset counterpart of the G2 characterization
// (which puts delInstrText OUTSIDE del and diverges). On reject it renames to instrText.
const delInstr = (s: string): WireBlock => ({ del: [{ run: { content: [{ delInstrText: s }] } }] });

// Both well-formed (validate=true) and malformed (validate=false) variants; every
// malformed variant below is rejected by BOTH engines identically (instr/end at depth 0,
// unbalanced begin/end, instr after separate), so they stay inside the agreeing subset.
const fieldFragmentArb: fc.Arbitrary<WireBlock[]> = fc.constantFrom(
  [fc_begin, instr('PAGE'), fc_sep, { run: { content: [{ text: 'a' }] } }, fc_end],
  [fc_begin, instr('PAGE'), fc_end],
  [fc_begin, delInstr('PAGE'), fc_sep, { run: { content: [{ text: 'a' }] } }, fc_end], // delInstrText inside del (legal)
  [fc_begin, delInstr('PAGE'), fc_end],
  [fc_begin, fc_sep, instr('PAGE'), fc_end],
  [instr('PAGE')],
  [fc_begin],
  [fc_end],
);

// Each "segment" is a list of blocks (so a multi-block field fragment can be spliced in).
const segment: fc.Arbitrary<WireBlock[]> = fc.oneof(
  textRun.map((b) => [b]),
  insBlock.map((b) => [b]),
  delBlock.map((b) => [b]),
  moveFromBlock.map((b) => [b]),
  moveToBlock.map((b) => [b]),
  otherBlock.map((b) => [b]),
  fieldFragmentArb,
);

// Every paragraph starts with a surviving top-level run (visible text), so accept never
// collapses it to empty and reject never treats it as ins-only — this is what keeps the
// paragraph-collapse corner cases (G3, and the G5 accept-side engine gap) out of the random
// subset; they are pinned as explicit characterization cases instead.
const paragraphArb: fc.Arbitrary<WireParagraph> = fc
  .tuple(textRun, fc.array(segment, { minLength: 0, maxLength: 3 }))
  .map(([survivor, segs]) => ({ body: [survivor, ...segs.flat()] }));

const docArb: fc.Arbitrary<WireDoc> = fc.array(paragraphArb, { minLength: 1, maxLength: 3 });

const SEED_DOCS: WireDoc[] = [
  [{ body: [{ run: { content: [{ text: 'a' }] } }] }], // plain
  [{ body: [{ run: { content: [{ text: 'a' }] } }, { del: [{ run: { content: [{ delText: 'x' }] } }] }] }],
  [{ body: [{ run: { content: [{ text: 'a' }] } }, { ins: [{ run: { content: [{ text: 'b' }] } }] }] }],
  [{ body: [{ run: { content: [{ text: 'a' }] } }, { moveFrom: [{ run: { content: [{ delText: 'x' }] } }] }] }],
  [{ body: [{ run: { content: [{ text: 'a' }] } }, { moveTo: [{ run: { content: [{ text: 'b' }] } }] }] }],
  [{ body: [{ run: { content: [{ text: 'a' }] } }, ...[fc_begin, instr('PAGE'), fc_sep, { run: { content: [{ text: 'r' }] } }, fc_end]] }],
  // delInstrText in its legal home (inside del, open pre-separate field) — in-subset, agrees.
  [{ body: [{ run: { content: [{ text: 'a' }] } }, fc_begin, delInstr('PAGE'), fc_sep, { run: { content: [{ text: 'r' }] } }, fc_end] }],
  [{ body: [{ run: { content: [{ text: 'a' }] } }, { other: { tag: 'w:hyperlink', children: [{ run: { content: [{ text: 'b' }] } }] } }] }],
];

function buildDocs(): WireDoc[] {
  const sampled = fc.sample(docArb, { numRuns: SAMPLE_COUNT, seed: 0xf1e1d });
  return [...SEED_DOCS, ...sampled];
}

// ---------------------------------------------------------------------------
// Out-of-subset fixtures. G1/G2 are CLOSED (both engines agree — the Lean model
// enforces the DeletedFieldCode locality constraint); G3 (Lean accept broadened)
// and G4 (engine reject made mark-based) are also CLOSED and now AGREE. G5 is the
// one remaining characterized gap: a symmetric ENGINE accept-side over-deletion
// surfaced by broadening Lean `accept` (Lean keeps empty, TS drops).
// ---------------------------------------------------------------------------

/** G1: fldChar inside w:del — both engines now reject. */
const G1_DOC: WireDoc = [
  { body: [{ del: [{ run: { content: [{ fldChar: 'begin' }] } }] }, { run: { content: [{ fldChar: 'end' }] } }] },
];
/** G2: delInstrText in an open pre-separate field, outside w:del. */
const G2_DOC: WireDoc = [
  {
    body: [
      { run: { content: [{ fldChar: 'begin' }] } },
      { run: { content: [{ delInstrText: 'X' }] } },
      { run: { content: [{ fldChar: 'end' }] } },
    ],
  },
];
/** G3: a paragraph whose only content is an ins wrapping deleted content (accept side). */
const G3_DOC: WireDoc = [
  { body: [{ ins: [{ del: [{ run: { content: [{ delText: 'x' }] } }] }] }] },
  { body: [{ run: { content: [{ text: 'keep' }] } }] },
];
/** G4: an ins-only paragraph (reject side — the analog of G3 for reject). */
const G4_DOC: WireDoc = [
  { body: [{ ins: [{ run: { content: [{ text: 'b' }] } }] }] },
  { body: [{ run: { content: [{ text: 'keep' }] } }] },
];
/**
 * G5: a del-only paragraph whose mark is untracked (accept side). The SYMMETRIC analog of
 * pre-#337 G4 — broadening Lean `accept` to keep empties surfaces it: Lean now keeps the
 * collapsed paragraph as an empty <w:p>, while the TS engine accept path still drops a
 * del-only paragraph via a content-based heuristic (the accept-side mirror of the reject
 * over-deletion fixed in #337). LibreOffice/Word keep the empty paragraph, so the TS accept
 * path is the one that needs the (deferred) mark-based fix; Lean is already faithful.
 */
const G5_DOC: WireDoc = [
  { body: [{ del: [{ run: { content: [{ delText: 'x' }] } }] }] },
  { body: [{ run: { content: [{ text: 'keep' }] } }] },
];

const exeExists = existsSync(LEAN_EXE);
if (!exeExists) {
  // eslint-disable-next-line no-console
  console.warn(
    `[lean-differential-helpers] SKIP: ${LEAN_EXE} not found. ` +
      `Build it with: (cd verification/lean && lake build leanHelperDifferential)`,
  );
}
const describeMaybe = exeExists ? describe : describe.skip;

describeMaybe('Lean Differential Harness - Tier 2 helper extensional equivalence', () => {
  test
    .openspec('[LEAN-HELP-01] Compiled Lean accept/reject/validate match the TS engine on generated docs in the faithful subset')
    .openspec('[LEAN-HELP-02] Harness skips cleanly without the Lean toolchain and runs in CI')(
    'genuine Lean accept/reject/validate and the TS engine agree on every generated doc',
    async ({ given, when, then }: AllureBddContext) => {
      let docs: WireDoc[] = [];
      let leanResults: HelperResult[] = [];

      await given(
        `${SEED_DOCS.length} seeded docs plus ${SAMPLE_COUNT} random docs within the faithful subset`,
        async () => {
          docs = buildDocs();
        },
      );

      await when('each doc is rendered to document.xml, run through the TS engine and the spawned Lean exe', async () => {
        leanResults = leanHelperBatch(docs);
        expect(leanResults.length).toBe(docs.length);
      });

      await then('validate, and the accept/reject token projections, are identical on every case', async () => {
        const divergences = findDivergences(docs, leanResults);
        expect(
          divergences.length,
          divergences.length === 0
            ? ''
            : `${divergences.length}/${docs.length} cases diverged. First (${divergences[0]!.field}): ${JSON.stringify(divergences[0])}`,
        ).toBe(0);
      });
    },
    TEST_TIMEOUT,
  );

  test
    .openspec('[LEAN-HELP-03] G1 — fldChar inside w:del: Lean and TS validate agree (both reject)')
    .openspec('[LEAN-DFC-01] fldChar inside w:del is rejected by both engines')(
    'fldChar inside w:del: Lean validate=false, TS validate=false (constraint (3) modeled)',
    async ({ given, when, then }: AllureBddContext) => {
      let lean: HelperResult;
      await given('a doc with a w:fldChar inside a w:del wrapper', async () => {
        lean = leanHelperBatch([G1_DOC])[0]!;
      });
      let tsValidate = true;
      await when('both engines validate it', async () => {
        tsValidate = validateFieldStructure(renderDocToXml(G1_DOC));
      });
      await then('both reject it (false): the Lean model now enforces the DeletedFieldCode locality constraint', async () => {
        expect(lean!.validate).toBe(false);
        expect(tsValidate).toBe(false);
        expect(lean!.validate).toBe(tsValidate);
      });
    },
  );

  test
    .openspec('[LEAN-HELP-04] G2 — delInstrText outside w:del: Lean and TS validate agree (both reject)')
    .openspec('[LEAN-DFC-02] delInstrText outside w:del is rejected by both engines')(
    'delInstrText outside w:del: Lean validate=false, TS validate=false (constraint (3) modeled)',
    async ({ given, when, then }: AllureBddContext) => {
      let lean: HelperResult;
      await given('a doc with a delInstrText in an open pre-separate field outside any w:del', async () => {
        lean = leanHelperBatch([G2_DOC])[0]!;
      });
      let tsValidate = true;
      await when('both engines validate it', async () => {
        tsValidate = validateFieldStructure(renderDocToXml(G2_DOC));
      });
      await then('both reject it (false): delInstrText is confined to a w:del ancestor in both models', async () => {
        expect(lean!.validate).toBe(false);
        expect(tsValidate).toBe(false);
        expect(lean!.validate).toBe(tsValidate);
      });
    },
  );

  test.openspec('[LEAN-DFC-03] Legal delInstrText inside an open field inside w:del still validates')(
    'delInstrText inside w:del in an open pre-separate field: Lean and TS both accept (true)',
    async ({ given, when, then }: AllureBddContext) => {
      // Field opened at top level, delInstrText nested inside a w:del while the field is
      // open and pre-separate — the one OOXML-legal home. The del-ancestry gate is
      // orthogonal to the field context that crosses the w:del boundary.
      const LEGAL_DOC: WireDoc = [
        {
          body: [
            { run: { content: [{ fldChar: 'begin' }] } },
            { del: [{ run: { content: [{ delInstrText: 'PAGE' }] } }] },
            { run: { content: [{ fldChar: 'separate' }, { text: 'a' }, { fldChar: 'end' }] } },
          ],
        },
      ];
      let lean: HelperResult;
      await given('a doc with a delInstrText in its one OOXML-legal home (inside w:del, open pre-separate field)', async () => {
        lean = leanHelperBatch([LEGAL_DOC])[0]!;
      });
      let tsValidate = false;
      await when('both engines validate it', async () => {
        tsValidate = validateFieldStructure(renderDocToXml(LEGAL_DOC));
      });
      await then('both accept it (true): the del-ancestry gate does not disturb the legal in-del field code', async () => {
        expect(lean!.validate).toBe(true);
        expect(tsValidate).toBe(true);
        expect(lean!.validate).toBe(tsValidate);
      });
    },
  );

  test.openspec('[LEAN-HELP-05] G3 — accept paragraph-collapse now AGREES (Lean fidelity fix)')(
    'accept of an ins-wrappered collapsing paragraph: Lean and TS both keep an empty paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      let lean: HelperResult;
      await given('a doc whose first paragraph is only a w:ins wrapping deleted content', async () => {
        lean = leanHelperBatch([G3_DOC])[0]!;
      });
      let tsAccept: string[] = [];
      let leanAccept: string[] = [];
      await when('both engines accept it', async () => {
        tsAccept = xmlToTokens(acceptAllChanges(renderDocToXml(G3_DOC)));
        leanAccept = docToTokens(lean!.accept);
      });
      await then('both keep the collapsed paragraph as an empty P[ ] — Lean `accept` no longer over-drops', async () => {
        // The paragraph mark is UNTRACKED, so accepting the content edits (unwrap ins, drop del)
        // leaves an empty <w:p>: text edited inside a pre-existing paragraph, which the TS engine,
        // LibreOffice, and Word all keep. The old Lean model dropped it; broadening `accept` to keep
        // empties (the inverse of the G4 engine fix) makes the two agree.
        expect(leanAccept).toEqual(['P[', ']', 'P[', 'R[', 't:keep', ']', ']']);
        expect(tsAccept).toEqual(['P[', ']', 'P[', 'R[', 't:keep', ']', ']']);
        expect(key(tsAccept)).toBe(key(leanAccept));
      });
    },
  );

  test.openspec('[LEAN-HELP-06] G4 — reject paragraph-collapse now AGREES (engine fidelity fix)')(
    'reject of an ins-only paragraph (untracked mark): Lean and TS both keep an empty paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      let lean: HelperResult;
      await given('a doc whose first paragraph is only a w:ins (no surviving content)', async () => {
        lean = leanHelperBatch([G4_DOC])[0]!;
      });
      let tsReject: string[] = [];
      let leanReject: string[] = [];
      await when('both engines reject it', async () => {
        tsReject = xmlToTokens(rejectAllChanges(renderDocToXml(G4_DOC)));
        leanReject = docToTokens(lean!.reject);
      });
      await then('both keep the collapsed paragraph as an empty P[ ] — mark-based reject is Word-faithful', async () => {
        // The first paragraph's mark is UNTRACKED, so reject keeps it (now empty): an
        // ins-run under an untracked mark means text inserted into a pre-existing
        // paragraph, which Word and LibreOffice both keep on reject. The engine's old
        // content-based drop over-deleted it; the mark-based reject now matches Lean.
        expect(leanReject).toEqual(['P[', ']', 'P[', 'R[', 't:keep', ']', ']']);
        expect(tsReject).toEqual(['P[', ']', 'P[', 'R[', 't:keep', ']', ']']);
        expect(key(tsReject)).toBe(key(leanReject));
      });
    },
  );

  test.openspec('[LEAN-HELP-08] G5 — accept paragraph-collapse for a del-only paragraph is a characterized divergence')(
    'accept of a del-only untracked-mark paragraph: Lean keeps an empty <w:p>, the TS engine drops it',
    async ({ given, when, then }: AllureBddContext) => {
      let lean: HelperResult;
      await given('a doc whose first paragraph is only a w:del (untracked paragraph mark)', async () => {
        lean = leanHelperBatch([G5_DOC])[0]!;
      });
      let tsAccept: string[] = [];
      let leanAccept: string[] = [];
      await when('both engines accept it', async () => {
        tsAccept = xmlToTokens(acceptAllChanges(renderDocToXml(G5_DOC)));
        leanAccept = docToTokens(lean!.accept);
      });
      await then('Lean keeps the empty paragraph (faithful) while the TS engine over-deletes it', async () => {
        // SYMMETRIC analog of pre-#337 G4, surfaced by broadening Lean `accept`: the paragraph
        // mark is untracked, so accepting (dropping the del) leaves an empty <w:p> — which
        // LibreOffice and Word keep. Lean now keeps it; the TS engine accept path still drops a
        // del-only paragraph via a content-based heuristic (the accept-side mirror of the reject
        // over-deletion fixed in #337). The engine accept fix is the deferred follow-up; this case
        // pins the gap so it stays visible rather than silently passing.
        expect(leanAccept).toEqual(['P[', ']', 'P[', 'R[', 't:keep', ']', ']']);
        // TS over-deletes the empty first paragraph: only the survivor remains.
        expect(tsAccept).toEqual(['P[', 'R[', 't:keep', ']', ']']);
        expect(key(tsAccept)).not.toBe(key(leanAccept));
        expect(tsAccept.filter((t) => t === 'P[').length).toBe(1);
      });
    },
  );

  test.openspec('[LEAN-HELP-07] A real divergence is caught, not masked')(
    'the projection comparison flags a perturbed result rather than passing vacuously',
    async ({ given, when, then }: AllureBddContext) => {
      const doc: WireDoc = [
        { body: [{ run: { content: [{ text: 'a' }] } }, { del: [{ run: { content: [{ delText: 'x' }] } }] }] },
      ];
      let real: HelperResult;
      await given('a doc where the genuine Lean and TS projections agree', async () => {
        real = leanHelperBatch([doc])[0]!;
        expect(findDivergences([doc], [real]).length).toBe(0);
      });
      let perturbed: HelperResult;
      await when('the Lean-side accept/reject outputs are swapped', async () => {
        perturbed = { validate: real!.validate, accept: real!.reject, reject: real!.accept };
      });
      await then('findDivergences reports the perturbed case, proving the check is load-bearing', async () => {
        const divergences = findDivergences([doc], [perturbed!]);
        expect(divergences.length).toBe(1);
        expect(divergences[0]!.field).toBe('accept');
      });
    },
  );
});
