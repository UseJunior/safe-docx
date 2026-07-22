## Context

The verification spike already proves model-level invariants, but a consumer does not care that a Lean model is internally coherent unless the proof connects to the actual DOCX output. The commercially useful architecture is translation validation:

1. TypeScript produces a comparison output.
2. Lean receives the actual XML triple: original `word/document.xml`, revised `word/document.xml`, and combined output `word/document.xml`.
3. Lean parses the OOXML subset needed for the checked invariants.
4. Lean runs a checker whose soundness theorem is machine-checked.
5. TypeScript reports the checker result in plain document-integrity language.

This avoids proving the whole TypeScript engine. It also avoids trusting a TypeScript mirror of the checker.

## Goals

- Make Lean the runtime verifier for the first inplace comparison invariants.
- Keep product output readable: plain property names, not internal invariant IDs or Lean theorem names.
- Make the formal trail reproducible through hashes, source commit, and a local verification command rather than URLs in every tool response.
- Preserve a context-stable route toward broader ECMA coverage through a ledger of parsed/ignored/out-of-scope XML surfaces.

## Non-Goals

- Universal proof of `compareDocumentXml`.
- Proof that all TypeScript comparison implementation paths match Lean.
- Full ECMA-376 coverage in one PR.
- Rebuild-mode verification.
- Rendering, layout, formatting-fidelity, comments, bookmarks, footnotes, endnotes, relationships, or ancillary-part verification in the first checker.
- MCP `save` response integration or a red-team demo implementation; those are follow-on increments once the verifier core exists.

## Architecture

### Lean verifier input

The Lean executable reads JSON from stdin:

```json
{
  "protocolVersion": 1,
  "originalDocumentXml": "<w:document ...>",
  "revisedDocumentXml": "<w:document ...>",
  "combinedDocumentXml": "<w:document ...>"
}
```

The TypeScript producer may include hashes in its own certificate, but the Lean checker should compute and return its own input hashes when practical so the report is reproducible.

### Lean XML surface

The first checker parses a relevant token stream, not a full DOM:

```lean
inductive XmlTok
| pStart | pEnd
| insStart | insEnd
| delStart | delEnd
| moveFromStart | moveFromEnd
| moveToStart | moveToEnd
| fldCharBegin | fldCharSeparate | fldCharEnd
| instrText (s : String)
| delInstrText (s : String)
| text (s : String)
| delText (s : String)
```

This token stream is intentionally narrow. The checker coverage ledger records every parsed tag/attribute class and every ignored/out-of-scope namespace or element family. Future increments expand the parser and theorem set by adding rows to that ledger.

### Checker core

The checker should be a pure Lean function over parsed token streams:

```lean
def comparisonCheckerB
  (original revised combined : List XmlTok) : CheckReport := ...
```

The executable wrapper handles JSON, string parsing, and report encoding. The proof targets the pure checker and parser contracts, not incidental CLI plumbing.

The first soundness theorem should be phrased so passing the checker implies the plain properties the product reports:

```lean
theorem checker_sound :
  comparisonCheckerB original revised combined = report ->
  report.passed = true ->
    validateFieldStructureTokens (acceptTokens combined) = true ∧
    validateFieldStructureTokens (rejectTokens combined) = true ∧
    normalizeText (extractText (acceptTokens combined)) =
      normalizeText (extractText (acceptTokens revised)) ∧
    normalizeText (extractText (rejectTokens combined)) =
      normalizeText (extractText (rejectTokens original))
```

The final theorem name may differ, but CI must audit it with `#print axioms`. It must not depend on the existing residual-obligation axioms.

### TypeScript integration

TypeScript remains the producer. It extracts the three XML strings and invokes the compiled Lean executable. The certificate attached to `CompareResult` should be plain and conservative:

```ts
interface DocumentIntegrityCertificate {
  status: 'passed' | 'failed' | 'not_run' | 'not_applicable';
  checkedBy: 'safe-docx-lean-checker';
  reconstructionMode: 'inplace' | 'rebuild' | 'unknown';
  checks: {
    acceptPreservesFieldStructure: boolean | null;
    rejectPreservesFieldStructure: boolean | null;
    acceptTextMatchesRevised: boolean | null;
    rejectTextMatchesOriginal: boolean | null;
  };
  audit: {
    checkerVersion: string;
    checkerSourceCommit?: string;
    originalDocumentXmlSha256: string;
    revisedDocumentXmlSha256: string;
    combinedDocumentXmlSha256: string;
  };
  notes: string[];
}
```

Normal product output should not expose `INV-*` IDs or Lean theorem names. Those belong in verbose/debug/audit docs.

### External audit command

The follow-on CLI surface should support local reproducibility:

```bash
npm run verify:certificate -- certificate.json original.docx revised.docx output.docx
```

This can be a later task if needed, but the certificate schema must preserve enough hashes and checker metadata to make it possible.

## Risks / Trade-offs

- A narrow XML parser can under-cover OOXML. Mitigation: make coverage explicit in the ledger and refuse to overclaim.
- Lean string/XML parsing can be more work than TS DOM walking. Mitigation: start with a token scanner for the exact checked WML tags, not a full XML library.
- A CLI executable is operationally heavier than in-process TS. Mitigation: keep it optional/internal at first, cache path discovery, and fail closed in certificates (`not_run` or `failed`, never `passed`).
- The proof may initially cover a token model rather than full DOM semantics. Mitigation: the executable parses raw `document.xml` itself, so the trusted projection is inside Lean, not a TS mirror.

## Definition of Done

- The Lean executable can check real `document.xml` triples from existing fixtures.
- The checker soundness theorem is zero-`sorry` and has no project residual axioms in its `#print axioms` output.
- `CompareResult` can carry a plain certificate for inplace atomizer output.
- Rebuild output and unavailable checker states produce explicit non-passing/non-applicable certificates.
- CI runs the Lean build, checker axiom audit, and TS integration tests.
- The checker coverage ledger makes the first verified surface and remaining ECMA work auditable.
