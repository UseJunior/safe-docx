## ADDED Requirements
### Requirement: Comment Deletion
The docx-primitives library SHALL provide a `deleteComment` function that removes a
comment and all its descendants from the document.

#### Scenario: delete root comment with no replies
- **GIVEN** a document with a root comment (ID N) and no replies
- **WHEN** `deleteComment` is called with commentId N
- **THEN** the `<w:comment w:id="N">` element SHALL be removed from comments.xml
- **AND** the `commentRangeStart`, `commentRangeEnd` elements with matching ID SHALL
  be removed from document.xml
- **AND** the `commentReference` element SHALL be removed from its containing run
- **AND** the containing run SHALL be removed only if it has no visible content afterward
- **AND** the matching `<w15:commentEx>` entry SHALL be removed from commentsExtended.xml
  if present

#### Scenario: delete root comment cascade-deletes all descendants
- **GIVEN** a root comment (ID N) with reply comments (possibly nested multi-level)
- **WHEN** `deleteComment` is called with commentId N
- **THEN** the root comment AND all descendant comments SHALL be removed from comments.xml
- **AND** all corresponding `<w15:commentEx>` entries SHALL be removed from
  commentsExtended.xml if present
- **AND** range markers for the root comment SHALL be removed from document.xml

#### Scenario: delete a leaf reply comment
- **GIVEN** a root comment with a reply (ID R) that has no children
- **WHEN** `deleteComment` is called with commentId R
- **THEN** only the reply SHALL be removed from comments.xml
- **AND** its `<w15:commentEx>` entry SHALL be removed from commentsExtended.xml if present
- **AND** the parent comment and its range markers SHALL remain intact

#### Scenario: delete a non-leaf reply cascades to its descendants
- **GIVEN** a root comment with reply (ID R1) which itself has a reply (ID R2)
- **WHEN** `deleteComment` is called with commentId R1
- **THEN** R1 AND R2 SHALL be removed from comments.xml
- **AND** their `<w15:commentEx>` entries SHALL be removed if present
- **AND** the root comment SHALL remain intact

#### Scenario: comment not found returns error
- **WHEN** `deleteComment` is called with a commentId that does not exist
- **THEN** the function SHALL throw an error indicating the comment was not found
