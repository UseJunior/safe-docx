# Change: Carry list labels on document outline entries

## Why

Law-firm agreements number their headings ("ARTICLE I", "Section 1.01") through Word list numbering, usually through the heading styles (#1244). Each `get_document_outline` entry carries the heading's text, level, source and paragraph id, but not its number. An agent reading the outline of a 60-page agreement sees "Purchase and Sale of Shares." without the "Section 2.01" that the document, its cross-references and the people discussing it use. To find the number it has to call `read_file` on the paragraphs it just located.

The document view already computes each paragraph's list label, which `read_file` shows in its `list_label` column. #1244 makes that label include numbering inherited from the paragraph style.

## What Changes

- Each `get_document_outline` JSON entry carries `list_label` when the heading paragraph has a list label: the number as Word displays it, e.g. "Section 1.01". Headings without a label omit the field, so documents without numbered headings return the same entries as before.
- The Markdown format prefixes the label to the heading text (`## Section 1.01 Defined Terms.`).

## Impact

- Affected specs: `mcp-server`
- Affected code: `packages/docx-mcp/src/tools/get_document_outline.ts`, `packages/docx-mcp/src/tool_catalog.ts` (tool description)
- Depends on #1244, which resolves numbering inherited from paragraph styles in the document view.

## Out of scope

- Full-context numbers for clause-level headings (e.g. "2.06(b)"); the label is the paragraph's own level text.
