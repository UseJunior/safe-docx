# Cross-Implementation Conformance Delta

## ADDED Requirements

### Requirement: Conformance Adapter CLI

docx-core SHALL ship a `safe-docx-conformance-adapter` executable implementing the docx-platform-tests adapter protocol v1: it MUST read an operation descriptor (`--operation operation.json`) and an input package (`--input input.docx`), apply the operation with existing docx-core primitives, and write the mutated package (`--output output.docx`), exiting 0. For an operation it does not implement, it MUST exit with code 2 and print a one-line reason — never fabricate output. Protocol-version mismatches MUST exit with code 3.

#### Scenario: acceptAllTrackedChanges round-trip through the adapter

- **WHEN** the adapter is invoked with protocol v1, an `acceptAllTrackedChanges` operation descriptor, and an input .docx whose body contains `w:ins`-wrapped runs
- **THEN** it exits 0 and the output package's `word/document.xml` contains the formerly wrapped run content with no remaining `w:ins` wrappers, matching `acceptChanges` semantics (ECMA-376 edition 5, Part 1 § 17.13.5.18)

#### Scenario: Unknown operation declined honestly

- **WHEN** the adapter receives an operation descriptor whose `operationName` is outside its implemented set
- **THEN** it exits with code 2, prints a one-line reason to stdout, and writes no output package

### Requirement: Suite Self-Check Test

docx-core SHALL include an integration test that executes the conformance adapter against every scenario in a local docx-platform-tests checkout (located via the `DOCX_PLATFORM_TESTS_DIR` environment variable) and fails if safe-docx's output violates any scenario assertion. When the checkout is absent the test MUST skip with a logged warning rather than fail, so developer machines without the suite stay green while CI — which provisions the checkout — keeps the gate live.

#### Scenario: Suite checkout present and safe-docx agrees

- **WHEN** `DOCX_PLATFORM_TESTS_DIR` points at a valid suite checkout and the adapter's outputs satisfy all scenario assertions
- **THEN** the self-check test passes

#### Scenario: Suite checkout absent

- **WHEN** `DOCX_PLATFORM_TESTS_DIR` is unset or names a missing directory
- **THEN** the self-check suite is skipped and a warning identifying the skip reason is logged

### Requirement: Pinned Suite Revision

The self-check SHALL record the docx-platform-tests revision it was validated against in a committed pin file (`docx-platform-tests.pin.json`). A checkout whose HEAD differs from the pin MUST produce a warning naming both SHAs while the test still runs, and CI MUST clone the suite at the pinned revision so gate results are reproducible.

#### Scenario: Checkout ahead of the pin

- **WHEN** the self-check runs against a suite checkout whose HEAD SHA differs from the pinned SHA
- **THEN** the test logs a warning naming the pinned and actual SHAs and still executes the scenarios
