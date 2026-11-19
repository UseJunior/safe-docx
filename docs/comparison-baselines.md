# Comparison baseline ownership

`SessionManager.ensureBaselines(session)` returns `{ clean, withBookmarks }` from a private normalized copy of the open-time source. The live document's skip-normalization option and subsequent edits do not affect that original. Preparation never resets the live document's serialization baseline or writes its ZIP/cache.

One manager-owned loading/ready resource shares concurrent work. Both serializations must finish before publication. Failed attempts are forgotten for retry; retired sessions and superseded source attempts cannot publish. The old `comparisonBaseline` and `comparisonBaselineWithBookmarks` fields remain compatibility mirrors, not readiness signals. Session-mode comparison uses the returned pair. Save retains its native revision/artifact pipeline.

## Contribution reconciliation

cocvn157's [PR #1344](https://github.com/UseJunior/safe-docx/pull/1344) proposed the paired return contract, comparison consumer change and failure/normalization regressions. Current main already serializes both halves into locals before assigning and already shares/retries promises, so partial assignment during the second serialization is not itself a reproduced defect. Its remaining single-field readiness and missing retirement checks are reproduced by the dedicated tests here.

This implementation credits that contribution's useful paired contract while keeping one authoritative manager resource instead of three independent readiness representations. It adds attempt/source ownership, expiry/close/replacement protection, deterministic stage failures, concurrent failed waiters and live-history isolation. No contributor branch, PR or deployment permission is modified. Claims from the contribution are validated independently by this PR's test evidence.
