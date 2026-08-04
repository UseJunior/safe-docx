# Trust And Conformance

Safe Docx treats document safety and standards conformance as scoped, inspectable properties. Claims should identify the behavior, evidence, and boundary they cover.

## Trust Model

The MCP server and CLI run as local Node.js processes:

- document files are read from permitted local paths;
- mutations are held in a local document session;
- outputs are written to caller-selected permitted paths;
- no Safe Docx hosted service receives document content.

Safe Docx does not control a surrounding agent, MCP client, or model provider. Text returned by a read operation may be sent to the configured model by that client or agent.

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

## Optional Document Integrity Check

`compare_documents` accepts `verify_document_integrity=true`. When a compiled Lean checker is available, Safe Docx passes the actual original, revised, and comparison `word/document.xml` parts to a separately compiled executable and returns `document_integrity` metadata.

The checker validates selected invariants of that document triple, including that accepting the comparison recovers the revised text projection and rejecting it recovers the original text projection, within the checker's documented normalization and model boundaries.

If the executable is unavailable, the result is `status: "not_run"`. Absence of the optional checker never becomes a verified claim.

Source checkouts look for:

```text
verification/lean/.lake/build/bin/leanDocxChecker
```

Set `SAFE_DOCX_LEAN_XML_CHECKER` to use another executable. Normal package usage does not require Lean or Lake.

The installed CLI exposes the same opt-in boundary:

```bash
safe-docx compare original.docx revised.docx redline.docx --verify
safe-docx compare original.docx revised.docx redline.docx \
  --certificate redline.certificate.json
safe-docx compare original.docx revised.docx redline.docx \
  --certificate redline.certificate.json --certificate-format llm
```

`--certificate` and `--certificate-format` imply `--verify`. The default
certificate format is `full`, the unchanged public v1 certificate. Use `llm`
for a deterministic, versioned projection that defines repeated invariants once,
groups stories with identical results, and keeps failures, exclusions, hashes,
and structured protocol evidence explicit for machine reasoning.

A verified CLI comparison uses a 10-second
checker budget and writes neither artifact unless the certificate passes. The
command's JSON response includes the certificate under `verification`; the
optional certificate file contains the same selected JSON value.

The checker validates the documents presented to it. It is not a proof of the TypeScript source code, visual fidelity, or the complete ECMA-376 standard.

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
| [Testing and evidence](testing-and-evidence.md) | Behavioral specifications, automated tests, and verification layers |
| [Core support contract](../packages/docx-core/SUPPORT.md) | AI-attributable edit behavior |
| [MCP assumptions](../packages/docx-mcp/assumptions.md) | Runtime and tool assumptions |
