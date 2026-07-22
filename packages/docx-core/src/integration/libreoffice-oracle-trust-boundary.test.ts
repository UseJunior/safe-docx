/**
 * LibreOffice accept/reject oracle — trust-boundary characterization.
 *
 * The oracle (`libreoffice-oracle.ts`) is trusted as accept/reject ground truth for the
 * differential harness. This file pins down WHERE that trust ends, so the boundary cannot
 * silently erode across LibreOffice upgrades (vetted on LibreOffice 25.8.7.3, 2026-06):
 *
 * 1. TRUSTWORTHY: the resolved text and paragraph shape after `.uno:AcceptAllTrackedChanges` /
 *    `.uno:RejectAllTrackedChanges`, even for stacked multi-author revisions and `w:del`-nested-
 *    in-`w:ins` shapes. The dispatch runs BEFORE `storeToURL`, so no unresolved tracked change
 *    ever reaches LibreOffice's DOCX save — the save defect below cannot bite the oracle.
 * 2. NOT TRUSTWORTHY: the plain save round-trip (`identity` op — load then save, no dispatch)
 *    for a FULLY-deleted insertion (`<w:ins authorA><w:del authorB>…all of the inserted
 *    text…</w:del></w:ins>`). LibreOffice silently drops the `<w:ins>` wrapper, collapsing
 *    "inserted then deleted" into "original text deleted". Non-nested multi-author stacks and
 *    partial deletions with surviving inserted text round-trip cleanly — the defect is specific
 *    to the all-of-the-insertion-deleted case. Characterized here so a future LibreOffice fix
 *    trips the test and we update the note.
 * 3. BLIND: `paragraphShape` records only paragraph count + visible-text presence, by design —
 *    the oracle cannot guard formatting fidelity (tracked separately).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5
 * @see https://github.com/UseJunior/safe-docx/issues/362 (trust-boundary characterization)
 * @see https://github.com/UseJunior/safe-docx/issues/346 (upstream LibreOffice bug filing)
 */
import { beforeAll, describe, expect } from 'vitest';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';
import { parseXml } from '../primitives/xml.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  resolveSoffice,
  runLibreOfficeOracle,
  paragraphShape,
  type OracleJob,
} from './libreoffice-oracle.js';

// Named const (not an inline literal) so `scripts/validate_allure_test_labels.mjs` can
// map the `.openspec([LO-ORACLE-TRUST-*])` tags deterministically to a feature.
const TEST_FEATURE = 'LibreOffice Oracle Trust Boundary';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rawDoc = (inner: string): string =>
  `<?xml version="1.0"?><w:document xmlns:w="${W_NS}"><w:body>${inner}</w:body></w:document>`;
const mark = (id: number, author: string): string =>
  `w:id="${id}" w:author="${author}" w:date="2026-01-0${author === 'reviewerA' ? 1 : 2}T00:00:00Z"`;
const A = mark(1, 'reviewerA');
const B = mark(2, 'reviewerB');

/** Visible (non-deleted) text of a document.xml, whitespace-normalized. LibreOffice rewrites
 *  run boundaries and may renormalize spaces on save, so the comparison collapses whitespace —
 *  the discriminating content (`NEW` vs `ORIG`, `ABEF` vs empty) is whitespace-insensitive. */
