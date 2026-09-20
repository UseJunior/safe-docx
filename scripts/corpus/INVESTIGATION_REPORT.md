# Corpus differential/fuzz testing — investigation report

Privacy-safe summary of a one-session corpus-scale differential and fuzz run against
safe-docx. Nothing here auto-merged; this PR is a draft. No document bytes, and no private
or customer identifiers/paths/hashes/text, appear in this repo or report.

## Licensing determination (gate — completed before any fetch)

See `scripts/corpus/README.md` for the per-source table. Determination:
- **Redistributable (full use):** open-agreements (CC-BY-4.0), docx-platform-tests
  (Apache-2.0), dotnet/Open-XML-SDK (MIT).
- **Local testing only (hash + URL + derived flags; no bytes committed):** SuperDoc
  docx-corpus (ODC-BY covers the database, not the underlying Common-Crawl documents) and
  the LibreOffice docx-fuzzer seed corpus (MPL covers LibreOffice source, not the scraped
  attachment documents). SuperDoc's MIT-vs-ODC-BY license conflict was resolved
  conservatively toward ODC-BY.

## Corpus acquired

520 manifest entries, SHA-256-pinned:
- open-agreements 134, dotnet/Open-XML-SDK 117 (55 ISO-Strict + 62 comment/commentsEx),
  docx-platform-tests 28, SuperDoc docx-corpus 240 (stratified across 10 document types,
  en/ru/zh), LibreOffice fuzzer-seed archive 1 (275 members extracted locally).
- Strata (documents may carry several): tables 279, headers/footers 264, multi-section 167,
  drawings 96, comments 59, iso-strict 55, plain-body 49, vml 43, text-boxes 31, fields 30,
  tracked-changes 20, embedded-objects 11, notes 7, content-controls 4, math 3, moves 1.
- A local OOXML feature classifier (`classify_docx_features.mjs`) derived the feature index;
  0 unreadable packages across the SuperDoc sample.

## Stages completed

1. **Provenance/licensing review** — done (above).
2. **Manifest + fetch + classifier** — committed: `differential-corpus-manifest.json`,
   `fetch_differential_corpus.mjs`, `classify_docx_features.mjs`.
3. **Deterministic smoke** — identity round-trip + self-comparison (both reconstruction
   modes) over the full 520-doc corpus. Drivers enforced hard per-job timeouts and CPU
   concurrency 4.
4. **External-oracle hardening** — LibreOffice cross-process lockfile added + unit-tested +
   live two-process probe; Aspose licensed and watermark-verified.
5. **Corpus-scale run** — metamorphic mutation pairs (9 recipes × 2 modes over 64
   stratified docs) + package/parser fuzz (8 mutation ops over 30 stratified bases + 275
   LibreOffice fuzzer seeds).

## Counts (by taxonomy)

- **Smoke, local shard** (171 docs, 513 jobs): 494 pass; the 19 non-pass were all
  rebuild-mode pre-tracked-input mismatches (finding F1) — self-inflicted invariant bug in
  an early harness draft was corrected to projection-to-projection, isolating F1.
- **Smoke, external shard** (358 docs, 1083 jobs): 847 pass; 179 unsupported-undocumented
  (all the BOM ParseError, finding F2); 30 supported-refusal (1 real `OpaquePassthrough` +
  29 self-inflicted build-race, re-run green); 27 rebuild accept-mismatch (F1/F3-class).
- **Metamorphic** (64 docs): 551 pass, 244 skipped (recipe inapplicable), plus mismatches
  that all reduced to F1 (rebuild pre-tracked unwrap) or F3 (rebuild VML/text-box story
  loss). Every `inplace` comparison satisfied the reject→original / accept→revised
  invariant; failures were rebuild-only. Two initially-flagged "phantom-revisions" and all
  "crash" rows were **harness** bugs (a cloned `w:tab`; a missing strict-namespace bind),
  fixed and retracted.
- **Fuzz** (515 jobs): validity-preserving mutations behaved; deliberately-invalid mutations
  failed closed; **1 genuine engine finding (F4, OOM)** on a valid LibreOffice fuzzer seed.
  `invalid-no-content-types` "invalid-accepted" rows reflect that a package missing
  `[Content_Types].xml` still round-trips via the load path — noted, not filed (arguably
  lenient-but-safe).

## Novel findings (minimized; issues filed)

