## 1. Specification and conformance

- [x] 1.1 Validate this OpenSpec proposal and delta requirements.
- [x] 1.2 Register exact ECMA-376 inline SDT, content, and property sections.
- [x] 1.3 Add JSDoc and Allure citations only for normative SDT structure; label extension preservation as a SafeDocX metamorphic invariant.

## 2. Opaque passthrough substrate

- [x] 2.1 Add the generic opaque-node descriptor to the parsed comparison model.
- [x] 2.2 Capture inline SDT occurrence identity, semantic fingerprint, ordered payload, and effective namespace/MCE bindings.
- [x] 2.3 Validate counterpart, ownership, contiguity, collision, nesting, and mutation rules and fail closed on unsafe emission.
- [x] 2.4 Emit each validated opaque boundary once in paragraph order while retaining edits outside it.

## 3. Focused and corpus evidence

- [x] 3.1 Add shared synthetic inline-SDT fixtures and forced-rebuild tests for run placement, split runs, multiple controls, local/root declarations, aliases, extension ordering, and outside edits.
- [x] 3.2 Add mutation/negative tests for changed payload, missing counterpart, malformed namespaces/MCE, nested boundaries, and ownership/order failures.
- [x] 3.3 Add a separately labeled real-DOCX no-regression corpus measurement without presenting block-SDT evidence as inline coverage.

## 4. Neutral suite projection

- [x] 4.1 Pin docx-platform-tests commit `fe0ee99602e6f982255ecaa2b45d4936a7f46150` and refresh the reviewed upstream registry files and hashes.
- [x] 4.2 Reconcile and regenerate the SafeDocX capability projection.
- [x] 4.3 Run both neutral content-control scenarios and record that ordinary SafeDocX already passes them; retain forced rebuild as the distinguishing evidence.

## 5. Verification and delivery

- [x] 5.1 Run focused tests, package build/lint, and mandatory repository pre-submit gates.
- [x] 5.2 Run open-package and LibreOffice smoke checks when available.
- [x] 5.3 Review the diff for bounded scope and commit with a conventional message explaining why, with `Ref: #582`.

## 6. Independent review follow-up

- [x] 6.1 Bind opaque ownership to paragraph/container identity and reject correlation loss before whole-paragraph emission.
- [x] 6.2 Validate descendant namespace/MCE ownership at effective scope and cover local shadowing.
- [x] 6.3 Make emitted-schema MCE preprocessing scope-aware and validate CI-captured positive output.
- [x] 6.4 Constrain DPT pass statuses by normative versus metamorphic oracle class.
- [x] 6.5 Re-run focused/full verification, DPT, schema, and LibreOffice checks and commit the follow-up.

## 7. Performance review follow-up

- [x] 7.1 Memoize opaque paragraph identity for one LCS run without retaining stale cross-run state.
- [x] 7.2 Instrument identity computation counts and cover ordinary, multiple-control, and between-run mutation cases.
- [x] 7.3 Re-run focused/full comparison verification and commit the performance fix.
