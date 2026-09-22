## ADDED Requirements

### Requirement: Authored redline evidence discloses readability coalescing

The independent release verifier SHALL keep `authored-zero-loss` as the only
authored-redline gate. From finished tracked markup alone it SHALL additionally
report, per paragraph and in total, the coalesced-space count of every adjacent
content-bearing deletion-to-insertion group. A group is a maximal sequence of
content-bearing `w:del` wrappers immediately followed by content-bearing
`w:ins` wrappers, separated only by non-content markers; insertion-before-
deletion does not qualify. The count SHALL tokenize each side with the existing
exact tokenizer, exclude each side's first and last token, and sum, for each
distinct U+0020-only token value, the lesser occurrence count on the two sides.
A group with a nonzero count is one grouped chain. This disclosure SHALL NOT
change the gate verdict or `lostTokensByClass`.

Artifacts whose replacement fragments remain separated by ordinary whitespace
SHALL report zero grouped chains and zero coalesced spaces. Grouping that also
consumes an anchored edge space, common lexical token, punctuation token, or
structural whitespace SHALL continue to fail the existing zero-loss gate with
the lost token classified independently.

#### Scenario: [REL-VERIFY-13] Readable grouping passes zero-loss and is disclosed
- **GIVEN** finished tracked markup whose only deviation from the alternating shape is U+0020 bridge spaces cloned into one adjacent content-bearing deletion/insertion group
- **WHEN** verification runs under `authored-zero-loss`
- **THEN** lost preservable tokens SHALL equal zero
- **AND** coalesced-whitespace evidence SHALL report the grouped chain, bridged-space count, and paragraph

#### Scenario: [REL-VERIFY-14] Ungrouped token-minimal shape has no readability disclosure
- **GIVEN** finished tracked markup whose replacement fragments remain separated by ordinary whitespace
- **WHEN** verification runs under `authored-zero-loss`
- **THEN** lost preservable tokens SHALL equal zero
- **AND** grouped-chain and coalesced-space counts SHALL equal zero

#### Scenario: [REL-VERIFY-15] Over-broad grouping still fails zero-loss
- **GIVEN** grouping that consumes an anchored edge space, a common lexical token, punctuation, or structural whitespace
- **WHEN** verification runs under `authored-zero-loss`
- **THEN** the gate SHALL fail
- **AND** evidence SHALL identify the lost token by class separately from readability disclosure
