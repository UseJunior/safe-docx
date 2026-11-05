## ADDED Requirements

### Requirement: Bookmark splits collapse when one range serves both projections

Tagged publication SHALL NOT keep a bookmark split into original-side and revised-side ranges when the original-side range, placed as authored, yields the original range under Reject All and the revised range under Accept All. Such a bookmark SHALL be published once, under its source name, so neither projection sees a generated name. A split that no single range satisfies SHALL keep the collision-safe original-side name. Bookmark hoisting SHALL NOT leave a run-level `w:ins` or `w:del` with no content.

#### Scenario: Reject All restores the original bookmark names and Accept All yields the revised ones

- **GIVEN** a Word-authored real-corpus agreement and a revision that deletes one paragraph
- **WHEN** the two are compared
- **THEN** the paired bookmark names of the Reject All projection SHALL equal the original's
- **AND** the paired bookmark names of the Accept All projection SHALL equal the revision's
- **AND** the comparison SHALL contain no run-level `w:ins` or `w:del` without content

#### Scenario: A split bookmark that one range satisfies in both projections keeps its source name

- **GIVEN** an original bookmark starting inside a paragraph the revision deletes, and a revised start at the opening of the following paragraph
- **WHEN** the documents are compared
- **THEN** the comparison SHALL carry one range under the source name and no generated name
- **AND** Accept All and Reject All SHALL each reproduce their source range and the references to it

## MODIFIED Requirements

### Requirement: Tagged publication owns the complete result package

The comparison engine SHALL build one tracked result by deterministically
reconciling the original and revised packages with tagged story publications,
without consuming a legacy result buffer, merged atom list, or legacy output-mode
decision. The public API SHALL NOT expose a caller-selectable package base.
Accepting every comparison revision SHALL preserve revised semantics, and
rejecting every comparison revision SHALL preserve original semantics, including
each projection's referenced ancillary resources. Publication SHALL own relationship and
content-type closure; headers, footers, notes, comments, people, numbering,
styles, media and custom XML; auxiliary identifier collisions; footnote
reconciliation; text-box and ancillary stories; unrepresented changes; and final
schema, projection, field, bookmark, relationship and formatting-fidelity gates.

Consumer compatibility SHALL run against the complete tagged document using one
revision-ID allocator seeded from every surviving numeric revision identifier.
Bookmark identifiers SHALL NOT seed that allocator. Volatile TOC PAGEREF cache
revisions SHALL be suppressed after compatibility enforcement and before the
final safety and formatting checks. When equal numeric bookmark IDs identify
differently named ranges across the independently authored inputs, the engine
SHALL remap the original-side ID before alignment. When tagged publication would
otherwise create a bookmark-name collision absent from both inputs, the engine
SHALL mint a collision-safe name for the original-side bookmark and SHALL
rewrite that side's complete or fragmented REF, PAGEREF, NOTEREF, HYPERLINK
`\\l`, and TOC `\\b` field targets plus internal-hyperlink anchors across
`word/*.xml` before republishing. Accept All SHALL preserve revised-side names
and targets; Reject All MAY expose the generated internal original-side name.

#### Scenario: Standalone publication has no legacy assembly dependency

- **GIVEN** original and revised packages and their tagged story publications
- **WHEN** the result package is assembled
- **THEN** assembly SHALL succeed without a legacy result buffer or merged atoms
- **AND** normalized main and ancillary package parts SHALL satisfy the publication gates

#### Scenario: One package preserves both source projections

- **GIVEN** original and revised packages with changes in main and ancillary stories
- **WHEN** the comparison package is assembled
- **THEN** accepting every comparison revision SHALL preserve revised semantics and referenced ancillary resources
- **AND** rejecting every comparison revision SHALL preserve original semantics and referenced ancillary resources
- **AND** the caller SHALL NOT select an original-based or revised-based output

#### Scenario: Revision and bookmark identifiers may overlap numerically

- **GIVEN** tagged markup containing the same numeric value in revision and bookmark ID spaces
- **WHEN** consumer compatibility splits a revision wrapper while hoisting bookmarks
- **THEN** the newly allocated revision ID SHALL avoid every surviving revision ID
- **AND** bookmark IDs SHALL remain unchanged

#### Scenario: Original-side bookmark collisions preserve reference targets

- **GIVEN** consumer-compatibility hoisting would duplicate a bookmark name that is unique in each input
- **AND** no single range reproduces both the original range under Reject All and the revised range under Accept All
- **WHEN** one or more supported original-side bookmark fields or internal hyperlinks target that bookmark across `word/*.xml`
- **THEN** the original-side bookmark and all corresponding original-side field and hyperlink targets SHALL use one collision-safe generated name
- **AND** Accept All SHALL retain the revised-side name and targets while Reject All retains the generated original-side equivalents

#### Scenario: Cross-version bookmark IDs are package-local

- **GIVEN** original and revised packages assign the same numeric bookmark ID to differently named ranges
- **WHEN** tagged publication aligns their bookmark boundaries
- **THEN** the original-side range SHALL receive a collision-safe internal ID before alignment
- **AND** the combined, Accept All, and Reject All projections SHALL contain no comparison-created duplicate or unmatched bookmark boundaries

#### Scenario: Volatile TOC cache changes are suppressed before final gates

- **GIVEN** a TOC PAGEREF field whose instruction and surrounding content are unchanged but whose cached page number differs
- **WHEN** tagged publication is finalized
- **THEN** the cached page number SHALL NOT be emitted as an authored insertion or deletion
- **AND** both cache-insensitive projections SHALL preserve their source TOC
