## 1. Lean verifier core

- [x] 1.1 Add `Tier2/XmlTokens.lean` with the first relevant WordprocessingML token type and raw XML token scanner for `document.xml`.
- [x] 1.2 Add `Tier2/XmlTokenAcceptReject.lean` or equivalent definitions for token-level accept/reject projections.
- [x] 1.3 Add token-level field-structure validation and text extraction/normalization definitions, reusing existing Tier 2 concepts where possible.
- [x] 1.4 Add `Tier2/Checker.lean` with `comparisonCheckerB` and a structured `CheckReport`.
- [x] 1.5 Prove a checker soundness theorem whose conclusion is the four plain properties: accept/reject field structure and accept/reject text recovery.
- [x] 1.6 Confirm `#print axioms` for the checker soundness theorem contains no project residual-obligation axioms.

## 2. Lean executable

- [x] 2.1 Add a `leanDocxChecker` executable to `verification/lean/lakefile.lean`.
- [x] 2.2 Implement JSON stdin/stdout protocol v1 for original/revised/combined `document.xml` strings.
- [x] 2.3 Return plain check names, pass/fail status, parsed token counts, and TypeScript-side input XML hashes.
- [x] 2.4 Add fixture-level Lean executable smoke tests over real `document.xml` triples.

## 3. TypeScript integration

- [x] 3.1 Add a TypeScript verifier invocation module that passes the original, revised, and output `word/document.xml` strings to `leanDocxChecker`.
- [x] 3.2 Add a `DocumentIntegrityCertificate` field to `CompareResult` for atomizer outputs.
- [x] 3.3 Attach `passed` certificates only when the Lean checker ran successfully on `reconstructionModeUsed === 'inplace'`.
- [x] 3.4 Attach `not_applicable`, `not_run`, or `failed` certificates without overclaiming for rebuild mode, missing checker executable, parse errors, or checker failures.

## 4. Coverage ledger

- [x] 4.1 Add a checker coverage ledger recording parsed WML tags/attributes, ignored surfaces, and out-of-scope ECMA-376 areas.
- [x] 4.2 Add a drift check or validation script for the ledger so future checker expansion remains deliberate.
- [x] 4.3 Reference the ledger from verifier docs and certificate audit metadata, not from normal product text.

## 5. Tests and CI

- [x] 5.1 Add integration tests showing successful inplace output receives a passed certificate with plain property names.
- [x] 5.2 Add tests showing rebuild output does not claim Lean verification.
- [x] 5.3 Add tests showing checker failure or absence is reported honestly.
- [ ] 5.4 Add a differential/oracle suite comparing Lean checker results to existing TS safety-check fixture expectations.
- [x] 5.5 Extend the Lean build/audit path to build `leanDocxChecker` and audit checker theorem axioms.
- [ ] 5.6 Run `npm run build`, `npm run lint:workspaces`, `npm run test:run`, `npm run check:spec-coverage`, conformance checks, `lake build`, and the checker axiom audit.

## 6. Documentation

- [x] 6.1 Document the public claim in plain English: a Lean verifier checked this XML triple; it is not a proof of the entire TypeScript engine.
- [x] 6.2 Document non-goals: rebuild, rendering, formatting fidelity, ancillary parts, and full ECMA namespace coverage.
- [x] 6.3 Add a handoff section for future increments: MCP save certificate, red-team demo, and broader ECMA checker expansion.
