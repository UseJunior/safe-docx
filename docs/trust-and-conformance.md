# Trust And Conformance

Safe Docx treats document safety and standards conformance as scoped, inspectable properties. Claims should identify the behavior, evidence, and boundary they cover.

## Trust Model

The default MCP runtime is a local Node.js process:

- document files are read from permitted local paths;
- mutations are held in a local document session;
- outputs are written to caller-selected permitted paths;
- no Safe Docx hosted service receives document content.

Safe Docx does not control the surrounding MCP client or model provider. Text returned by a read tool may be sent to the configured model by that client.

## Filesystem Policy

Path policy defaults to the user's home and system temporary directories. Symlink-resolved paths must remain within an allowed root.

DOCX and ODT files are ZIP-based packages. The runtime rejects suspicious archives using configurable limits:

| Variable | Default | Purpose |
|---|---:|---|
| `SAFE_DOCX_MAX_ARCHIVE_ENTRIES` | `2000` | Maximum archive entries |
| `SAFE_DOCX_MAX_UNCOMPRESSED_BYTES` | `209715200` | Maximum total expanded size |
| `SAFE_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES` | `52428800` | Maximum expanded size for one entry |
| `SAFE_DOCX_MAX_COMPRESSION_RATIO` | `200` | Maximum compression ratio |

These controls reduce exposure to malformed or adversarial archives. They are not a general malware scanner.

## ECMA-376 Scope

Safe Docx targets a defined subset of ECMA-376 5th edition. The authoritative scope is generated from the [ECMA-376 registry](../spec-compliance/registry/ecma-376.md) into the [conformance report](../spec-compliance/CONFORMANCE.md).

The conformance system records:

- targeted sections;
- explicit non-goals;
- implementation and test citations;
- known gaps;
- vendored normative schemas.

OOXML implementation claims use `@conformance ECMA-376 edition 5, Part N § SECTION` citations. Tests attach the corresponding spec, edition, part, and section metadata. CI checks citation grammar and generated-document drift.

This is subset conformance, not full Microsoft Word compatibility. Safe Docx does not claim visual equivalence, complete layout behavior, or implementation of every ECMA-376 feature.

## Evidence Layers

| Layer | What it establishes | What it does not establish |
|---|---|---|
| Unit and integration tests | Behavior for exercised inputs and fixtures | Correctness for every valid document |
| ECMA-376 citations | Normative basis for a behavior | That the implementation is bug-free |
| Vendored schemas | Structural validation against selected normative schemas | Word rendering equivalence |
| OpenSpec scenarios | Intended repository behavior and acceptance cases | Formal proof of implementation |
| Differential and oracle tests | Agreement with another implementation on a defined projection | General equivalence outside that projection |
| Lean artifacts | Properties of modeled definitions and stated assumptions | Proof of the entire TypeScript stack or full OOXML |

The [invariant registry](../verification/INVARIANTS.md) names proof tier, residual axioms, caveats, production surfaces, and falsifiers for verification claims.

## Optional Document Integrity Check

`compare_documents` accepts `verify_document_integrity=true`. When a compiled Lean checker is available, Safe Docx passes the actual original, revised, and compared `word/document.xml` parts to a separately compiled executable and returns `document_integrity` metadata.

If the executable is unavailable, the result is `status: "not_run"`. Absence of the optional checker never becomes a verified claim.

Source checkouts look for:

```text
verification/lean/.lake/build/bin/leanDocxChecker
```

Set `SAFE_DOCX_LEAN_XML_CHECKER` to use another executable. Normal package usage does not require Lean or Lake.

The checker covers a narrow comparison-output contract. It is not a proof of the comparison implementation, the MCP server, or the complete ECMA-376 standard.

## Runtime Dependencies

Supported DOCX paths use TypeScript, `jszip`, and `@xmldom/xmldom`. They do not require Python, .NET, Microsoft Word, or LibreOffice.

Some development, fixture, rendering, oracle, or verification workflows have additional optional dependencies. Those dependencies do not become requirements for the installed `safe-docx` runtime.

## Review Guidance

For material documents:

1. Write outputs to new paths.
2. Request a tracked variant when edits require human approval.
3. Inspect revision authorship and unrelated changes.
4. Open the result in the document editor used by the receiving workflow.
5. Retain the original document until review is complete.

Safe Docx makes document mutations inspectable and repeatable. It does not replace professional review or the rendering behavior of the final editor.

## Further Reading

| Resource | Purpose |
|---|---|
| [Full conformance report](../spec-compliance/CONFORMANCE.md) | Targeted ECMA-376 sections and non-goals |
| [Conformance workflow](../spec-compliance/README.md) | Registry and generation mechanics |
| [Invariant registry](../verification/INVARIANTS.md) | Verification claims, caveats, and falsifiers |
| [Lean verifier](../verification/lean/README.md) | Formal model and remaining specification gaps |
| [Core support contract](../packages/docx-core/SUPPORT.md) | AI-attributable edit behavior |
| [MCP assumptions](../packages/docx-mcp/assumptions.md) | Runtime and tool assumptions |
