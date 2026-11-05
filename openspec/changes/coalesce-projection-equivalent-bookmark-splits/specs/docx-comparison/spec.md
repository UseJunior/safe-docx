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
