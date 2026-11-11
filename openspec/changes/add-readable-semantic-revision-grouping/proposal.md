# Change: Add readable semantic revision grouping

## Why

Issue #1411: a heavily rewritten paragraph redlines word by word
(`-[Alpha] +[Gamma] =[ ] -[Holdings] +[Fund] =[ ] …`) because comparison emits
the token-minimal deletion/insertion set. A legal reader cannot follow that.
The readable grouping built for Markdoc (`readable-whitespace`, #998/#1054)
does not reach `compare_documents`: the tool never selects it, it is disabled
whenever a paragraph's runs differ in formatting (one highlighted placeholder
or bold defined term is enough), and it bridges only U+0020 spaces, so short
words such as "a", "an", "the" and "as" still split each change.

## What Changes

- Add a `readable-semantic` revision-grouping policy to `@usejunior/docx-compare`.
  After serialization it regroups each paragraph's comparison-generated run
  revisions with a diff-match-patch `cleanupSemantic`-style rule: absorb an
  unchanged stretch between two changes when its length is no greater than the
  larger side (deleted or inserted characters) of the change on each side,
  always absorb a whitespace/punctuation-only stretch, and repeat to a fixpoint.
  Each cluster is rebuilt as one `w:del` (original-side runs, absorbed runs as
  `w:delText`) followed by one `w:ins` (revised-side runs); each run keeps its
  own `rPr`, so mixed formatting is supported. Anything other than a plain text
  run or a comparison-generated text-only `w:ins`/`w:del` is a barrier.
- Expose it on the stable facade as `CompareOptions.revisionGrouping`
  (`'token-minimal' | 'readable-semantic'`). The library default stays
  `'token-minimal'`; unknown values throw a `TypeError`.
- Add `revision_grouping` to the MCP `compare_documents` tool, defaulting to
  `'readable-semantic'` because its readers review the redline, and echo the
  applied value in the response.
- Leave `readable-whitespace` and Markdoc compilation unchanged. Markdoc's
  `authored-zero-loss` verifier charges common lexical and punctuation tokens,
  so widening that mode would break its gate; it stays the bounded U+0020 mode.

## Impact

- Affected specs: `docx-comparison`, `mcp-server`.
- Affected code: `packages/docx-compare/src/compare-types.ts`, `src/index.ts`,
  `src/tagged/taggedTreeSerializer.ts`, new `src/tagged/readableSemanticGrouping.ts`;
  `packages/docx-mcp/src/tools/compare_documents.ts`, `src/tool_catalog.ts`,
  the generated tool reference and the `docx-editing` skill.
- Accept All and Reject All projections are unchanged in every mode; only the
  tracked wrapper shape and the range statistics derived from it change.
- References: #1411, #1293 (same symptom in Markdoc compile), #998, #1016, #1054.
