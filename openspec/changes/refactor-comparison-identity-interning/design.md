## Context

`docx-compare` atomizes both documents and runs a hierarchical LCS. Atom identity
was a per-atom SHA1 hash; the LCS compared 40-char hex strings and, on hash-equal
cells, re-walked each atom's recursive `textContent`. Profiling in #583 attributed
~51% of compare time to hashing + DOM. This change replaces the equality token with
an interned integer while keeping `sha1Hash` available (lazily) for its existing
public/spec role.

## Goals / Non-Goals

- Goals: eliminate the per-atom SHA1 slice and the per-cell `textContent` walk from
  the LCS hot path; preserve the exact `atomsEqual` relation and byte-identical
  output; keep the public API unchanged.
- Non-Goals: Myers diff / prefix trimming (#583 Track B); replacing the XML DOM
  substrate; fixing the pre-existing `w:drawing` identity collision (distinct
  inline images already share a hash today — preserved, not fixed here).

## Decisions

- **Intern the finalized identity, not the text.** The interner key is the exact
  `atomsEqual` triple encoded as one string: `elementIdentityString(el)` (or the
  empty-paragraph context signature) + recursive `textContent` + `tagName`,
  NUL-delimited. So `identityId`-equality is *exactly* today's relation — proven by
  a generated differential test over an atom cross-product, not by argument.
  - Alternative rejected: interning `textContent` alone — silently merges
    same-text/different-attribute atoms (#584 Gap 2), breaking redline formatting.
  - Alternative rejected: interning `sha1Hash` — would force materializing every
    hash, defeating the lazy win.
- **`sha1Hash` becomes a lazy accessor** (compute-on-first-read, memoized in a
  non-enumerable slot) so atoms whose hash is never read — the vast majority of
  interior `w:t` atoms — never invoke crypto. Salt sites assign the extended
  colon-form string verbatim; run merges invalidate the cache. Byte-identical
  digests preserved (the ~15 pinned empty-paragraph hash-relation tests are
  untouched). Measured residual: crypto still runs for empty-paragraph context
  keys and non-`w:t` leaf context signatures — an O(paragraphs + non-text leaves)
  tail, ~7% of the former call count on NVCA.
- **One interner per compare pass, shared across both documents** (not
  process-global) so equal identities across sides get equal integers, and retained
  strings are bounded to a single comparison.
- **Comparator chosen once per LCS invocation**, not per DP cell; duck-typed atoms
  in direct-call unit tests fall back to the legacy comparator, which the id
  relation reproduces exactly (the Lean differential harness exercises this path).
- **Identity stored under a module-private symbol**, not a public field, keeping
  the `ComparisonUnit` shape and `JSON.stringify` output unchanged and preserving
  the `lean-differential-lcs.test.ts` type tripwire.

## Risks / Trade-offs

- Stale interned id after a post-interning DOM mutation → wrong match. Mitigation:
  interning runs after all identity mutations (numbering/hyperlink salt, run
  merge); a dev-mode assertion fires if an atom reaches LCS without a key.
- Empty-group vs raw-text token collision in the shared group `textHash` field.
  Mitigation: empty-group tokens carry a NUL-delimited prefix that paragraph text
  can never contain.

## Migration Plan

Pure internal refactor; no data or API migration. Ships in six bisectable steps
(each a value-identical no-op until the two comparator switches). Rollback = revert
the comparator-switch commits.

## Open Questions

- None blocking. Follow-ups (out of scope): eliminate the residual empty-paragraph
  context crypto; cross-run memoization of prepared bases (#583 Track A item 3).
