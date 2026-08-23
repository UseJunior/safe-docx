# Tagged-authority soak postmortem — 2026-08-22

## Decision and scope

Task 8.3 is incomplete. The required release/corpus soak did not occur between
the tagged-authority flip and legacy deletion. There is no contemporaneous
waiver to preserve, and this postmortem does not invent one. The later evidence
below is accepted only as compensating, post-deletion evidence; it does not make
the missed sequencing gate complete after the fact.

This record addresses issue #920. It does not establish that the independent
Phase 6 shadow gate ran: audit remediation separately established that the
observer compared the published package with itself and removed that false
evidence in PR #929.

## What happened

The migration design required the tagged assembler to become authoritative,
then remain behind a private emergency switch for at least one release/corpus
cycle before public options and the legacy spine were removed. The squash merge
that landed PR #898 instead contains the authority flip and legacy deletion in
one commit. Its direct child prepared v0.20.0 less than two hours later:

```text
$ git show -s --format='%H%n%P%n%cI%n%s' fe941d4d a807a689
fe941d4d7c19797f24d5cefd7c997f82f1e63a02
688d1719c613a2a1e6fff61cefea8acec846897c
2026-08-19T03:59:30Z
refactor(docx-compare): delete legacy comparison spine (#898)
a807a68926a54fe9065afe8dab502878c54d6f37
fe941d4d7c19797f24d5cefd7c997f82f1e63a02
2026-08-19T05:27:27Z
chore(release): prepare v0.20.0 publication (#906)
```

The v0.20.0 and v0.20.1 Git tags now exist and both contain the deletion commit.
As of this review, GitHub Releases still reports v0.19.1 as the latest published
release. Neither fact supplies an observation window *between* authority and
deletion:

```text
$ git tag --contains fe941d4d | sort -V
v0.20.0
v0.20.1

$ gh release list --repo UseJunior/safe-docx --limit 3
v0.19.1  Latest  v0.19.1  2026-07-24T23:44:13Z
v0.18.0          v0.18.0  2026-07-24T03:08:56Z
v0.17.0          v0.17.0  2026-07-23T01:59:43Z
```

No preserved evidence identifies a deliberate decision to waive the gate before
deletion. The archive was marked complete because phase work was collapsed into
the squash-merged migration and later checks were treated as if they established
the required sequence. That was a process and evidence-classification failure:
a passing check after deletion cannot prove that a pre-deletion observation
window occurred.

## Impact

The migration lost the planned interval in which tagged behavior could be
observed while the private legacy recovery path remained immediately selectable.
The risk is confidence and recovery latency, not a newly established user-facing
failure: no evidence reviewed for this postmortem establishes that the skipped
soak itself caused document corruption.

The skipped gate was more consequential because the archived rollback commands
also named non-durable squash-branch commits. Issue #919 owns the corrected and
executed rollback procedure. This postmortem consumes that evidence after it
lands; it does not duplicate or redefine the recovery steps.

## Post-deletion compensating evidence

All dates below are evidence dates, not a reconstructed soak timeline.

### Public corpus expansion — 2026-08-19 UTC

PR #911 merged as `59d4891615447778f8f29e5ef951453603d906f0`
at `2026-08-19T19:49:31Z`. Its Linux real-corpus comparison job passed, and its
post-merge replay matched all 23 reviewed manifest rows. The local full-workspace
smoke was **not** fully green: LibreOffice stalled in the render-verifier
workspace. That renderer stall is retained as a failure and is not counted as
cross-reader evidence here.

### Bookmark remediation and a real LibreOffice open/export — 2026-08-21 UTC

PR #928 merged as `a1566dd074971150e3fdc72ed34eb70ccb2a5db7`
at `2026-08-21T21:30:56Z`. Its post-merge public ILPA comparison ran in both
directions. The combined, Accept All, and Reject All documents had unique and
balanced bookmark ranges with no unresolved supported bookmark references.
LibreOffice opened both emitted DOCX files and exported nonempty PDFs. This is
useful post-deletion interoperability evidence, not the skipped soak.

### False shadow evidence removed — 2026-08-23 UTC

PR #929 merged as `0f9855bd61e287760580127293ec687341f2a0e8`
at `2026-08-23T02:10:14Z`. Its exact-main post-merge smoke passed the full
workspace suite and the bidirectional public ILPA tests. The obsolete package
self-comparison observer was deleted and archived task 6.6 was corrected to
incomplete. This improves the truthfulness of the evidence chain; it is not an
independent legacy-versus-tagged comparand.

