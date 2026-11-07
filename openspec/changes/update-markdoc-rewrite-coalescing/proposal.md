# Change: Coalesce Heavily Rewritten Markdoc Passages

## Why

A `{% change %}` block whose `after` heavily rewrites its `before` compiles to
an interleaved word-level redline. Short common words (`the`, `of`, `shall`,
`and`) survive as ordinary text between many small deletions and insertions,
so a reader cannot recover either the old or the new sentence from the marked
paragraph. Issue #1293's synthetic paragraph compiles on `main` (aa2c2df4) to
13 content-bearing `w:del` and 19 content-bearing `w:ins` wrappers in one
paragraph. On a real 10-page document the redline had about 98 deletions and
296 insertions; a commercial comparison of the same texts had 23 and 130,
showing each rewritten passage as one struck block followed by one inserted
block.

The current contract forbids the fix. The active change
`add-readable-redline-coalescing-profile` permits only U+0020 bridges
(SDX-MDOC-144: the transform SHALL NOT bridge any common lexical token or
punctuation) and keeps no public grouping selector (SDX-MDOC-141, direction
after PR #1016). The independent release verifier's `authored-zero-loss` gate
charges every common lexical, punctuation, and anchored-whitespace token
(REL-VERIFY-15). Measured on the #1293 paragraph, the requested shape (common
prefix kept, then one deletion and one insertion) loses 35 preservable tokens
(12 lexical, 3 punctuation, 20 whitespace) and fails that gate, while today's
interleaved output passes with zero loss. Fixing #1293 therefore needs an
explicit policy decision, not a bug fix.

## What Changes

- Add a dense-rewrite coalescing step to Markdoc compilation, applied after
  token-minimal validation and the existing whitespace grouping, within one
  operation and one paragraph.
- A paragraph qualifies only when its changed share is at least 50%: one minus
  twice the common lexical tokens over the sum of lexical tokens on both
  sides. A light edit therefore keeps today's granular hunks.
- In a qualifying paragraph, an unchanged island strictly between two change
  hunks is absorbed when it contains fewer than N lexical tokens (default
  N = 3). The island is copied to both revision sides, so adjacent hunks merge
  into one deletion followed by one insertion. Leading and trailing unchanged
  text is never absorbed.
- Never absorb across tabs, line breaks, retained-format intervals,
  incompatible run formatting, fields, bookmarks, comments, hyperlinks,
  existing revisions, or operation and paragraph boundaries.
- Keep accept-all equal to `after` and reject-all equal to `before`.
- Record absorbed islands in the compilation certificate (coalesced chains,
  absorbed lexical, punctuation, and whitespace token counts, threshold used).
- Teach the release verifier to disclose absorbed common tokens inside one
  deletion-to-insertion group, and to stop counting them as lost only within
  the bound the certificate declares. Every other token stays mandatory.

## Decisions Needed (Steven)

1. **Allow lexical coalescing at all?** It reverses an explicit #846 / #998
   non-goal ("swallowing common words or punctuation for visual convenience").
2. **Verifier policy.** (a) Extend `authored-zero-loss` with a bounded,
   disclosed allowance; (b) add a second named gate such as
   `authored-readable-rewrite`; or (c) leave the gate unchanged, which would
   make every coalesced compile fail independent release verification.
3. **Configurability.** #1293 asks for a configurable N; PR #1053/#1054
   removed the public grouping selector. Options: a fixed internal constant;
   a numeric `rewrite-coalesce-island` attribute on `{% compilation %}` plus a
   matching compile option and CLI flag; or a CLI-only flag.
4. **Defaults.** N = 3 (absorb islands of at most two words such as `of the`)
   and a 50% changed-share gate. In a word-level simulation, N = 1 leaves the
   #1293 paragraph at 12 deletions and 13 insertions; N >= 2 collapses it to
   one of each. A light edit (6% changed) and a moderate edit (16% changed,
   "for convenience ... sixty ... prior") stay granular under the gate. Without
   the gate, N = 2 would collapse the moderate edit into one block.

## Impact

- Affected specs: `docx-markdoc`, `release-verification`
- Affected code: `packages/docx-markdoc/src/compile.ts` (post-comparison or
  pre-emission hunk transform), compile options, CLI and README if
  configurable, `packages/docx-release-verifier/src/minimality.ts`, and tests
  including `dense-rewrite-minimality.test.ts` (#846), whose fixtures change
  shape when their changed share passes the gate.
- The shared `@usejunior/docx-compare` default stays token-minimal so
  real-corpus comparison gates and epic #1295 are unaffected; if the rule needs
  comparator support, Markdoc requests it through the internal
  `revisionGrouping` option as it does today.
- Related: #1293, #998, #846, PR #1016, PR #1053, PR #1054.
