## Context

Lean proves properties of admitted models and supplies a compiled checker over
finished packages. TypeScript generators and replay engines produce artifacts.
LibreOffice and PDF rasterization expose environment-dependent presentation.
These are complementary trust domains and must not collapse into one green
boolean produced by the authoring implementation.

## Goals / Non-Goals

### Goals

- Verify finished bytes independently from the generator.
- Make exact semantic replay and zero-loss authored-redline minimality mandatory.
- Bind a rendered PDF to the tracked DOCX markup view when PDF is required.
- Provide falsifiable negative controls and truthful `not_run` outcomes.
- Preserve client confidentiality while retaining de-identified regressions.

### Non-Goals

- Formally prove LibreOffice, PDF rendering, OCR, pagination, or human judgment.
- Put legal authorization or client-specific policy into Safe DOCX.
- Publish private matter documents or derivative substantive text.
- Make renderer dependencies mandatory for ordinary Safe DOCX editing.

## Decisions

### 1. Independent package boundary

`@usejunior/docx-release-verifier` SHALL NOT import mutation, comparison,
accept/reject, or redline-generation implementations from `docx-core`,
`docx-compare`, or `docx-markdoc`. It may invoke the compiled Lean checker as a
separate process and use its own bounded ZIP/XML projection for manifest-level
expectations and negative controls. Inputs are paths plus hashes, never
generator IR.

### 2. Layered certificate

The certificate records separate `pass`, `fail`, or `not_run` results for:

1. independent accept/reject semantic equivalence;
2. emitted-redline LCS minimality;
3. field/comment/package integrity;
4. caller-declared present/absent and literal-count expectations;
5. optional rendered-PDF markup equality and revision-color controls; and
6. explicit human visual review metadata supplied by the caller.

Required `not_run` blocks delivery. Exit codes are 0 pass, 1 verified failure,
and 3 incomplete/not-run.

### 3. Lean minimality evidence

The compiled checker independently tokenizes aligned original/revised
paragraphs, computes the exact token LCS, and compares it with tokens left in
ordinary non-revision runs in the finished redline. Evidence includes available
preservable tokens, preserved tokens, lost tokens, efficiency, and bounded
paragraph diagnostics. Authored-redline policy defaults to zero lost tokens and
100% efficiency. The theorem-backed LCS supplies optimality; the checker binds
that result to emitted OOXML.

### 4. Renderer verifier is optional and separate

`@usejunior/docx-render-verifier` owns disposable LibreOffice profiles,
configured and by-author control renders, PDF text extraction, pixel-band
measurements, and review-page rasterization. It never mutates the authoritative
DOCX. Render-only compatibility transforms must be explicit, hashed, narrowly
scoped, and included in the certificate. Absence of required external tools is
`not_run`, never pass.

### 5. Fixtures and private corpus

Public fixtures contain synthetic documents or minimized, de-identified OOXML
shapes with a provenance/license sidecar. Real matters are addressed through a
gitignored manifest containing local paths, expected hashes, policies, and
non-substantive case labels. The harness outputs certificates only to ignored
directories and refuses manifests or outputs under tracked fixture paths.

## Risks / Trade-offs

- **Duplicated parsing:** independence requires some duplication. Mitigation:
  keep the verifier projection narrow and prohibit generator imports by test.
- **Lean protocol growth:** minimality adds payload and runtime. Mitigation:
  bounded token/paragraph limits and versioned additive protocol fields.
- **Renderer instability:** pixel counts vary. Mitigation: broad calibrated
  bands, a same-input negative control, text equality, and human review.
- **Fixture leakage:** minimized client text may remain identifying. Mitigation:
  synthetic-first policy, automated forbidden-string/metadata scans, explicit
  provenance, and private manifests for real cases.

## Migration Plan

1. Ship packages and additive certificates without changing generator APIs.
2. Run public synthetic fixtures and an opt-in private completed-matter corpus.
3. Require the independent certificate for `docx-markdoc` delivery readiness.
4. Keep renderer verification conditional unless the manifest requires a PDF.
5. Deprecate ambiguous generator-local `deliveryReady` naming after consumers
   migrate; retain its replay fields for diagnostics.
