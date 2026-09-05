## 1. Product and API removal

- [x] 1.1 Remove Lean verifier implementation, public types, options, exports, CLI surfaces, and tests.
- [x] 1.2 Remove Lean subprocess configuration from independent release verification while preserving a required TypeScript LCS-minimality certificate gate.
- [x] 1.3 Add independent minimality regressions for surgical, coarse, repeated-token, punctuation, whitespace, insertion, deletion, and ambiguous paragraph topology cases.

## 2. Repository infrastructure removal

- [x] 2.1 Delete `verification/lean`, Lean scripts, registries, and CI/build hooks.
- [x] 2.2 Remove Lean-only differential, integration, and audit tests.

## 3. Specifications and documentation

- [x] 3.1 Remove current Lean requirements and conformance evidence claims.
- [x] 3.2 Update active changes, trust documentation, capability projections, and generated artifacts.

## 4. Verification

- [x] 4.1 Run a repository-wide case-insensitive Lean-reference scan and classify any retained historical references.
- [x] 4.2 Run build, workspace lint, focused verifier/Markdoc tests, OpenSpec validation, conformance checks, and diff checks. The full comparison suite had 823 passing and 27 skipped tests; its one public-corpus test exceeded the 120-second test timeout without an assertion failure.