### Fresh public-corpus replay — 2026-08-22 America/New_York

The repository's seven public NVCA sources were downloaded and individually
SHA-256 verified, then the three public real-document suites were run with
required-mode environment variables:

```text
$ node scripts/prepare_real_comparison_corpus.mjs .probe/public-corpus
[real-comparison-corpus] cached verified nvca-certificate-of-incorporation
[real-comparison-corpus] cached verified nvca-indemnification-agreement
[real-comparison-corpus] cached verified nvca-investors-rights-agreement
[real-comparison-corpus] cached verified nvca-management-rights-letter
[real-comparison-corpus] cached verified nvca-rofr-co-sale-agreement
[real-comparison-corpus] cached verified nvca-stock-purchase-agreement
[real-comparison-corpus] cached verified nvca-voting-agreement
EXIT=0

$ SAFE_DOCX_REAL_CORPUS_DIR=$PWD/.probe/public-corpus \
    SAFE_DOCX_REAL_CORPUS_REQUIRED=1 \
    SAFE_DOCX_STRATEGY_DIFFERENTIAL_REQUIRED=1 \
    npm run test:run -w @usejunior/docx-compare -- \
      src/integration/real-corpus-paragraph-deletion.test.ts \
      src/integration/strategy-differential-manifest.corpus.test.ts \
      src/integration/taggedTreeMinimality.corpus.test.ts
Test Files  3 passed (3)
Tests       21 passed (21)
EXIT=0
```

This replay covers source projections, package structure, relationships,
auxiliary definitions, formatting, bookmark/revision integrity, and tagged-tree
minimality to the extent asserted by the tests at that commit. Issue #917 owns
making corpus absence fail closed and making every retained oracle and active
divergence load-bearing. Its merged evidence must be added here before this
postmortem ships.

### Oracle boundary

Microsoft Word and Aspose snapshots committed elsewhere in the repository are
valuable behavior-specific oracle records, but they were gathered before this
postmortem and do not constitute an end-to-end tagged-spine soak. The only live
cross-reader execution claimed above is the specifically described LibreOffice
open/export. No Word or Aspose run is silently upgraded into replacement soak
evidence.

## Current rollback and remediation triggers

The following outcomes require action; a green aggregate job must not override
the underlying failure.

| Trigger | Required response |
| --- | --- |
| A required public-corpus run cannot materialize or verify every hash-pinned source, silently skips, or has an unconsumed active divergence | Stop release/merge progression, repair the evidence gate, and rerun it. Do not characterize the missing run as a pass. |
| Accept All or Reject All stops matching its source projection on a previously passing public fixture | Treat as a release blocker. Fix forward if the defect is isolated and the unsafe result fails closed; use the #919 rollback procedure if affected releases can emit a document whose source projection cannot be recovered safely. |
| A comparison introduces schema, relationship, field, bookmark, revision-ID, move-balance, unsupported-story, auxiliary-definition, or formatting-fidelity failures not present in either input | Stop publication for that result and open a focused remediation issue with the fixture hash and diagnostics. Roll back if the failure is systemic or publication does not fail closed. |
| Microsoft Word or another configured reader reports repair/recovery, cannot open a previously supported emitted DOCX, or changes its semantic projection on open/save | Quarantine the fixture and compare the emitted package against the last known-good release. Fix forward for an isolated, fail-closed case; invoke rollback for a reproducible systemic regression. |
| The tagged result or reviewed manifest changes nondeterministically for identical hash-pinned inputs and fixed comparison metadata | Treat as a release blocker, preserve both outputs, and remediate before updating any baseline. |
| A required safety gate throws on a previously supported public fixture after a tagged change | Do not weaken or bypass the gate. Revert/fix the causative change, or use the tested rollback path when the failure is broad and urgent. |

Rollback is not automatic for every isolated assertion failure: a documented
fix-forward is safer when publication already fails closed. Rollback becomes the
preferred recovery when a regression is reproducible across multiple supported
documents, escapes a publication gate, prevents safe source projection, or makes
the tagged-only line unusable while a fix cannot be validated promptly.

## Closure conditions

This postmortem can close #920 when:

1. task 8.3 remains visibly unchecked;
2. #917's fail-closed corpus and oracle evidence is merged and recorded here with
   exact commands, commit, date, and outcome;
3. #919's exercised rollback evidence is merged and linked here with exact
   commit, date, and outcome; and
4. the complete change passes repository pre-submit and dynamic Claude review.

Closing #920 records the missed gate and the accepted compensating controls. It
does not change task 8.3 to complete and does not claim that time was replayed.
