## ADDED Requirements

### Requirement: Whole-paragraph move break ownership

The tagged comparison serializer SHALL distinguish moved run content from paragraph-break ownership. It SHALL retain paired `moveFrom`/`moveTo` content ranges. For a move whose source and destination are both non-terminal body paragraphs, it SHALL retain paragraph-mark move revisions. For a single complete-paragraph move with exactly one body-story terminal endpoint and a stable, unrevised predecessor at that endpoint, it SHALL represent the removed and created paragraph breaks with `del` and `ins` paragraph-mark revisions, placing the terminal endpoint's break revision on that predecessor. When ownership cannot be applied safely, it SHALL preserve the legacy move-mark topology rather than assign a break to another move endpoint.

The serializer SHALL keep the range topology balanced, SHALL keep wrapper IDs independent from range IDs, and SHALL order paragraph-mark revisions according to the schema. The serialized verifier SHALL distinguish transformed terminal moves from intentional legacy fallbacks.

#### Scenario: Terminal destination uses created-break ownership

- **GIVEN** a single complete paragraph moves from a non-terminal source to the end of the body story, with a stable unrevised predecessor
- **WHEN** tagged move markup is serialized
- **THEN** the source paragraph mark SHALL carry `w:del`
- **AND** the stable paragraph immediately before the destination SHALL carry `w:ins`
- **AND** the terminal destination paragraph SHALL carry moved-to content without a paragraph-mark move revision

#### Scenario: Terminal source uses removed-break ownership

- **GIVEN** a single complete paragraph moves from the end of the body story to a non-terminal destination, with a stable unrevised predecessor at the source
- **WHEN** tagged move markup is serialized
- **THEN** the stable paragraph immediately before the source SHALL carry `w:del`
- **AND** the destination paragraph mark SHALL carry `w:ins`
- **AND** the terminal source paragraph SHALL carry moved-from content without a paragraph-mark move revision

#### Scenario: Middle move retains paragraph-mark move ownership

- **GIVEN** both complete-paragraph move endpoints are non-terminal body paragraphs
- **WHEN** tagged move markup is serialized
- **THEN** their paragraph marks SHALL retain `w:moveFrom` and `w:moveTo`
- **AND** their move range starts SHALL be owned by the moved paragraphs

#### Scenario: Supported readers project exact states

- **GIVEN** a single supported plain, bookmark-bearing, numbered, or genuine-empty body-paragraph move with stable unrevised neighbours
- **WHEN** Microsoft Word or the required independent reader accepts or rejects all revisions
- **THEN** Accept SHALL match the revised paragraph state
- **AND** Reject SHALL match the original paragraph state
- **AND** no tracked revision or synthetic whitespace SHALL remain

#### Scenario: Adjacent detected moves retain conservative ownership

- **GIVEN** two detected moves share a paragraph-break relocation target that is itself a move endpoint
- **WHEN** tagged move markup is serialized
- **THEN** the serializer SHALL retain the legacy paragraph-mark move topology for the conflicting move
- **AND** internal Accept and Reject projections SHALL preserve the exact revised and original paragraph lists

LibreOffice may retain a trailing empty paragraph on Reject for adjacent-move chains in this legacy topology. Exact independent-reader projection of those chains is outside this change's supported envelope.

### Requirement: Move-range bookmark projection

The AST Accept/Reject projector SHALL treat bookmark boundaries enclosing only moved content as belonging to that move side even when the boundaries are direct paragraph children rather than descendants of a `moveFrom` or `moveTo` wrapper. It SHALL preserve bookmarks that also enclose untracked surviving content.

#### Scenario: Accept removes source-range bookmarks

- **GIVEN** original-side bookmark boundaries enclose only moved-from content
- **WHEN** all revisions are accepted
- **THEN** the original-side bookmark pair SHALL be removed with the moved-from projection
- **AND** the destination-side bookmark pair SHALL remain unique and balanced

#### Scenario: Reject removes destination-range bookmarks

- **GIVEN** revised-side bookmark boundaries enclose only moved-to content
- **WHEN** all revisions are rejected
- **THEN** the destination-side bookmark pair SHALL be removed with the moved-to projection
- **AND** the source-side bookmark pair SHALL remain unique and balanced
