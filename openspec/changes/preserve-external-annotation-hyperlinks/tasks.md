## 1. Conformance and canonical model

- [x] 1.1 Register and cite the verified WordprocessingML hyperlink and OPC
  part-relationship requirements.
- [x] 1.2 Extend canonical annotation runs and Markdoc parse/serialization with
  an explicit validated external destination.
- [x] 1.3 Escape Markdoc attribute values as string literals so reserved
  destination characters (`&`, `"`, `\`) round-trip exactly.

## 2. Import and projection

- [x] 2.1 Resolve comment and footnote hyperlink IDs against their owning
  relationship parts and retain destination plus admitted run formatting.
- [x] 2.2 Emit grouped hyperlink wrappers and deterministic collision-free
  external relationships in comment and footnote destination parts.
- [x] 2.3 Preserve explicit fail-closed diagnostics for malformed, internal,
  dangling, mistyped, or otherwise unsupported hyperlink inputs and bookmarks.
- [x] 2.4 Wrap tracked footnote runs per parent container so hyperlink-nested
  runs stay linked and ordered under `w:ins` / `w:del`.

## 3. Verification

- [x] 3.1 Cover comment/footnote import, all four projections, mixed formatting,
  repeated destinations, multiple links, and relationship-ID collisions.
- [x] 3.2 Cover missing/dangling IDs, wrong relationship types, internal modes or
  anchors, empty targets, malformed wrappers, and Markdoc round-trip stability.
- [x] 3.3 Cover docx-core emission directly: tracked footnote insertion,
  replacement, and deletion with linked runs, comment and reply bodies with
  grouped wrappers, relationship reuse, and reserved-character destinations.
- [x] 3.4 Update `[SDX-MDOC-103]` against fresh `origin/main`: the WOF fixture
  reaches `w:bookmarkStart` at `footnote:19`, while the Deal-By-Deal fixture
  (which contains no such marker there) imports completely.
- [x] 3.5 Run bookmark-stripped real-document imports and both projection
  directions, inspecting output XML and relationship parts for destination,
  text, style, and size fidelity.
- [x] 3.6 Run focused tests, strict OpenSpec validation, and the complete
  repository pre-submit gate.
