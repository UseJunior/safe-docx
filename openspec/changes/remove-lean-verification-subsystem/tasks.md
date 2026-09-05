## 1. Inventory and coverage preservation

- [x] 1.1 Inventory Lean-only runtime, CI, API, documentation, and spec surface
- [x] 1.2 Map each user-visible Lean-checked invariant to existing TypeScript coverage
- [x] 1.3 Add missing TypeScript regression/property coverage before removal

## 2. Runtime and API removal

- [x] 2.1 Remove the Lean verifier supervisor and tests
- [x] 2.2 Remove atomizer pipeline integration, options, exports, and certificate fields
- [x] 2.3 Remove Lean-dependent integration and differential tests

## 3. Build and repository removal

- [x] 3.1 Remove `verification/lean` and `.github/workflows/lean-build.yml`
- [x] 3.2 Remove Lean-only scripts, caches, quality-gate rules, and traceability entries
- [x] 3.3 Update contributor and release documentation

## 4. Specification cleanup

- [x] 4.1 Remove Lean-specific canonical `docx-comparison` requirements
- [x] 4.2 Rewrite retained behavioral requirements without Lean coupling
- [x] 4.3 Supersede and archive active `verify-lean-*` changes

## 5. Verification

- [x] 5.1 Confirm no live Lean references remain outside archived history
- [x] 5.2 Run the full repository pre-submit suite
