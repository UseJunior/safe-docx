## ADDED Requirements

### Requirement: ODF Comment Support (`add_comment`, `get_comments`)

The MCP server SHALL service `add_comment` and `get_comments` for ODF sessions via the
provider-aware `.odt` lane, in addition to the existing ODF tools. Both SHALL route to the ODF
handler when the `file_path` ends in `.odt` (or resolves to an existing `OdfSession`); the DOCX and
Google Docs paths SHALL remain unchanged, and every still-unsupported tool SHALL continue to return
`UNSUPPORTED_FOR_ODF`.

ODF `add_comment` SHALL insert an `office:annotation` carrying `dc:creator` (the required `author`),
`dc:date`, and a `text:p` comment body. When `anchor_text` is omitted the annotation SHALL bracket
the whole anchor paragraph; when `anchor_text` is provided the annotation SHALL bracket the matched
substring, returning `TEXT_NOT_FOUND` / `MULTIPLE_MATCHES` when the substring is absent or ambiguous
and `MATCH_SPANS_MULTIPLE_NODES` when the match crosses inline node boundaries. Inserting an
annotation SHALL NOT alter the document's positional paragraph IDs.

ODF `get_comments` SHALL return every annotation in document order in the same shape as the DOCX
tool (`id`, `author`, `date`, `initials`, `text`, `anchored_paragraph_id`, `replies`), with
`replies` always empty for ODF. Comment **replies** are not supported for ODF: an `add_comment`
invocation carrying `parent_comment_id` against a `.odt` SHALL return `UNSUPPORTED_FOR_ODF`.

#### Scenario: [OPCM-01] `add_comment` annotates a whole ODF paragraph
- **WHEN** `add_comment` is invoked with a `.odt` `file_path`, a `target_paragraph_id`, an `author`, and `text` (no `anchor_text`)
- **THEN** the ODF handler inserts an `office:annotation` bracketing that paragraph and returns `mode: 'root'` with the anchor paragraph id, and the DOCX/gdocs handlers are not invoked

#### Scenario: [OPCM-02] `add_comment` annotates a substring via `anchor_text`
- **WHEN** `add_comment` is invoked with a `.odt` `file_path`, `target_paragraph_id`, `anchor_text`, `author`, and `text`
- **THEN** the annotation brackets the matched substring (`office:annotation` … `office:annotation-end`) and the response echoes the `anchor_text`

#### Scenario: [OPCM-03] `get_comments` returns ODF annotations
- **WHEN** `get_comments` is invoked with a `.odt` `file_path` after a comment has been added
- **THEN** the response lists the comment with its author, date, body text, and anchored paragraph id, and `replies` is empty

#### Scenario: [OPCM-04] Replies are unsupported for ODF
- **WHEN** `add_comment` is invoked with a `.odt` `file_path` and a `parent_comment_id`
- **THEN** an `UNSUPPORTED_FOR_ODF` error is returned and no DOCX logic runs

#### Scenario: [OPCM-05] Missing or ambiguous `anchor_text` is rejected
- **WHEN** `add_comment` is invoked with an `anchor_text` that is absent from (or matches multiple times in) the target paragraph
- **THEN** a `TEXT_NOT_FOUND` or `MULTIPLE_MATCHES` error is returned and no annotation is inserted
