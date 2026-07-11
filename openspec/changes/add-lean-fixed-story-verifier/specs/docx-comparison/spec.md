## ADDED Requirements

### Requirement: Compiled verifier checks fixed WordprocessingML stories from DOCX packages

The system SHALL pass the original, revised, and compared DOCX packages to the compiled Lean verifier. The verifier process SHALL extract and independently check `word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml`, without a TypeScript implementation of its verification predicates.

#### Scenario: [LEAN-STORY-01] Fixed stories pass together
- **GIVEN** a valid inplace package triple with main, footnote, and endnote stories
- **WHEN** the compiled verifier runs
- **THEN** it returns a passing report for every supplied story

#### Scenario: [LEAN-STORY-02] Side-story state is isolated
- **GIVEN** a malformed field sequence in one optional story
- **WHEN** markers in another story would balance the aggregate counts
- **THEN** the verifier rejects the malformed story and the collection

### Requirement: Missing optional stories are modeled explicitly

The verifier SHALL require `word/document.xml` in all three packages. When any package contains an optional note story, the verifier SHALL model an absent side as an empty token story and check the resulting triple. It SHALL omit an optional story only when all three packages omit it.

#### Scenario: [LEAN-STORY-03] Optional presence is modeled as an empty story
- **WHEN** a footnote or endnote part is absent from one side of a package triple
- **THEN** the verifier reports that side as absent and checks it as empty
- **AND** tracked additions/removals can pass while untracked divergence fails

### Requirement: Reserved note entries have an explicit proved projection

The Lean verifier SHALL exclude reserved separator and continuation-separator note entries from user-visible note text equivalence through a Lean-defined projection whose key properties are machine-checked.

#### Scenario: [LEAN-STORY-04] Reserved separator text is excluded
- **GIVEN** differing reserved separator entries and equal user note text
- **WHEN** the note story is checked
- **THEN** reserved entry differences do not cause text divergence

### Requirement: Fixed-story certificates state their boundary

The document-integrity certificate SHALL report per-story results and SHALL not imply validation of relationships, note references, comments, headers, footers, rendering, or full ECMA-376 conformance.

#### Scenario: [LEAN-STORY-05] Side-story divergence is visible
- **WHEN** accept or reject text diverges in a supplied note story
- **THEN** the certificate is failed and identifies the failed story checks

### Requirement: WordprocessingML parsing is namespace aware and fail closed

The compiled Lean parser SHALL resolve qualified names to namespace URIs, accept any prefix bound to the supported WordprocessingML namespace, require the expected expanded-name root for each fixed part, and reject malformed or unbound XML.

#### Scenario: [LEAN-STORY-06] Alternate namespace prefixes preserve checks
- **WHEN** a fixed story uses a non-`w` prefix bound to the WordprocessingML namespace
- **THEN** the verifier recognizes its tracked text and fields
- **AND** divergent text cannot pass as an empty projection

### Requirement: Package extraction and protocol output are bounded and validated

The launcher and compiled verifier SHALL enforce package, compressed-entry, expanded-entry, compression-ratio, diagnostics, and protocol-output bounds. Missing entries SHALL be distinguished from corrupt archives. The launcher SHALL reject duplicate or unknown stories, invalid counts, extra fields, and inconsistent pass bits, and SHALL terminate verifier descendant processes on timeout.

#### Scenario: [LEAN-STORY-07] Unsafe package extraction fails closed
- **WHEN** a package is corrupt, oversized, or exceeds the compression-ratio limit
- **THEN** the certificate status is `not_run` with no passing claim

#### Scenario: [LEAN-STORY-08] Public certificate remains v1 compatible
- **WHEN** fixed-story evidence is returned
- **THEN** the existing certificate protocol, verifier, scope, hashes, main checks, and counts remain available
- **AND** package/story evidence is additive

#### Scenario: [LEAN-STORY-09] Inconsistent executable protocol is rejected
- **WHEN** the executable returns duplicate stories, invalid counts, unknown fields, or inconsistent pass values
- **THEN** the launcher returns `not_run`
