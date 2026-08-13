# Testing And Evidence

Safe Docx documents intended behavior as scenarios and tests it at several boundaries. These layers provide different kinds of evidence; no single layer proves the entire implementation.

## Behavioral Specifications

OpenSpec files describe user-visible requirements with GIVEN, WHEN, and THEN scenarios. Tests attach matching scenario identifiers so CI can detect requirements without mapped coverage.

OpenSpec is the repository's statement of intended behavior. It does not prove that an implementation is correct for every document.

## Automated Tests

| Test layer | Purpose |
|---|---|
| Unit tests | Exercise individual parsing, editing, and serialization rules |
| Integration tests | Run complete document operations across package boundaries |
| Document fixtures | Exercise realistic DOCX shapes, side parts, and tracked revisions |
| Property tests | Explore generated inputs and invariants beyond named examples |
| Differential tests | Compare two implementations over the same defined projection |
| Reference oracles | Compare selected behavior with tools such as LibreOffice |

Tests use shared DOCX builders and OOXML fixtures so repeated package shapes have one canonical implementation.

## Diagnosing A Comparison Failure

Automated tests cover named shapes. Diagnosing a comparison failure on a document outside the corpus is a separate procedure, because some failure classes leave extracted text unchanged and therefore pass every text-level check. The [comparison failure diagnosis guide](comparison-failure-diagnosis.md) states those classes, the structural detectors that catch them, and the criterion a diagnostic run has to clear before it counts as a pass.

## Human-Readable Test Evidence

Tests attach Allure metadata describing the capability, scenario, conformance citation, and business-readable steps. Generated reports make the exercised behavior easier to inspect without treating report prose as a separate source of requirements.

## ECMA-376 Evidence

OOXML behavior can carry:

- an `@conformance` source citation;
- matching conformance metadata on tests;
- a registry entry with a normative schema reference;
- structural validation against vendored schemas.

The generated [conformance report](../spec-compliance/CONFORMANCE.md) is the index of claimed sections and explicit non-goals.

## Independent Verification

Release verification uses deterministic TypeScript package, replay,
expectation, comment-integrity, mutation-control, and renderer-evidence gates.
This validates properties of particular artifacts; it does not prove visual
fidelity or the complete ECMA-376 standard.

See the [invariant registry](../verification/INVARIANTS.md) and
[trust and conformance guide](trust-and-conformance.md) for exact boundaries.
