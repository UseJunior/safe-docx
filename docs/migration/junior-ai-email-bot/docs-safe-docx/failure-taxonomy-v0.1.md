# DOCX Failure Taxonomy v0.1

Status: Draft v0.1 (Sprint 2 artifact)  
Scope owner: Safe Docx / DOCX Primitives maintainers  
Intent: Operational taxonomy for engineering and support triage.

## Failure Classes

| Class ID | Class | Description | Typical examples |
| --- | --- | --- | --- |
| `REL-FAIL-PARSE` | Parse/Input Integrity | Input cannot be safely parsed/loaded within guardrails. | Corrupt ZIP, malformed XML, archive guard threshold violations |
| `REL-FAIL-TRANSFORM` | Transformation/Mutation Safety | Requested edit/layout transform cannot be safely applied. | Ambiguous match, invalid selector, unsupported container boundary edit |
| `REL-FAIL-REDLINE` | Redline Semantics | Generated tracked output does not satisfy expected revision semantics in scope. | Missing `w:ins`/`w:del`, reject/accept round-trip mismatch |
| `REL-FAIL-DETERMINISM` | Determinism/Repeatability | Same inputs/config/version yield semantically divergent results. | Non-repeatable anchor mapping, nondeterministic output semantics |
| `REL-FAIL-SAFETY` | Runtime Safety Boundary | Filesystem/path/archive protections are bypassed or incomplete. | Symlink escape, write outside allowed roots, unsafe archive expansion |

## Severity Model

| Severity | Definition | Default user-visible behavior | Contractual output policy |
| --- | --- | --- | --- |
| `blocker` | Safety or core integrity risk; output cannot be trusted | Hard error with diagnostic code/message/hint | Fail closed |
| `high` | Strong likelihood of semantic corruption or unusable result | Hard error with diagnostic code/message/hint | Fail closed |
| `medium` | Degraded behavior with bounded impact and clear diagnostics | Warning/error diagnostics; output may proceed depending on operation | Conditional output |
| `low` | Minor quality/ergonomics issue with no core semantic loss | Warning or backlog issue; operation usually succeeds | Output allowed |

## Detection Strategy

| Detection stage | Strategy | Evidence anchors |
| --- | --- | --- |
| Preflight validation | Reject invalid selectors, invalid units, ambiguous edits before mutation | `packages/safe-docx-ts/src/tools/format_layout.ts`; `packages/safe-docx-ts/src/tools/smart_edit.ts` |
| Mutation-time invariants | Enforce field/container safety and transactional behavior during text replacement | `packages/docx-primitives-ts/src/text.ts`; `packages/safe-docx-ts/test/assumption_strict_transactionality.test.ts` |
| Redline regression tests | Verify tracked-output markers and reject/accept semantics | `packages/docx-comparison/src/integration/round-trip-inplace.test.ts`; `packages/docx-comparison/src/integration/paragraph-level-markers.allure.test.ts` |
| Safety regression tests | Validate path/symlink/archive boundary behavior | `packages/safe-docx-ts/test/assumption_path_policy_symlink_bounds.test.ts`; `packages/safe-docx-ts/test/assumption_archive_guard_limits.test.ts` |
| Determinism regression tests | Validate stable session/anchor behavior under repeat or concurrent operations | `packages/safe-docx-ts/test/assumption_concurrency_determinism.test.ts`; `packages/safe-docx-ts/test/assumption_paragraph_id_collision_safety.test.ts` |

## User-Visible Error Behavior

| Failure class | Expected surfaced behavior |
| --- | --- |
| `REL-FAIL-PARSE` | Return structured error; no session mutation; include actionable hint (for example re-export `.docx`, reduce archive size). |
| `REL-FAIL-TRANSFORM` | Return structured error with operation-specific remediation hint (narrow `old_string`, fix selector). |
| `REL-FAIL-REDLINE` | Block tracked output for blocker/high conditions; return diagnostic context and preserve clean output only when safe. |
| `REL-FAIL-DETERMINISM` | Mark as reliability regression; require reproducible case; block release if blocker/high. |
| `REL-FAIL-SAFETY` | Hard fail with explicit boundary error; no write side-effects outside allowed policy. |

## Triage Ownership and Remediation Targets

Targets below are internal engineering targets for prioritization, not external SLA commitments.

| Severity | Primary triage owner | Target acknowledgment | Target remediation window |
| --- | --- | --- | --- |
| `blocker` | Safe Docx maintainer on call | Same business day | 24 hours for mitigation/hotfix target |
| `high` | Relevant package maintainer (`safe-docx`, `docx-primitives`, or `docx-comparison`) | 1 business day | 3 business days target |
| `medium` | Package maintainer | 2 business days | Next planned patch/minor, target <= 14 days |
| `low` | Package maintainer | 5 business days | Backlog queue; target <= 45 days |

## Escalation Rules

- Any repeated `blocker`/`high` in the same failure class within one release cycle escalates to release gate review.
- Any `REL-FAIL-SAFETY` incident is treated as release-blocking until fixed or formally risk-accepted by maintainer.
- Any `REL-FAIL-DETERMINISM` that invalidates `REL-INV-011`/`REL-INV-012` evidence requires contract re-baselining before new guarantees are published.