- **F4 — quadratic-memory OOM in comparison → issue #874 (filed).**
  `computeAtomLcs` allocates an unconditional O(n·m) DP matrix; a single paragraph with a
  few thousand atoms exhausts the heap (SIGABRT). Delta-debugged from a 204 KB fuzzer seed
  to the atom-count mechanism; deterministic synthetic repro committed at
  `generate_oom_repro.mjs` (invented text). Reproduces on clean `main`.
- **F2 — BOM-prefixed document.xml → issue #875 (filed).**
  A UTF-8 BOM at the start of `word/document.xml` (as Microsoft's ISO-Strict exports emit —
  56/121 Open-XML-SDK files) throws a raw xmldom `ParseError` from both `DocxDocument.load`
  and `compareDocuments` instead of loading or failing closed. Minimal synthetic repro in
  the issue. Also notes Strict docs silently projecting to near-empty text. Clean `main`.
- **F1 — rebuild mode unwraps pre-existing tracked changes → commented on issue #742.**
  Rebuild-mode comparison drops `<w:del>`/`<w:moveFrom|To>` wrappers from already-tracked
  inputs, emitting bare `<w:delText>` (the Word-unreadable shape #742 reports); `inplace`
  preserves them. Precise mechanism + minimal repro added to #742 (same family as #582);
  no new issue to avoid duplication.

## Oracle agreements / disagreements

- **LibreOffice accept/reject oracle:** ran under the new cross-process lock; two concurrent
  processes each completed full oracle batches, serialized, lock self-cleaned. No
  disagreement observed on the sampled tracked-change accept/reject shapes.
- **Aspose:** licensed run verified. Not used as a blocking voter this session (see below);
  no oracle disagreement to report.

## Aspose watermark verification

Confirmed the swallowed-license-failure defect in `aspose_compare.py` (globs `*.lic`,
`except Exception: pass`): an unlicensed run and an initially-mismatched license both emitted
**evaluation-watermarked** output while exiting 0. Root cause found: the on-disk license
allows product versions released before 2025-11-02, but `pip`'s default `aspose-words`
(26.7.0) is newer, so `set_license` raised `InvalidOperationException` — silently swallowed.
Pinning `aspose-words==25.10.0` and loading the license made output **verified
non-watermarked** (checked for "Evaluation Only" / "evaluation copy" in `word/document.xml`).
Recommendation captured below.

## Resource / environmental notes

- No uncontrolled process leak. Every worker ran under a hard per-job timeout; the only
  process death was the OOM seed (SIGABRT under a capped heap), which the driver classified,
  not a leak.
- One early self-inflicted build-race (running `npm run build -w docx-core`, which cleans
  `dist`, while the smoke driver was live) produced 29 spurious "Cannot find package"
  refusals; re-run green. Do not rebuild a package mid-run.
- LibreOffice #627 (macOS headless startup crash / parallel amplification) did **not**
  reproduce with the lock in place. It **did** reproduce spontaneously in the environment:
  12 leaked headless soffice processes (1–2 day elapsed, 0% CPU/MEM, hung after startup),
  whose referenced throwaway profile dirs had already been `rmSync`'d by the parent's
  `finally` — the child outlived the parent's cleanup. Evidence posted to #627. None were
  attributable to this session, and per the shared-machine kill ban I killed nothing.
  The stage-4 lock closes the concurrency-amplification vector but not the reaping gap; a
  process-group/stale-profile reaper is recommended on #627 but **deliberately not shipped
  tonight** — killing processes on a shared machine under the `pkill` ban is unsafe without
  perfect attribution.

## Recommended next queue

1. Fix F4 (#874): linear-space/Hirschberg LCS or a size-guarded bounded refusal — highest
   severity (DoS on ordinary content).
2. Fix F2 (#875): strip/tolerate a leading BOM on XML parts before parsing; decide ISO-Strict
   scope and make ingest either support it or refuse with an actionable error.
3. Land F1 under #742/#582: rebuild must preserve pre-existing revision markup or fail closed.
4. Harden `aspose_compare.py`: fail loudly on `set_license` errors, assert the output is not
   watermarked, and pin a license-compatible `aspose-words` version (≤ the license's
   free-upgrade date). Never swallow the license exception.
5. Consider promoting one deterministic, env-gated smoke harness (identity + self-compare)
   from `.tmp/` into the tree once F1/F2/F4 are fixed — kept opt-in, never a default CI job.
