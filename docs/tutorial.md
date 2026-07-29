# Tutorial

This walkthrough changes one clause in an existing contract and saves both a clean document and a tracked-changes document.

## What We Are Going To Do

```text
NDA.docx
    |
    v
read and find the clause
    |
    v
replace one exact phrase
    |
    v
NDA-clean.docx + NDA-tracked.docx
```

The agent handles the tool calls. You describe the result and review the output in your normal document editor.

## Step 1: Install Safe Docx

You need Node.js 18 or later and an existing `.docx` file. Follow [Installation](installation.md) to inspect and install the npm package.

Safe Docx works through MCP and through direct CLI commands. For Claude Code:

```bash
claude mcp add safe-docx -- /absolute/path/to/safe-docx
```

Use `command -v safe-docx` on macOS or Linux, or `where safe-docx` on Windows, to find the installed executable. Desktop applications often do not inherit the same `PATH` as an interactive terminal.

## Step 2: Ask For The Edit

```text
Edit ~/docs/NDA.docx. Change the governing law from "State of New York"
to "State of Delaware". Save a clean copy to ~/docs/NDA-clean.docx and a
tracked-changes copy to ~/docs/NDA-tracked.docx. Do not change anything else.
```

The exact old text, intended replacement, and output paths make the request easy to verify.

## Step 3: Read The Document

The agent can inspect the document with `read_file`:

```text
read_file(file_path="~/docs/NDA.docx", format="toon")
```

| Key | Meaning |
|---|---|
| `file_path` | The existing document to read. It also identifies the session used by later calls. |
| `format` | The response representation. `toon` is compact and preserves paragraph IDs for agent use. |

The result includes paragraph IDs such as `_bk_e4c8a91f2d36`. Those IDs let later operations target one paragraph without rewriting the whole document.

## Step 4: Find The Clause

The agent searches for the existing language:

```text
grep(file_path="~/docs/NDA.docx", pattern="State of New York")
```

| Key | Meaning |
|---|---|
| `file_path` | The document to search. An existing session for this path is reused. |
| `pattern` | A regular expression matched against the document's visible text. |

If the search returns no match or several ambiguous matches, the agent should read more context before editing.

## Step 5: Apply The Edit

```text
replace_text(
  file_path="~/docs/NDA.docx",
  target_paragraph_id="_bk_e4c8a91f2d36",
  old_string="State of New York",
  new_string="State of Delaware",
  instruction="Change governing law to Delaware"
)
```

| Key | Meaning |
|---|---|
| `file_path` | The document session to edit. |
| `target_paragraph_id` | The paragraph ID returned by `read_file` or `grep`. |
| `old_string` | The exact text expected in that paragraph. The edit fails if it is absent or ambiguous. |
| `new_string` | The replacement text. Supported inline formatting tags can also be used here. |
| `instruction` | A required legacy compatibility field. The current DOCX replacement implementation does not use it to decide or delegate the edit; describe the change briefly until the field is removed or made optional. |

The change is applied to the live document session. Untouched paragraphs remain outside the edit operation.

### Delete An Ordinary DOCX Paragraph

There is no separate `delete_paragraph` tool. To delete an ordinary body
paragraph, target its exact full visible text and replace it with an empty string:

```text
replace_text(
  file_path="~/docs/NDA.docx",
  target_paragraph_id="_bk_7d130acfe245",
  old_string="This duplicated paragraph should be removed.",
  new_string="",
  instruction="Delete the duplicated paragraph"
)
```

A clean save removes the paragraph. A tracked save retains its deletion for
review. Re-read the target first and use this pattern only when `old_string`
matches the complete paragraph text. Inspect the document structure before using
it on a paragraph that carries section properties, is structurally required as
the last paragraph in a table cell, or owns bookmark or comment anchors.

### Repair DOCX Paragraph Numbering

Use `format_numbering` when a paragraph has a stray direct list label:

```text
format_numbering(
  file_path="~/docs/NDA.docx",
  target_paragraph_id="_bk_4d71f33e924a",
  remove=true
)
```

To join a paragraph to an existing list sequence, copy another paragraph's
explicit numbering:

```text
format_numbering(
  file_path="~/docs/NDA.docx",
  target_paragraph_id="_bk_9fc26ad74408",
  match_paragraph_id="_bk_d39ac1a3b3f0"
)
```

