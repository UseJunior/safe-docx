## Context

The first #654 slice established canonical section discovery, zero-based
session-relative selectors, partial `w:pgNumType/@w:start` editing, and native
`w:sectPrChange` snapshots. `w:pgSz` and `w:pgMar` already appear in the
inventory, but are read-only.

This slice reuses that targeting and revision machinery. It must update several
properties atomically so a request that changes paper size and margins records
the original section once, rather than stacking or replacing snapshots from
sequential setters.

## Goals / Non-Goals

### Goals

- Partially update page dimensions, orientation, and margins.
- Preserve every unspecified section property and attribute.
- Record one prior-state snapshot for one effective tool call.
- Reject invalid or structurally incomplete requests before live mutation.
- Keep the existing page-number-only API and MCP calls compatible.

### Non-Goals

- Change section topology or identity.
- Infer a paper standard from dimensions.
- Couple orientation to dimension swapping.
- Repair malformed section properties beyond the targeted duplicate handling.
- Edit auxiliary stories or their relationships.

## Decisions

### 1. Add one atomic core mutation

The core accepts a section index plus any combination of:

- `pageNumberStart`;
- `pageSize.widthTwips`, `pageSize.heightTwips`, and
  `pageSize.orientation`;
- `margins.topTwips`, `rightTwips`, `bottomTwips`, `leftTwips`,
  `headerTwips`, `footerTwips`, and `gutterTwips`.

At least one leaf value is required. The existing
`setSectionPageNumberStart` method delegates to this mutation and retains its
current result type.

The mutation resolves and validates the complete request, clones the original
`w:sectPr`, applies every effective value, and appends at most one
`w:sectPrChange`.

### 2. Treat values as literal OOXML settings

Page width and height are positive safe integers in twips. Orientation is
`portrait` or `landscape`. Changing orientation does not swap dimensions:
callers that want a rotated physical sheet provide the corresponding width and
height in the same atomic request.

Top and bottom margins accept signed safe integers because
`CT_PageMar` uses `ST_SignedTwipsMeasure`. Right, left, header, footer, and
gutter margins accept non-negative safe integers.

### 3. Create missing elements conservatively

`w:pgSz` is inserted in its canonical `CT_SectPr` slot. A missing `w:pgSz`
may be created only when both width and height are supplied, avoiding a new
printer-default-dependent page-size record.

`CT_PageMar` requires all seven attributes. When `w:pgMar` is absent, the
request must provide all seven margins. Existing `w:pgMar` values support
ordinary partial updates.

Existing untargeted attributes such as `w:pgSz/@w:code` remain unchanged.
Duplicate targeted elements are collapsed only when an effective mutation is
applied.

### 4. Preserve deterministic no-op behavior

If every requested leaf already matches the selected live section, serialized
XML is unchanged, no revision ID is allocated, and MCP edit accounting is not
incremented. Validation still runs before the no-op decision.

### 5. Extend the existing MCP tool

`format_section` keeps `section_index` and optional
`page_number_start`, and adds:

```json
{
  "page_size": {
    "width_twips": 15840,
    "height_twips": 12240,
    "orientation": "landscape"
  },
  "margins": {
    "top_twips": 720,
    "right_twips": 720,
    "bottom_twips": 720,
    "left_twips": 720,
    "header_twips": 360,
    "footer_twips": 360,
    "gutter_twips": 0
  }
}
```

At least one writable leaf across the three groups is required. File-first,
session reuse, provider rejection, AI-revision preflight, and topology
invariants remain unchanged.

## Risks / Trade-offs

- Literal orientation avoids hidden mutations but callers must provide swapped
  dimensions when that is their intent. The tool description and tutorial make
  this explicit.
- Requiring all margins for a missing `w:pgMar` is more verbose than applying
  defaults, but avoids silently choosing jurisdiction- or printer-dependent page
  geometry.
- Section indexes remain session-relative. Topology edits are still deferred,
  so this slice does not itself shift them.

## Migration Plan

This is additive. Existing `format_section` calls that provide only
`page_number_start` behave exactly as before.

## Open Questions

None. Section-break insertion remains the next topology slice.
