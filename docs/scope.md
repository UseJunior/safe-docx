# Scope

Safe Docx is a headless toolkit for agents doing legal document work. It reads, edits, compares and verifies Word (and OpenDocument) files so that a lawyer can trust the result. It has no user interface, and it is not trying to be a general-purpose document editor.

Legal work sets our priorities, not our vocabulary. Public APIs stay general OOXML and ODF concepts (see [Domain Boundaries](../CONTRIBUTING.md#domain-boundaries)); this page decides which of those concepts we invest in.

This page decides which issues we work on. An issue outside it is closed with the `out-of-scope` label and a link here. That closure is a decision about priorities, not a claim that the report is wrong.

## In scope

- **Targeted edits** an agent makes to an existing document: replacing text, inserting paragraphs, comments, footnotes and formatting, with everything outside the edit left untouched.
- **Comparison and redlines**: tracked-changes output where accept-all yields the revised document and reject-all yields the original, with no phantom or missing changes.
- **Opening cleanly**: every file we write opens in Microsoft Word and LibreOffice without a repair prompt.
- **Preservation**: parts, properties, fields, content controls, numbering and styles we did not intend to change survive a round trip.
- **The structures legal documents use**: multi-level numbering, defined terms, cross-references, footnotes and endnotes, tables (including merged cells), headers and footers, sections, symbols and checkboxes.
- **Generating documents** from a declared specification or template.
- **The tool contract**: MCP and CLI behaviour, warnings when an operation cannot be done faithfully, and schemas an agent can call correctly.
- **Verifiers** that prove the above on each release.

## Not in scope

- Visual editing: caret, selection, toolbars and any other interactive UI.
- Pixel-accurate rendering or pagination, beyond what a verifier needs to check an output.
- Real-time collaboration.
- Authoring features legal documents rarely use: charts, SmartArt, equations, macros and embedded media editing. We still preserve them untouched.
- Feature parity with any other editor or library for its own sake.

## Where the line is unclear

Preservation is always in scope, even when editing a feature is not: if a document contains a chart, we must not damage it, although we do not offer chart editing. When a request sits on the boundary, file it as `kind:investigation` and say which legal workflow needs it.
