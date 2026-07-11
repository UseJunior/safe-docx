# Tutorial

This walkthrough uses Safe Docx to inspect an existing contract, make one targeted edit, and save both a clean document and a tracked-changes document.

## What We Are Going To Do

We will change the governing law in `NDA.docx` from New York to Delaware:

```text
NDA.docx
    |
    v
read and locate the clause
    |
    v
replace one exact phrase
    |
    v
NDA-clean.docx + NDA-tracked.docx
```

The coding agent handles the MCP calls. You describe the result and review the output in your normal document editor.

## Step 1: Check The Requirements

You need:

- Node.js 18 or later
- an MCP-compatible coding agent
- an existing `.docx` or `.odt` file

Supported document operations run locally. Microsoft Word, LibreOffice, Python, and .NET are not required for the default DOCX path.

## Step 2: Install And Connect Safe Docx

Follow [Installation](installation.md) to inspect and install the npm package. Safe Docx then uses standard MCP `stdio` configuration:

| Setting | Value |
|---|---|
| Command | `safe-docx` |
| Arguments | none |
| Transport | `stdio` |

For Claude Code:

```bash
claude mcp add safe-docx -- safe-docx
```

For clients that use JSON configuration:

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "safe-docx",
      "args": []
    }
  }
}
```

Start the client and confirm that the Safe Docx tools are available.

## Step 3: Make A Working Copy

Keep the source document unchanged. For this tutorial, use:

```text
~/docs/NDA.docx
```

Safe Docx applies edits in a live document session and writes a new file only when the agent calls `save` or `export`.

## Step 4: Ask For The Edit

Give the agent a specific instruction with input and output paths:

```text
Edit ~/docs/NDA.docx. Change the governing law from "State of New York"
to "State of Delaware". Save a clean copy to ~/docs/NDA-clean.docx and a
tracked-changes copy to ~/docs/NDA-tracked.docx. Do not change anything else.
```

The important parts are the exact old text, the intended replacement, and distinct output paths.

## Step 5: Inspect The Document

The agent first calls `read_file` or `grep`:

```text
read_file(file_path="~/docs/NDA.docx", format="toon")
grep(file_path="~/docs/NDA.docx", pattern="State of New York")
```

Reads return stable paragraph IDs such as `_bk_e4c8a91f2d36`. Edit tools use these IDs as anchors so the agent can target a paragraph without rewriting the whole file.

If the search returns no match or several ambiguous matches, the agent should inspect more context before editing.

## Step 6: Apply The Edit

For a single replacement, the agent calls:

```text
replace_text(
  file_path="~/docs/NDA.docx",
  target_paragraph_id="_bk_e4c8a91f2d36",
  old_string="State of New York",
  new_string="State of Delaware",
  instruction="Change governing law to Delaware"
)
```

Safe Docx mutates the document package rather than reconstructing the document from extracted text. Untouched paragraphs remain outside the edit operation.

For several related changes, agents can use `batch_edit` to apply an ordered set of mutations.

## Step 7: Save Reviewable Outputs

The agent saves clean and tracked variants:

```text
save(
  file_path="~/docs/NDA.docx",
  save_to_local_path="~/docs/NDA-clean.docx",
  tracked_save_to_local_path="~/docs/NDA-tracked.docx",
  save_format="both"
)
```

The clean file contains the agent's accepted edit. The tracked file records the edit as WordprocessingML insertions and deletions for human review.

## Step 8: Review The Result

Open both files in Word or LibreOffice and verify:

1. The governing-law text changed once.
2. The tracked file attributes the insertion and deletion correctly.
3. Surrounding formatting, numbering, headers, and tables remain intact.
4. No unrelated revisions appear.

Safe Docx preserves document semantics, but it is not a rendering engine. Visual review remains appropriate for material documents.

## Step 9: Try The Other Workflows

The same read-locate-mutate-save lifecycle supports:

| Workflow | Primary tools |
|---|---|
| Several edits | `batch_edit`, `save` |
| Paragraph insertion | `insert_paragraph` |
| Comments | `add_comment`, `get_comments`, `delete_comment` |
| Footnotes | `get_footnotes`, `add_footnote`, `update_footnote`, `delete_footnote` |
| Existing revisions | `has_tracked_changes`, `accept_changes`, `extract_revisions` |
| Two-file redline | `compare_documents` |
| ODT conversion | `convert_to_odt` |
| Structured inspection | `read_file`, `get_document_outline`, `grep` |

Use the [generated tool reference](../packages/docx-mcp/docs/tool-reference.generated.md) for complete arguments and response schemas. Use the [golden prompts](../packages/docx-mcp/docs/golden-prompts.md) for additional agent instructions.

## How The Pieces Fit

The MCP server is one interface over several document engines. The [architecture guide](architecture.md) explains package ownership, session state, document identity, comparison, and output validation. The [trust and conformance guide](trust-and-conformance.md) explains which guarantees are structural, tested, specified, or optional.
