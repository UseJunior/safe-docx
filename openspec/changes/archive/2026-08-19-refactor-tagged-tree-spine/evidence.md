# Completion evidence

This map records where the characterization, capability, and public-surface
evidence required by the change is enforced. It supplements the generated
manifest; it does not replace executable assertions.

## Characterization record (Tasks 1.2 and 1.5)

`packages/docx-compare/src/integration/strategy-differential-harness.ts`
records, for every fixture:

- normalized original/revised pair hashes and capability tags;
- accept/reject projections, including text and XML hashes and the first
  divergence;
- normalized XML/binary package-part sizes and hashes;
- comparison statistics, selected strategy, fallback diagnostics, and
  unrepresented changes;
- package-schema results, introduced structural issues, formatting projection
  scores, relationship closure, and auxiliary-definition closure;
- typed unsupported-story diagnostics and forbidden-payload leakage.

`strategy-differential-manifest.corpus.test.ts` requires the committed rows to
match the harness output and rejects unapproved drift. At the archived change's
merge, corpus absence failed only when required-mode environment variables were
armed; ordinary local invocation could skip. Issue #917 owns making the
registered corpus command fail closed by default. `strategy-differential-fixtures.ts` maps the
required capability surface to checked-in, synthetic, and real fixtures:

| Capability | Executable evidence |
| --- | --- |
| Fields, formatting, numbering, tables, relationships | ILPA and real-corpus rows in `strategy-differential-fixtures.ts`; `tagged/pipeline.field-validation.test.ts`; `tagged/formattingFidelity.test.ts` |
| Footnotes, endnotes, comments, bookmarks, auxiliary definitions | `synthetic/ancillary-definitions`; `tagged/pipeline-auxiliary-notes.test.ts`; `tagged/pipeline-comment-ancillary.test.ts`; `tagged/consumerCompatibility-bookmark-ranges.test.ts` |
| Moves and revision range boundaries | `synthetic/exact-paragraph-move`; `strategy-differential.test.ts`; `openspec.traceability.test.ts` |
| Relationship and identifier closure | harness closure gates; `tagged/relationshipIdCollision.test.ts`; `tagged/auxiliaryIdCollision.test.ts` |
| Rationale attribution and payload privacy | `integration/tagged-rationale-attribution.test.ts`; `packages/docx-markdoc/src/rationale-comments.test.ts`; harness `forbiddenPayloadLeaks` |
| Text boxes and unsupported stories | `synthetic/vml-text-box`; `tagged/pipeline-text-box-stories.test.ts`; `tagged/textBoxRevisionSafety-alternate-content.test.ts`; harness `unsupportedStoryDiagnostics` |

## MCP schema and documentation (Task 2.4)

`packages/docx-mcp/src/tool_catalog.ts` exposes `compare_documents` without an
`engine` selector. `packages/docx-mcp/src/tools/compare_documents.test.ts`
asserts that absence on the registered JSON schema, while
`packages/docx-mcp/docs/tool-reference.generated.md` describes the sole tagged
publication path. The repository `check:tool-docs`, `check:mcpb-manifest`, and
`check:capability-projection` gates keep those generated surfaces synchronized.

## Post-rollback module location (Tasks 11.1 and 11.2)

The surviving implementation now lives under
`packages/docx-compare/src/tagged/`. Active imports, Vitest configuration,
conformance registry and generated evidence, Allure compatibility fixtures,
and MCP scripts point to that path. Historical migration and rollback records
retain their original paths intentionally.