The tool also accepts an existing `num_id` with its `ilvl`, but matching a
paragraph is usually safer because numbering IDs are local to each DOCX. The
tool changes only direct `w:numPr`: it does not create numbering definitions,
change numbering inherited only through a paragraph style, restart lists, or
guarantee a rendered label without the surrounding list context. Effective
changes are recorded as paragraph-property tracked changes.

### Inspect and Format Sections

Read the current main-document sections before choosing a target:

```text
get_sections(file_path="~/docs/NDA.docx")
```

Then update one returned section. This example restarts numbering, switches to
explicit Letter landscape geometry, and narrows selected margins atomically:

```text
format_section(
  file_path="~/docs/NDA.docx",
  section_index=1,
  page_number_start=1,
  page_size={
    "width_twips": 15840,
    "height_twips": 12240,
    "orientation": "landscape"
  },
  margins={
    "top_twips": 720,
    "bottom_twips": 720,
    "left_twips": 720,
    "right_twips": 720
  }
)
```

`section_index` is zero-based and session-relative, so call `get_sections` again
after any operation that changes section topology. Page size and margin objects
are partial when the corresponding setting already exists. A section without
`w:pgSz` requires both dimensions, and one without `w:pgMar` requires all seven
margin values (top, right, bottom, left, header, footer, and gutter).

Orientation is literal: changing it does not silently swap width and height.
Section formatting preserves break type, columns, page-number format, page
borders, and header/footer references.

To split a section after a stable direct-body paragraph, use the paragraph id
from `read_file`:

```text
insert_section_break(
  file_path="~/docs/NDA.docx",
  paragraph_id="_bk_9fc26ad74408",
  break_type="nextPage",
  new_section={"page_number_start": 1}
)
```

The inserted boundary preserves the current page setup and header/footer
relationship references. The following section inherits its current properties
by default. Set `inherit_properties=false` to reset its non-relationship
properties, then provide complete page dimensions and margins in `new_section`
when those elements need to be recreated. Header/footer parts and relationship
attachments are deliberately preserved; edit those through the separate
header/footer capability when available. Call `get_sections` again after a
successful split because every later section index shifts.

## Step 6: Save Reviewable Outputs

```text
save(
  file_path="~/docs/NDA.docx",
  save_to_local_path="~/docs/NDA-clean.docx",
  tracked_save_to_local_path="~/docs/NDA-tracked.docx",
  save_format="both"
)
```

| Key | Meaning |
|---|---|
| `file_path` | The edited document session to save. |
| `save_to_local_path` | Destination for the clean document. |
| `tracked_save_to_local_path` | Destination for the document containing tracked changes. |
| `save_format` | `clean`, `tracked`, or `both`. This walkthrough requests both variants. |

The clean file contains the accepted edit. The tracked file records the insertion and deletion for human review.

## Step 7: Review The Result

Open both files in Word or LibreOffice and verify:

1. The governing-law text changed once.
2. The tracked file attributes the insertion and deletion correctly.
3. Surrounding formatting, numbering, headers, and tables remain intact.
4. No unrelated revisions appear.

Visual review remains appropriate for material documents because Safe Docx is not a rendering engine.

## Other Workflows

| Workflow | Primary tools |
|---|---|
| Read a document | `read_file` |
| Search a document | `grep` |
| Comments | `add_comment`, `get_comments`, `delete_comment` |
| Footnotes | `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote` |
| Compare two documents | `compare_documents` |
| Inspect or accept revisions | `has_tracked_changes`, `extract_revisions`, `accept_changes` |
| Insert a paragraph | `insert_paragraph` |
| Delete an ordinary DOCX body paragraph | `replace_text` with the complete text and an empty `new_string` |
| Remove or repair direct DOCX paragraph numbering | `format_numbering` |
| Inspect, split, or change DOCX sections | `get_sections`, `insert_section_break`, `format_section` |
| Apply several edits together | `batch_edit` |
| Convert DOCX to ODT | `convert_to_odt` |
| Convert DOCX to Markdown | `export` with `format="markdown"` |
| Convert DOCX to HTML | `export` with `format="html"` |
| Save an editing session | `save` |

Use the [tool reference](../packages/docx-mcp/docs/tool-reference.generated.md) for complete arguments and response schemas. Use the [golden prompts](../packages/docx-mcp/docs/golden-prompts.md) for more agent instructions.
