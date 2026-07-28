## 1. Contract

- [x] 1.1 Define the v1 explorer manifest JSON Schema and stable identity
  grammar.
- [x] 1.2 Add schema fixtures covering targeted sections, Non-Goals,
  declaration reuse, every capability status, and categorized evidence.
- [x] 1.3 Add negative tests for duplicate/unresolved section, declaration,
  capability-axis, scenario, and evidence identities.

## 2. Deterministic exporter

- [x] 2.1 Compose section records from the conformance registry without
  re-parsing generated `CONFORMANCE.md`.
- [x] 2.2 Resolve referenced XSD declarations with conformance-class and
  target-namespace context.
- [x] 2.3 Compose capability-axis claims from the already validated Safe DOCX
  projection without changing its status/evidence semantics.
- [x] 2.4 Emit stable ordering and byte-identical output for identical inputs.

## 3. Generated artifact and checks

- [x] 3.1 Generate and commit
  `spec-compliance/generated/conformance-explorer.json`.
- [x] 3.2 Validate the artifact against its JSON Schema.
- [x] 3.3 Add semantic inventory/join validation and generated-output drift
  checks.
- [x] 3.4 Wire the focused check into root preflight without duplicating
  existing conformance or capability gates.

## 4. Consumer documentation

- [x] 4.1 Document field meanings, evidence boundaries, and compatibility
  policy.
- [x] 4.2 Document the tests-renderer pinned snapshot workflow, including exact
  upstream commit and checksum ownership.
- [x] 4.3 Cross-link Safe DOCX issue #689 and tests-renderer issue #37.

## 5. Verification

- [x] 5.1 Run focused exporter/schema/semantic-check tests.
- [x] 5.2 Run `npm run check:conformance-citations`,
  `npm run check:conformance-doc`, `npm run check:ecma-376-coverage`, and
  `npm run check:capability-projection`.
- [x] 5.3 Run the repository-mandated pre-submit chain before pushing.
