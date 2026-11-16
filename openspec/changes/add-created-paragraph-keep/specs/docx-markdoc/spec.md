## ADDED Requirements

### Requirement: Pagination flags on created paragraph layout

`{% paragraph-layout %}` SHALL admit two flags, each written only as `true`:
`keep-with-next`, written as `w:keepNext`, and `keep-lines`, written as
`w:keepLines`, in the paragraph's own `w:pPr` in the order the schema gives
them. A flag SHALL count as the attribute the tag needs, alone or with
`align`, `indent-left` and `indent-hanging`; any other value SHALL fail with
`INVALID_PARAGRAPH_LAYOUT` before any output. A paragraph that `create` also
keeps with the next one (before a legend or a first signer) SHALL carry one
`w:keepNext`.

The read-back SHALL compare each body paragraph's direct `w:keepNext` and
`w:keepLines`, with its `w:jc` and `w:ind`, against the lowering's
projection. The round trip SHALL compare them against the flags the source
writes: a `w:keepLines`, or a `w:keepNext` on a paragraph whose tag asks for
it, SHALL be part of the layout compared; a `w:keepNext` that `create` sets
by its own rules on a paragraph whose source does not ask for one SHALL not
count as a layout. `pull` SHALL write a body paragraph's direct `w:keepNext`
and `w:keepLines` as the flags when it writes the paragraph in a
`{% paragraph-layout %}` tag, except a `w:keepNext` on a paragraph just before a legend or a signature block, which `create` sets again by its own rule.

#### Scenario: [SDX-MDOC-PARAKEEP-01] keep flags are written once, in schema order, and verified
- **GIVEN** a notices section whose caption is in `{% paragraph-layout align="left" indent-left="0.5" keep-with-next=true %}`, an address block in `{% paragraph-layout align="left" indent-left="1" keep-lines=true %}`, and a closing line in `{% paragraph-layout keep-with-next=true %}` just before a first signer
- **WHEN** the source is created
- **THEN** the caption SHALL carry `w:keepNext` before `w:jc` and `w:ind`, the address block `w:keepLines`, and the closing line exactly one `w:keepNext`
- **AND** the read-back and round-trip layout comparisons SHALL pass with their negative controls detected, and the source oracle SHALL list `keepNext` and `keepLines` in each layout token

#### Scenario: [SDX-MDOC-PARAKEEP-02] verification fails when an authored keep is lost
- **GIVEN** a lowering whose spec drops the caption's `keepNext`
- **WHEN** it is created
- **THEN** the build SHALL fail with `CREATION_VERIFICATION_FAILED`, the read-back and the round trip naming the caption

#### Scenario: [SDX-MDOC-PARAKEEP-03] a keep flag with any value but true fails closed
- **GIVEN** sources with `keep-with-next="true"`, `keep-with-next=false` and `keep-lines="yes"`
- **WHEN** each is created
- **THEN** creation SHALL fail before writing any output with `INVALID_PARAGRAPH_LAYOUT`, while `{% paragraph-layout keep-lines=true %}` alone SHALL be accepted

#### Scenario: [SDX-MDOC-PARAKEEP-04] pull writes the keep flags back
- **GIVEN** created documents whose `{% paragraph-layout %}` paragraphs carry keep flags, edited in Word to retype all of one paragraph's words, and to change a word of another
- **WHEN** each edit is pulled and the pulled source is created again
- **THEN** the retyped paragraph SHALL be written in a tag with the same flags, the edited one SHALL keep its tag, each pull SHALL be complete, and the rebuilt document SHALL carry the same `w:keepNext` and `w:keepLines`
- **AND** a retyped plain paragraph just before a signer SHALL be written without a flag
