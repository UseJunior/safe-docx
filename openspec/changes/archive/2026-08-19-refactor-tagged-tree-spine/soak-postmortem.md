# Tagged-authority soak postmortem — 2026-08-23 UTC

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
deletion. The observable history is that task 8.3 first appeared checked in
`fe941d4d`, the same commit that removed the legacy spine. No recorded release or
corpus interval separates those events. A passing check after deletion cannot
prove that a pre-deletion observation window occurred.

## Impact

The migration lost the planned interval in which tagged behavior could be
observed while the private legacy recovery path remained immediately selectable.
The risk is confidence and recovery latency, not a newly established user-facing
failure: no evidence reviewed for this postmortem establishes that the skipped
soak itself caused document corruption.

The skipped gate was more consequential because the archived rollback commands
also named non-durable squash-branch commits. PR #933 replaced them with a
fail-closed procedure pinned to two durable remote refs and recorded an actual
restore/reconciliation exercise. This postmortem cites that evidence; it does
not duplicate or redefine the recovery steps.

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

### Fail-closed public corpus and load-bearing oracles — 2026-08-23 UTC

PR #930 merged as `271a8cbf695998da990b99461569a2096f7ae6d2`
at `2026-08-23T03:19:27Z`. It replaced the optional local corpus path with one
registered command and made field, bookmark, revision-ID, move-balance,
unsupported-story, formatting, projection, package, relationship, and auxiliary
definition checks load-bearing. It also requires every active divergence to be
consumed by an observed assertion.

The no-corpus invocation failed rather than returning a skipped pass:

```text
$ env -u SAFE_DOCX_REAL_CORPUS_DIR \
    npm run test:real-corpus -w @usejunior/docx-compare
Tests  1 failed | 5 passed | 14 skipped
Failure: manifest availability assertion reports the required corpus is absent
EXIT=1
```

The required replay used the SHA-256-verified seven-document public NVCA cache:

```text
$ SAFE_DOCX_REAL_CORPUS_DIR=/private/tmp/safe-docx-audit-838/.probe/corpus \
    SAFE_DOCX_REAL_CORPUS_REQUIRED=1 \
    SAFE_DOCX_STRATEGY_DIFFERENTIAL_REQUIRED=1 \
    npm run test:real-corpus -w @usejunior/docx-compare
Test Files  3 passed (3)
Tests       21 passed (21)
Duration    312.72s
EXIT=0
```

The post-merge full build/workspace suite and local LibreOffice probes also
passed. The CI real-corpus job passed in 14m51s. The advisory `codecov/patch`
status reported 73.63% against 85% even though the package coverage ratchet
remained green at approximately 87.58%; #932 tracks corpus-job coverage
publication and #931 tracks making the real-corpus job required. This advisory
red status is retained here rather than represented as a clean aggregate pass.

### Executed durable-ref rollback — 2026-08-23 UTC

PR #933 merged as `a68b7d06b6d1c08a746ee20d06f8a04f738f38e4`
at `2026-08-23T04:29:45Z`. Starting from exact main at `271a8cbf`, its disposable
v5 exercise verified that both retained remote anchors peel to
`11315af1f135e9f5515053f48dc514a5b23303c3`, restored the four audited trees,
and proved exact equality before descendant reconciliation:

```text
$ git ls-remote origin refs/heads/838-legacy-comparison-maintenance-20260817 \
    refs/tags/legacy-comparison-final-20260817 \
    'refs/tags/legacy-comparison-final-20260817^{}'
11315af1f135e9f5515053f48dc514a5b23303c3 refs/heads/838-legacy-comparison-maintenance-20260817
972cf96fed54a03aeb89958fa27c1d46b8890f21 refs/tags/legacy-comparison-final-20260817
11315af1f135e9f5515053f48dc514a5b23303c3 refs/tags/legacy-comparison-final-20260817^{}
EXIT=0

$ git status --short | wc -l
210
$ git diff --cached --stat
210 files changed, 44874 insertions(+), 6495 deletions(-)
$ git diff --exit-code "$LEGACY_ROLLBACK_COMMIT" -- \
    packages/docx-compare packages/docx-core packages/docx-markdoc \
    spec-compliance
EXIT=0
```

