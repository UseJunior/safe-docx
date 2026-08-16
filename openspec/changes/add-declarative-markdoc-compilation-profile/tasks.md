## 1. Schema and validation

- [x] 1.1 Add compilation profile and explicit rationale visibility to Markdoc schema, IR, parser, and diagnostics.
- [x] 1.2 Reject legacy rationale category and require explicit visibility.
- [x] 1.3 Test singleton, identity completeness, date parsing, unknown visibility, and pre-mutation failures.

## 2. Compile resolution and certification

- [x] 2.1 Resolve Markdoc/API identity and complete CLI rendering overrides with documented precedence.
- [x] 2.2 Record resolved values and provenance in the certificate without implying authenticated identity.
- [x] 2.3 Prove compile and standalone validate use the same validation path.

## 3. CLI-only workflows

- [x] 3.1 Add safe attribution/external-comment CLI overrides and CLI-only internal-comment capability.
- [x] 3.2 Enforce distinct paths, no overwrite, forced external/internal warning suffixes, and Unicode-safe filename truncation.
- [x] 3.3 Warn for suppressed external rationales and stay silent for excluded internal rationales.
- [x] 3.4 Test that Markdoc content cannot enable internal comments and omission of the dangerous flag stays external-only.

## 4. Documentation and verification

- [x] 4.1 Document import output, optional validate, automatic compile validation, and full no-JavaScript workflow.
- [x] 4.2 Add real-document CLI smoke coverage for deterministic external comments and guarded internal output.
- [x] 4.3 Run all mandatory repository pre-submit gates and update this checklist only after they pass.
