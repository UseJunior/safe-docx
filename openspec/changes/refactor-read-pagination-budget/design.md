## Context

The #1310 iterator is exported at the docx-core package root and groups contiguous
tables and lists without conflating separated runs of the same table ID. MCP
reads still need a flat paragraph cursor, not the HTML/Markdown serializers'
whole-table rendering policy.

## Decisions

`ReadBudget` admits one input node at a time. `consumedInput` advances even when
the rendered contribution is empty. `renderedCharacters` records committed output
separately from the candidate estimate. The state starts accepting and ends
blocked when a subsequent node cannot fit, or exhausted when input ends.
First-node overflow is recorded only at first admission and remains sticky.
Formatting and serialization happen before admission, so a renderer exception
cannot publish a partially consumed cursor.

The text renderer visits shared iterator blocks, opens a table only when its
first cell is admitted, and closes an admitted table exactly once. It can stop
between any two cells. JSON keeps its independent per-object representation
and historical admission estimate (two framing characters), while overflow
warnings account for the full four-character JSON frame. Ordinary text table
closing markers remain outside admission; TOON comment endnotes remain inside.

Explicit offset/limit/nonempty node_ids retain their existing selection and
budget bypass behavior, including empty selections. No response or cursor API
changes are introduced. Google keeps its existing warning-field behavior while
using the same internal accounting. Local enrichment, field traversal and
document-wide footnote sidecars stay in read_file.

Google's explicit simple reads retain their historical marker-free previews;
implicit budgeted text pages retain table markers and closures. Harmonizing
that established explicit output is a separate compatibility decision. JSON's
budgeted per-object indentation and explicit array indentation also stay intact.

## Risks and verification

Consolidating renderers can hide policy drift. The tests retain the existing
comment, field and footnote suites and add format-specific exact boundaries,
empty input/output, oversized first input, split tables, repeated IDs separated
by body/list nodes, render/read failure injection and full cursor walks. Public
NVCA MCP read/save/reopen smoke verifies the compiled consumer path after merge.