The reconciliation adjudicated all 14 intervening commits, including preserving
#930's deployed corpus config and explicitly retaining #929's conclusion that
restored self-shadow assertions are not independent evidence. The full build,
lint, workspace tests, spec coverage, conformance checks, and public NVCA legacy
smoke passed. The smoke selected `comparisonStrategyUsed: "legacy"`, produced a
31-entry DOCX package, and proved Accept All matched revised while Reject All
matched original. Claude's final dynamic review approved #933, all required CI
checks passed, and its exact-merge post-smoke reverified both remote anchors.
The full transcript remains in `rollback-validation.md`.

### Oracle boundary

Microsoft Word and Aspose snapshots committed elsewhere in the repository are
valuable behavior-specific oracle records, but they were gathered before this
postmortem and do not constitute an end-to-end tagged-spine soak. The only live
cross-reader execution claimed above is the specifically described LibreOffice
open/export. No Word or Aspose run is silently upgraded into replacement soak
evidence.

## Current rollback and remediation triggers

The following outcomes require action; a green aggregate job must not override
the underlying failure. The release owner owns the decision and records it on
the failing PR or a linked issue. For this table, an **isolated** corpus failure
means exactly one of the current 23 hash-pinned manifest rows fails while the
other 22 pass and publication fails closed. A **systemic** failure means two or
more independent rows fail the same invariant, any unsafe package escapes a
publication gate, or one source-projection failure reaches a published release.
An isolated failure may use fix-forward only before the next comparison release;
if the affected version is already published and a validated fix is not ready
within 24 hours, the release owner invokes the #919 rollback procedure.

| Trigger | Required response |
| --- | --- |
| A required public-corpus run cannot materialize or verify every hash-pinned source, silently skips, or has an unconsumed active divergence | Stop release/merge progression, repair the evidence gate, and rerun it. Do not characterize the missing run as a pass. |
| Accept All or Reject All stops matching its source projection on a previously passing public fixture | Treat as a release blocker. Fix forward only under the isolated-failure definition above; use the #919 rollback procedure for a systemic failure or when the 24-hour published-release limit expires. |
| A comparison introduces schema, relationship, field, bookmark, revision-ID, move-balance, unsupported-story, auxiliary-definition, or formatting-fidelity failures not present in either input | Stop publication for that result and open a focused remediation issue with the fixture hash and diagnostics. Apply the isolated/systemic and 24-hour rules above. |
| The mandatory manual reader check before a comparison-affecting release tag reports Microsoft Word repair/recovery, inability to open a previously supported emitted DOCX, or a changed semantic projection on open/save | Quarantine the public fixture and compare the emitted package with the last known-good release. Run Word through the repository's local oracle workflow on at least one public pair; if Word is unavailable, record that limitation and run a LibreOffice open/export without representing it as Word evidence. Apply the isolated/systemic and 24-hour rules above. This is a manual release-owner check, not a CI monitor. |
| The tagged result or reviewed manifest changes nondeterministically for identical hash-pinned inputs and fixed comparison metadata | Treat as a release blocker, preserve both outputs, and remediate before updating any baseline. |
| A required safety gate throws on a previously supported public fixture after a tagged change | Do not weaken or bypass the gate. Revert/fix the causative change, or use the tested rollback path when the failure is broad and urgent. |
| An archived task is marked complete without the dated, reproducible command transcript or external event its acceptance text requires | Uncheck the task, block archive/release completion, and open a linked correction or postmortem. Later evidence must retain its real timing and must not be relabeled as the missing gate. |

Rollback is not automatic for the isolated case defined above: a documented
fix-forward is safer when publication already fails closed. The explicit
systemic and 24-hour conditions above prevent indefinite re-election of that
exception.

## Closure evidence

This postmortem closes the evidentiary record because:

1. task 8.3 remains visibly unchecked;
2. #930's fail-closed corpus and oracle evidence is merged and recorded above
   with exact commands, commit, date, and outcome;
3. #933's exercised rollback evidence is merged and recorded above with exact
   commit, date, and outcome; and
4. this correction is independently gated by repository pre-submit and dynamic
   Claude review before merge.

Closing #920 records the missed gate and the accepted compensating controls. It
does not change task 8.3 to complete and does not claim that time was replayed.