function visibleText(documentXml: string): string {
  const doc = parseXml(documentXml);
  const texts = doc.getElementsByTagNameNS(W_NS, 't');
  let out = '';
  for (let i = 0; i < texts.length; i++) out += texts.item(i)!.textContent ?? '';
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Fixtures — the `.tmp/lo-oracle-vet/` vetting set, committed. Each is a single body paragraph
// (these are the SUBJECT of the characterization, so they stay inline per AGENTS.md).
// ---------------------------------------------------------------------------

// Baselines: a single-author insertion / deletion next to untracked text.
const SIMPLE_INS = rawDoc(
  `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r><w:ins ${A}><w:r><w:t>NEW</w:t></w:r></w:ins></w:p>`,
);
const SIMPLE_DEL = rawDoc(
  `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r><w:del ${A}><w:r><w:delText>OLD</w:delText></w:r></w:del></w:p>`,
);
// reviewerA inserted "INSERTED"; reviewerB then deleted ALL of it — the shape LibreOffice's
// save round-trip mangles. Accept and reject BOTH remove the text (it never belonged to the
// original, and the insertion did not survive review).
const NESTED_FULLY_DELETED_INS = rawDoc(
  `<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r><w:ins ${A}><w:del ${B}><w:r><w:delText>INSERTED</w:delText></w:r></w:del></w:ins></w:p>`,
);
// Discriminating non-nested multi-author stack: reviewerA deleted ORIG, reviewerB inserted NEW.
// Accept and reject produce DIFFERENT text, so a dispatch that silently failed (or hit the wrong
// document) cannot pass both assertions.
const DEL_INS_STACK = rawDoc(
  `<w:p><w:del ${A}><w:r><w:delText>ORIG</w:delText></w:r></w:del><w:ins ${B}><w:r><w:t>NEW</w:t></w:r></w:ins></w:p>`,
);
// Partial deletion inside an insertion with SURVIVING inserted text: reviewerA inserted "ABCDEF",
// reviewerB deleted only the "CD" of it.
const PARTIAL_DEL_IN_INS = rawDoc(
  `<w:p><w:ins ${A}><w:r><w:t xml:space="preserve">AB</w:t></w:r></w:ins>` +
    `<w:ins ${mark(3, 'reviewerA')}><w:del ${B}><w:r><w:delText>CD</w:delText></w:r></w:del></w:ins>` +
    `<w:ins ${mark(4, 'reviewerA')}><w:r><w:t xml:space="preserve">EF</w:t></w:r></w:ins></w:p>`,
);

type VetCase = { name: string; xml: string; accept: string; reject: string };
const VET_CASES: VetCase[] = [
  { name: 'simple-ins', xml: SIMPLE_INS, accept: 'keep NEW', reject: 'keep' },
  { name: 'simple-del', xml: SIMPLE_DEL, accept: 'keep', reject: 'keep OLD' },
  { name: 'nested-fully-deleted-ins', xml: NESTED_FULLY_DELETED_INS, accept: 'keep', reject: 'keep' },
  { name: 'del-ins-stack', xml: DEL_INS_STACK, accept: 'NEW', reject: 'ORIG' },
  { name: 'partial-del-in-ins', xml: PARTIAL_DEL_IN_INS, accept: 'ABEF', reject: '' },
];
// Identity (load->save, NO dispatch) probes LibreOffice's handling of UNRESOLVED tracked
// changes: the defect case plus the two shapes vetted as round-tripping cleanly.
const IDENTITY_CASES = ['nested-fully-deleted-ins', 'del-ins-stack', 'partial-del-in-ins'] as const;

// Gated on a LibreOffice binary; CI does not install one, so this is a local developer check
// (it skips cleanly, like the oracle voter in lean-differential-helpers.test.ts). Set
// SAFE_DOCX_SOFFICE_BIN to point at a binary in a non-standard location.
const soffice = resolveSoffice();
const describeOracle = soffice ? describe : describe.skip;
if (!soffice) {
  // eslint-disable-next-line no-console
  console.warn(
    '[libreoffice-oracle-trust-boundary] SKIP: no LibreOffice (soffice) binary found. ' +
      'Install LibreOffice or set SAFE_DOCX_SOFFICE_BIN to run the trust-boundary characterization.',
  );
}

describeOracle('LibreOffice oracle trust boundary — accept/reject is sound, the save round-trip is not', () => {
  // ONE headless LibreOffice launch drives the whole batch (accept + reject per vet case, then
  // the identity probes), keyed `${name}:${op}`.
  const loText: Record<string, string> = {};
  const loShape: Record<string, boolean[]> = {};
  const identityXml: Record<string, string> = {};
  // `resolveSoffice()` only checks that a binary EXISTS, not that it can LAUNCH (e.g. a sandboxed
  // macOS shell SIGABRTs soffice before it does any work). Record a skip reason and no-op the
  // assertions rather than fail — the oracle is a best-effort local check.
  let oracleSkip = '';
  beforeAll(async () => {
    const jobs: OracleJob[] = [];
    const keys: string[] = [];
    for (const c of VET_CASES) {
      for (const op of ['accept', 'reject'] as const) {
        jobs.push({ op, documentXml: c.xml });
        keys.push(`${c.name}:${op}`);
      }
    }
    for (const name of IDENTITY_CASES) {
      jobs.push({ op: 'identity', documentXml: VET_CASES.find((c) => c.name === name)!.xml });
      keys.push(`${name}:identity`);
    }
    try {
      const out = await runLibreOfficeOracle(jobs, soffice);
      keys.forEach((key, i) => {
        if (key.endsWith(':identity')) {
          identityXml[key.slice(0, -':identity'.length)] = out[i]!;
        } else {
          loText[key] = visibleText(out[i]!);
          loShape[key] = paragraphShape(out[i]!);
        }
      });
    } catch (err) {
      oracleSkip = `LibreOffice present but could not run in this environment — skipping oracle assertions. (${(err as Error).message.split('\n')[0]})`;
      // eslint-disable-next-line no-console
      console.warn('[libreoffice-oracle-trust-boundary] ' + oracleSkip);
    }
  }, 180_000);

  test.openspec('[LO-ORACLE-TRUST-01] LibreOffice resolves a simple insertion and a simple deletion to the expected text on accept and reject, matching the TS engine')(
    'the single-author baselines resolve identically in LibreOffice and the TS engine',
    async ({ then }: AllureBddContext) => {
      await then('accept/reject text and paragraph shape agree with the TS engine and the expected literals', async () => {
        if (oracleSkip) return;
        for (const c of VET_CASES.filter((v) => v.name === 'simple-ins' || v.name === 'simple-del')) {
          for (const op of ['accept', 'reject'] as const) {
            const ts = op === 'accept' ? acceptAllChanges(c.xml) : rejectAllChanges(c.xml);
            expect(loText[`${c.name}:${op}`], `${c.name} ${op}: LibreOffice text`).toBe(c[op]);
            expect(visibleText(ts), `${c.name} ${op}: TS engine text`).toBe(c[op]);
            expect(loShape[`${c.name}:${op}`], `${c.name} ${op}: paragraph shape`).toEqual(paragraphShape(ts));
          }
        }
      });
    },
  );

  test.openspec('[LO-ORACLE-TRUST-02] LibreOffice resolves a fully-deleted insertion to a collapse on BOTH accept and reject — the oracle dispatches before saving, so the save defect cannot reach it')(
    'inserted-then-deleted text vanishes either way, in LibreOffice and the TS engine alike',
    async ({ then }: AllureBddContext) => {
      await then('accept and reject both drop the inserted-then-deleted text, leaving only the untracked text', async () => {
        if (oracleSkip) return;
        const c = VET_CASES.find((v) => v.name === 'nested-fully-deleted-ins')!;
        for (const op of ['accept', 'reject'] as const) {
          const ts = op === 'accept' ? acceptAllChanges(c.xml) : rejectAllChanges(c.xml);
          expect(loText[`${c.name}:${op}`], `${op}: LibreOffice text`).toBe('keep');
          expect(visibleText(ts), `${op}: TS engine text`).toBe('keep');
          // The paragraph still carries the untracked "keep" text in both engines.
          expect(loShape[`${c.name}:${op}`], `${op}: LibreOffice shape`).toEqual([true]);
          expect(paragraphShape(ts), `${op}: TS shape`).toEqual([true]);
        }
      });
    },
  );

  test.openspec('[LO-ORACLE-TRUST-03] LibreOffice resolves stacked multi-author revisions correctly: a del+ins stack discriminates accept (NEW) from reject (ORIG), and a partial del-in-ins keeps the surviving inserted text')(
    'multi-author stacks and partial nested deletions resolve to discriminating text in both engines',
    async ({ then }: AllureBddContext) => {
      await then('accept and reject produce the discriminating expected text in LibreOffice and the TS engine', async () => {
        if (oracleSkip) return;
        for (const name of ['del-ins-stack', 'partial-del-in-ins']) {
          const c = VET_CASES.find((v) => v.name === name)!;
          for (const op of ['accept', 'reject'] as const) {
            const ts = op === 'accept' ? acceptAllChanges(c.xml) : rejectAllChanges(c.xml);
            expect(loText[`${name}:${op}`], `${name} ${op}: LibreOffice text`).toBe(c[op]);
            expect(visibleText(ts), `${name} ${op}: TS engine text`).toBe(c[op]);
          }
        }
        // Reject of the partial case empties the paragraph (every run was inserted), but the
        // paragraph itself survives — its mark is untracked (the mark-based rule, [LEAN-HELP-10]).
        expect(loShape['partial-del-in-ins:reject'], 'partial reject: LibreOffice keeps the emptied paragraph').toEqual([false]);
        expect(paragraphShape(rejectAllChanges(PARTIAL_DEL_IN_INS)), 'partial reject: TS keeps the emptied paragraph').toEqual([false]);
      });
    },
  );

  test.openspec('[LO-ORACLE-TRUST-04] LibreOffice save round-trip (no accept/reject) drops the w:ins wrapper of a fully-deleted insertion — characterized defect; stacked and partial shapes round-trip cleanly')(
    'a plain load-then-save loses insertion provenance for the fully-deleted-insertion shape only',
    async ({ then }: AllureBddContext) => {
      await then('the fully-deleted insertion collapses to a bare w:del, while the control shapes keep their revisions', async () => {
        if (oracleSkip) return;
        // THE DEFECT (LibreOffice 25.8.7.3): "reviewerA inserted INSERTED, reviewerB deleted it"
        // comes back as "INSERTED was original text that reviewerB deleted" — the <w:ins> wrapper
        // is silently dropped on save. This is why the save round-trip must NOT be used to
        // validate fully-deleted-insertion shapes (preserve-campaign output can emit them).
        // If a LibreOffice upgrade fixes this upstream, these assertions trip: update the trust
        // boundary note in openspec/changes/add-libreoffice-accept-reject-oracle and re-vet.
        // @see https://github.com/UseJunior/safe-docx/issues/346
        const mangled = identityXml['nested-fully-deleted-ins']!;
        expect(mangled, 'defect: <w:ins> provenance dropped').not.toContain('<w:ins');
        expect(mangled, 'defect: the deletion survives as a bare <w:del>').toContain('<w:del');
        expect(mangled, 'defect: the deleted text is still present as delText').toContain('INSERTED');

        // CONTROLS (vetted clean): the non-nested multi-author stack keeps both revisions…
        const stack = identityXml['del-ins-stack']!;
        expect(stack, 'stack control: <w:del> survives the round-trip').toContain('<w:del');
        expect(stack, 'stack control: <w:ins> survives the round-trip').toContain('<w:ins');
        expect(visibleText(stack), 'stack control: visible text unchanged').toBe('NEW');
        // …and a PARTIAL deletion inside an insertion (surviving inserted text) keeps both too:
        // the defect is specific to the all-of-the-insertion-deleted case.
        const partial = identityXml['partial-del-in-ins']!;
        expect(partial, 'partial control: <w:ins> survives the round-trip').toContain('<w:ins');
        expect(partial, 'partial control: <w:del> survives the round-trip').toContain('<w:del');
        expect(visibleText(partial), 'partial control: visible text unchanged').toBe('ABEF');
      });
    },
  );
});
