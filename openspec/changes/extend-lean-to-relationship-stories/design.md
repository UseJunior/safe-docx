## Context

Executable protocol v3 receives paths to immutable original, revised, and
compared DOCX snapshots. Lean extracts and checks the fixed
`word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml` stories.
`verify-ancillary-field-stories` added a TypeScript runtime selector for direct
header/footer bindings, but explicitly left those stories outside the compiled
Lean certificate. Issue #631 moves that selection boundary into Lean without
turning Lean into a general OPC or Word renderer.

The existing `NamedStoryTriple`, `checkStoryCollection`,
`storyCollectionPassed`, and `story_collection_checker_sound` definitions are
already generic. This change needs a package selector and evidence model, not a
second story checker.

## Goals / Non-Goals

- Goals: independently select every supported direct explicit first, default,
  and even header/footer binding from all three packages.
- Goals: align selected stories by `(sectionOrdinal, kind, role)` while
  retaining original/revised/compared relationship IDs and normalized paths.
- Goals: fail closed with deterministic structured selection diagnostics.
- Goals: deduplicate physical shared-target work while retaining all logical
  selecting slots and per-side identities.
- Goals: retain fixed main/footnote/endnote checks, reuse the generic story
  collection theorem, and keep the public certificate v1 additive.
- Goals: keep executable protocol output bounded and strictly decoded.
- Non-Goals: inherited first/default/even role semantics, page assignment,
  `w:titlePg` interpretation, `w:evenAndOddHeaders` interpretation, pagination,
  field evaluation, cached values, bookmark resolution, or rendering.
- Non-Goals: header/footer revision synthesis or proof that the TypeScript
  comparison engine transforms ancillary stories.
- Non-Goals: full OPC conformance, content-type validation, general
  relationship validation, XML Schema validation, or complete ECMA-376
  coverage.
- Non-Goals: comments, glossary/header/footer relationships owned by other
  parts, unreferenced header/footer parts, or rebuild-mode certification.

## Decisions

### Protocol v4 keeps selection inside Lean

The executable accepts exactly this TypeScript-equivalent request shape:

```ts
interface LeanVerifierRequestV4 {
  protocolVersion: 4;
  originalDocxPath: string;
  revisedDocxPath: string;
  comparedDocxPath: string;
}
```

Protocol v4 is the only accepted internal request and response version after
migration. Requests for v1-v3, unknown request fields, a story manifest,
pre-resolved targets, TypeScript-computed pass bits, or TypeScript-computed
selector conclusions are rejected. Each path is a nonempty string of at most
4,096 UTF-8 bytes. The launcher snapshots the three buffers and passes only
their paths. Lean performs package extraction, selection, normalization, XML
parsing, token projection, and checker aggregation.

The internal response uses these exact shapes:

```ts
type VerifierSide = 'original' | 'revised' | 'compared';
type RelationshipStoryKind = 'header' | 'footer';
type RelationshipStoryRole = 'first' | 'default' | 'even';
type FixedStoryName = 'main' | 'footnotes' | 'endnotes';

interface StoryCheckBooleans {
  acceptPreservesFieldStructure: boolean;
  rejectPreservesFieldStructure: boolean;
  acceptTextMatchesRevised: boolean;
  rejectTextMatchesOriginal: boolean;
  combinedHasNoFldCharInsideDel: boolean;
  combinedHasValidMoveRanges: boolean;
}

interface StoryCheckReportV4 {
  passed: boolean;
  checks: StoryCheckBooleans;
}

interface FixedStoryReportV4 {
  name: FixedStoryName;
  presence: { original: boolean; revised: boolean; combined: boolean };
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report: StoryCheckReportV4;
}

interface FixedPresenceMismatchV4 {
  name: FixedStoryName;
  packagePart: 'word/document.xml' | 'word/footnotes.xml' | 'word/endnotes.xml';
  required: boolean;
  presence: { original: boolean; revised: boolean; combined: boolean };
}

type FixedStoryIssueCode =
  | 'OPTIONAL_STORY_PART_LIMIT_EXCEEDED'
  | 'OPTIONAL_STORY_AGGREGATE_LIMIT_EXCEEDED'
  | 'OPTIONAL_STORY_INVALID_UTF8'
  | 'OPTIONAL_STORY_INVALID_XML'
  | 'OPTIONAL_STORY_ROOT_MISMATCH'
  | 'OPTIONAL_STORY_XML_DEPTH_LIMIT_EXCEEDED'
  | 'OPTIONAL_STORY_XML_TOKEN_LIMIT_EXCEEDED';

interface FixedStoryIssueV4 {
  code: FixedStoryIssueCode;
  name: 'footnotes' | 'endnotes';
  side: VerifierSide;
  packagePart: 'word/footnotes.xml' | 'word/endnotes.xml';
  detail: string;
}

interface RelationshipSideIdentityV4 {
  relationshipId: string;
  normalizedPartPath: string;
}

interface RelationshipSlotV4 {
  slotOrdinal: number;
  sectionOrdinal: number;
  kind: RelationshipStoryKind;
  role: RelationshipStoryRole;
  original: RelationshipSideIdentityV4;
  revised: RelationshipSideIdentityV4;
  compared: RelationshipSideIdentityV4;
  physicalStoryOrdinal: number;
}

interface RelationshipStoryReportV4 {
  physicalStoryOrdinal: number;
  kind: RelationshipStoryKind;
  originalPartPath: string;
  revisedPartPath: string;
  comparedPartPath: string;
  selectingSlotOrdinals: number[];
  parsedTokenCounts: { original: number; revised: number; combined: number };
  report: StoryCheckReportV4;
}

type SelectionIssueCode =
  | 'DUPLICATE_SECTION_BINDING'
  | 'UNSUPPORTED_SECTION_PLACEMENT'
  | 'INDIRECT_SECTION_BINDING'
  | 'MISSING_RELATIONSHIP_ID'
  | 'INVALID_BINDING_ROLE'
  | 'MISSING_RELATIONSHIPS_PART'
  | 'INVALID_RELATIONSHIPS_XML'
  | 'INVALID_RELATIONSHIPS_ROOT'
  | 'RELATIONSHIP_LIMIT_EXCEEDED'
  | 'MALFORMED_RELATIONSHIP_RECORD'
  | 'DUPLICATE_RELATIONSHIP_ID'
  | 'MISSING_RELATIONSHIP'
  | 'RELATIONSHIP_ID_LIMIT_EXCEEDED'
  | 'RELATIONSHIP_TYPE_MISMATCH'
  | 'INVALID_TARGET_MODE'
  | 'EXTERNAL_TARGET'
  | 'TARGET_LENGTH_LIMIT_EXCEEDED'
  | 'UNSAFE_TARGET'
  | 'MISSING_TARGET_PART'
  | 'SELECTED_PART_LIMIT_EXCEEDED'
  | 'UNIQUE_SELECTED_PART_LIMIT_EXCEEDED'
  | 'AGGREGATE_COMPRESSED_LIMIT_EXCEEDED'
  | 'AGGREGATE_EXPANDED_LIMIT_EXCEEDED'
  | 'INVALID_TARGET_XML'
  | 'TARGET_ROOT_MISMATCH'
  | 'XML_DEPTH_LIMIT_EXCEEDED'
  | 'XML_TOKEN_LIMIT_EXCEEDED'
  | 'INVALID_UTF8'
  | 'SECTION_COUNT_MISMATCH'
  | 'SECTION_SLOT_MISMATCH'
  | 'EVIDENCE_STRING_BUDGET_EXCEEDED'
  | 'ISSUE_LIMIT_EXCEEDED';

interface SelectionIssueV4 {
  code: SelectionIssueCode;
  side?: VerifierSide;
  sectionOrdinal?: number;
  kind?: RelationshipStoryKind;
  role?: RelationshipStoryRole;
  relationshipId?: string;
  rawTarget?: string;
  normalizedPartPath?: string;
  detail: string;
}

interface LeanVerifierResponseV4 {
  protocolVersion: 4;
  checker: 'safe-docx-lean-relationship-story-checker';
  passed: boolean;
  fixedStories: FixedStoryReportV4[];
  presenceMismatches: FixedPresenceMismatchV4[];
  fixedStoryIssues: FixedStoryIssueV4[];
  relationshipSlots: RelationshipSlotV4[];
  relationshipStories: RelationshipStoryReportV4[];
  selectionIssues: SelectionIssueV4[];
}
```

Every object at every nesting level has an exact-key policy. Optional
`SelectionIssueV4` locator keys may be absent only when the selector has not
reached that identity; `null` is never accepted in their place. Arrays,
integers, booleans, literal strings, and optionality are validated recursively.
Unknown keys, non-safe integers, negative ordinals/counts, invalid enum values,
or a response larger than the output budget reject the response as `not_run`.

The launcher validates these cardinality and identity equations:

- A valid response exists only after all three required main parts have been
  uniquely extracted, UTF-8 decoded, accepted-root parsed/tokenized, and used
  to construct the supported section inventory. Therefore `fixedStories[0]`
  is always a truthful `main` report.
- After `main`, `fixedStories` may contain `footnotes`, then `endnotes`, with
  no duplicate name. An optional note report is present if and only if at least
  one package supplies that part and every supplied side tokenizes
  successfully. Otherwise that name is omitted and `fixedStoryIssues` contains
  at least one issue for each failing supplied side.
- A story report's `report.passed` equals the conjunction of its six check
  booleans. Every token count is a nonnegative safe integer within the token
  budgets.
- `presenceMismatches` is retained as an exact response field for migration but
  MUST be `[]` in v4: required-main absence is `not_run`, while optional note
  absence is represented as empty tokens in its report.
- `fixedStoryIssues` contains only footnote/endnote issues, is ordered by name
  footnotes/endnotes, then side original/revised/compared, then code, and has
  no exact duplicate. It never contains a main-document issue.
- `relationshipSlots[i].slotOrdinal === i`; slots are strictly canonical by
  section, kind, and role; and no logical `(sectionOrdinal, kind, role)` repeats.
- `relationshipStories[i].physicalStoryOrdinal === i`; each
  `selectingSlotOrdinals` is nonempty, strictly increasing, duplicate-free, and
  contains only existing slot ordinals.
- Every slot names exactly one physical story, and appears exactly once across
  all `selectingSlotOrdinals`. A physical story's kind and three paths equal
  those of every selecting slot. No two physical stories have the same
  `(kind, originalPartPath, revisedPartPath, comparedPartPath)` key, and slots
  share a physical story if and only if that complete key is equal.
- Physical stories are ordered by their lowest selecting slot. Selection issues
  are ordered by original/revised/compared side, section, kind, role, code, and
  locator strings, with absent locator fields first. Exact duplicate issues are
  rejected.
- `passed === (selectionIssues.length === 0 &&
  fixedStoryIssues.length === 0 &&
  presenceMismatches.length === 0 &&
  fixedStories.every(s => s.report.passed) &&
  relationshipStories.every(s => s.report.passed))`.

A valid v4 response with one or more `selectionIssues` is a completed verifier
run and maps to public `status: "failed"` with structured failures. The same is
true for `fixedStoryIssues` or a failed fixed/relationship report.

A valid v4 response MUST NOT be emitted unless required
`word/document.xml` succeeds in all three packages through unique indexed
extraction, UTF-8 decoding, accepted `w:document` root parsing/tokenization,
main per-item and aggregate limits, and supported section-inventory
construction. Missing/duplicate required main entries, corrupt ZIP indexing,
extractor mismatch, invalid main UTF-8/XML/root, main depth/token/byte limit,
section/binding inventory limit, or any other condition preventing a truthful
main report is a nonzero executable failure and public `not_run`, with no
certificate assertion that Lean checked a main triple. An ancestry-recognized
but unsupported `w:sectPr` placement does not prevent truthful main
tokenization; it is a structured selection issue.

After valid main tokenization/inventory, binding and relationship failures are
structured `selectionIssues`: malformed/missing/wrong-root relationship XML;
relationship record/count defects; direct binding defects; alignment defects;
and missing, malformed, wrong-root, invalid-UTF-8, or known size/depth/token
limit failures in a selected header/footer part. A present optional note whose
metadata exceeds known part/aggregate limits or whose extracted bytes fail
UTF-8, accepted XML/root, depth, or token checks produces
`fixedStoryIssues` and public `failed`; an absent optional side retains
missing-as-empty semantics.

An actual extractor nonzero exit, length/CRC mismatch, or other inability to
establish that extracted bytes correspond to the trusted index is
process-level `not_run` for main, relationship, selected, and optional parts
alike. Public `not_run` also covers snapshot I/O failure, unavailable process,
timeout/termination, invalid request/response JSON or schema/equations,
request/stderr/stdout limit violation, or another process-level failure. No
structured issue may disguise the absence of a truthful required main report.

### Fixed story checking is retained with an explicit response boundary

`word/document.xml` remains required in every package. Optional
`word/footnotes.xml` and `word/endnotes.xml` retain missing-as-empty semantics
when any side supplies the part, reserved-note projection, namespace-aware root
checks, and independent field state. Their canonical successful-report order
remains main, footnotes, endnotes. The new `fixedStoryIssues` surface permits a
truthful main report plus structured optional-note failure without inventing an
optional report; it does not weaken required-main `not_run`.

Relationship-selected stories are appended after fixed stories. The existing
generic `checkStoryCollection` and `story_collection_checker_sound` theorem
check the combined list. No header/footer-specific checker or duplicate
collection theorem is introduced.

### Lean parses only direct explicit section bindings

For each package, Lean namespace-resolves `word/document.xml`, requires the
WordprocessingML `w:document` root, tracks the expanded-name ancestry stack,
and enumerates only exact direct `w:document/w:body/w:sectPr` and
`w:document/w:body/w:p/w:pPr/w:sectPr` elements in document order. Any other
`w:sectPr` placement emits `UNSUPPORTED_SECTION_PLACEMENT`. The zero-based
document-order index is `sectionOrdinal`.

Inventory construction requires exactly one direct
`w:document/w:body`. A missing, nested, or second direct body is a required-main
process failure. There may be at most one direct body-level terminal
`w:sectPr`, and no body child may follow it; duplicate or non-terminal terminal
sections are also required-main process failures. A header/footer reference
outside an open supported direct `w:sectPr`, including one directly under
`w:body`, emits `INDIRECT_SECTION_BINDING` rather than disappearing.

Within each supported `w:sectPr`, only direct
`w:headerReference` and `w:footerReference` children are candidates. Each must:

- have exactly one namespace-resolved relationships `r:id`;
- have exactly one WordprocessingML `w:type` equal to `first`, `default`, or
  `even`;
- be unique by `(kind, role)` in that section; and
- resolve through the package's own `word/_rels/document.xml.rels`.

Indirect header/footer descendants of a supported section emit
`INDIRECT_SECTION_BINDING`; unknown or missing roles and duplicate slots are
also structured selection failures. Prefix aliases do not affect ancestry
recognition. The selector does not infer a missing role from another section
or role. It does not inspect page settings to predict which story Word renders.
It never discovers `word/header*.xml` or `word/footer*.xml` by filename.

### Section alignment is ordinal and fail closed

The verifier does not run an LCS, heuristic matcher, or relationship-ID matcher
over sections. It requires all three documents to have the same section count
and the same ordered inventory of explicit logical slots. A count difference
produces `SECTION_COUNT_MISMATCH`; a selector-observable difference in the
ordered slot inventory produces `SECTION_SLOT_MISMATCH`.

After those checks, stories align only by
`(sectionOrdinal, kind, role)`. Relationship IDs and normalized paths are
side-specific evidence and are never used as cross-package identity. A
remaining per-ordinal target permutation is checked as the actual XML triple;
the verifier does not realign it to manufacture a pass. If the selected story
content differs, the generic accept/reject checks fail. If it is
selector-observably identical, the certificate makes no claim that sections
have a stable semantic identity, that semantically identical sections were not
permuted, or that Word renders them on the same pages.

Thus "section reordering failure" means only a reordering visible through
section count or the ordered direct `(kind, role)` slot inventory. The verifier
does not claim to detect a permutation of selector-indistinguishable sections.
Any ordinally aligned story triples still must satisfy every generic check.

### Relationship parsing and target normalization are narrow and safe

Lean independently indexes `word/_rels/document.xml.rels` in every package. If
the part is present, Lean namespace-parses every direct relationship record,
including unselected records; if it is absent, selection may continue only
when that package has no direct supported binding. It requires the
package-relationships `Relationships` root. A selected ID must resolve
unambiguously to exactly one relationship with:

- the exact header or footer office-document relationship type matching the
  binding kind;
- absent `TargetMode` or exact `Internal`;
- a non-empty internal target; and
- a safely normalized package-contained target part.

The Lean normalizer mirrors the established SafeDocX safety policy, not a full
OPC claim. It resolves relative targets against `word/document.xml`, accepts
package-absolute internal targets, removes safe `.` segments, and resolves
`..` only while containment remains inside the package root. It rejects empty
targets; query or fragment syntax; controls; backslashes; network paths;
scheme-like targets; malformed percent escapes; recursively encoded traversal
or separators; encoded path separators; and package-root escape. Normalization
is deterministic and produces a slash-separated package part path.

The selected target must exist within extraction bounds, parse under the
accepted XML subset, and have WordprocessingML root `w:hdr` for a header or
`w:ftr` for a footer. Unselected relationship records and unreferenced
header/footer parts receive no passing evidence. This is selected-target
validation, not validation of the package's complete relationship graph,
content types, or OPC conformance.

### Accepted package and XML subset is explicit

The verifier accepts Transitional WordprocessingML only:

- WordprocessingML:
  `http://schemas.openxmlformats.org/wordprocessingml/2006/main`;
- office-document relationships used by `r:id` and relationship types:
  `http://schemas.openxmlformats.org/officeDocument/2006/relationships`;
- package relationships:
  `http://schemas.openxmlformats.org/package/2006/relationships`; and
- exact relationship types
  `http://schemas.openxmlformats.org/officeDocument/2006/relationships/header`
  and
  `http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer`.

Strict OOXML namespace URIs are rejected as wrong namespace/root for this
increment. Prefix spelling is arbitrary but namespace resolution is mandatory.
The XML subset, applied to document XML, relationship XML, fixed stories, and
selected stories, is:

- UTF-8 bytes only, with at most one leading UTF-8 BOM;
- an optional leading XML 1.0 declaration with absent encoding or
  case-insensitive `UTF-8`, plus optional valid `standalone`;
- exactly one expanded-name root and XML whitespace only outside it;
- valid XML QNames and namespace scopes, no unbound prefixes, no empty prefixed
  bindings, and no illegal `xml` or `xmlns` rebinding;
- no duplicate attributes by expanded `(namespace URI, local name)`, including
  duplicates expressed through different prefixes;
- the five predefined XML entities and decimal/hex numeric character references
  only, each resolving to a valid XML 1.0 character; and
- no comments, non-declaration processing instructions, CDATA, DTD, entity
  declarations, or external entities.

Literal Unicode must be valid UTF-8 and valid XML 1.0. The parser performs no
Unicode normalization. Expanded names and text remain code-point-sensitive.

The relationships root may contain XML whitespace and direct package-namespace
`Relationship` children only. A record may use either self-closing syntax or
an explicit start/end pair with no child content. A record has exactly one unqualified `Id`,
`Type`, and `Target`, optional unqualified `TargetMode`, namespace declarations,
and no other attributes or child content. A nested relationship record,
unknown child, missing/duplicate required attribute, unknown attribute, or
duplicate expanded attribute is `MALFORMED_RELATIONSHIP_RECORD` or
`INVALID_RELATIONSHIPS_XML`. Duplicate `Id` values anywhere in the file are
`DUPLICATE_RELATIONSHIP_ID`, even when no duplicate record is selected.
Likewise, every direct record is structurally parsed even when unselected.
After structural parsing, type, target mode, target safety, and target existence
are evaluated only for selected records; a well-formed unselected external,
wrong-type, or otherwise unsupported relationship is not passing evidence and
does not fail this selected-target verifier.

Lean builds the trusted ZIP inventory from package bytes, not from
human-readable `unzip -Z` output. The accepted archive subset is classic
single-disk ZIP only. ZIP64, split/multi-disk archives, encryption, central
directory encryption, and compression methods other than stored (`0`) and
deflate (`8`) are rejected as process-level `not_run`; this is an honest
verifier scope limit, not a claim that those archives violate OPC.

For each package Lean:

1. Searches backward through at most the final 65,557 bytes for classic EOCD
   signature `0x06054b50`.
2. Accepts exactly one EOCD candidate whose fixed fields and comment length end
   exactly at EOF; requires disk numbers zero, entries-on-disk equal total
   entries, and rejects ZIP64 sentinel values or a ZIP64 locator/record.
3. Requires the central-directory offset and size to be in bounds, to end
   exactly at the EOCD, and to stay within the package and central-directory
   budgets.
4. Parses exactly the declared count of `0x02014b50` central records and
   consumes exactly the declared central-directory byte range. Every variable
   field length and arithmetic operation is checked before slicing. Every
   central record's disk-start field is exactly zero. Central and local extra
   fields are parsed as bounded `(headerId, dataSize, data)` sequences; malformed
   sequences and ZIP64 extended-information field ID `0x0001` are rejected
   anywhere, regardless of whether a classic size/offset sentinel is present.
   Central compressed size, expanded size, and local-header offset MUST NOT use
   `0xffffffff`; disk start MUST NOT use `0xffff`.
   DOS directory attributes and Unix directory/symlink/special-file mode bits
   are rejected; indexed entries are regular files only.
5. Resolves each central local-header offset to one in-bounds
   `0x04034b50` record before the central directory; requires central/local
   flags, method, filename bytes, CRC-32, compressed size, and expanded size to
   agree. For method `0`, the only allowed general-purpose flag bit is UTF-8
   bit 11, so `flags & ~0x0800 == 0`. For method `8`, only deflate option bits
   1-2 and UTF-8 bit 11 are allowed, so `flags & ~0x0806 == 0`. These exact
   masks reject encryption bit 0, data-descriptor bit 3, enhanced-deflate bit
   4, patched-data bit 5, strong-encryption bit 6, reserved bits 7-10 and 12,
   masked-header bit 13, and reserved bits 14-15. It computes each complete
   local-record span from local-header offset through the fixed local header,
   local filename, local extra field, and compressed data. Every complete span
   must be internally consistent with its central record, end at or before the
   central-directory offset, remain within package bounds, and be pairwise
   non-overlapping with every other complete local-record span.

If general-purpose bit 11 is set, central and local filename bytes must be
well-formed UTF-8. If bit 11 is clear, every filename byte must be printable
ASCII `0x20..0x7e`; CP437/non-ASCII fallback is rejected. Central or local
Unicode Path extra field `0x7075` is rejected to avoid a second filename
identity. Because central/local flags and raw filename bytes must match,
UTF-8-flag disagreement and alternate decoded identities are impossible.
Other non-`0x0001`/`0x7075` extra fields are length-checked and ignored.
Filename identity is the exact decoded code-point sequence; no case or Unicode
normalization is performed.

Every indexed name must be a nonempty relative forward-slash path and must not
contain controls, newline, carriage return, NUL, DEL, backslash, leading `/`,
empty final segment, `.`/`..` segment, colon, `?`, `#`, `*`, `[`, or `]`.
Those restrictions exclude absolute, traversal, scheme-like, query/fragment,
and `unzip` pattern-ambiguous names. Duplicate exact decoded names anywhere in
the package invalidate the index. Any EOCD, central/local, filename, duplicate,
flag, method, size, offset, overlap, or count failure prevents a trustworthy
index and is process-level `not_run`, including when the bad entry is
unselected.

After the binary index proves one unique safe central/local matching entry,
Lean MAY invoke `unzip -p -- <absoluteSnapshotPath> <exactSafeEntryName>` as an
argv array without a shell. The `--` terminates options; the indexed name cannot
contain glob metacharacters; and the snapshot path is launcher-controlled and
absolute. Before invocation Lean checks indexed compressed/expanded budgets.
After invocation it requires exit zero, bounded output, exact expanded byte
length, and CRC-32 equal to the indexed central record. Failure of any
correspondence check is process-level `not_run`. Thus `unzip -p` performs only
decompression after Lean has established exact entry identity; it supplies no
trusted inventory, size, path, or selection conclusion.

Unselected ordinary entries are not XML-parsed. Selected part lookup is an
exact case- and code-point-sensitive indexed-name match; ZIP names are never
percent-decoded.

Relationship targets are XML-decoded first, then URI-percent-decoded
repeatedly until no `%HH` remains, with a maximum of raw target UTF-8 byte
length plus one passes. Successful sides remain in pure candidate outcomes
when another side fails resolution. Malformed percent escapes, invalid percent-encoded
UTF-8, encoded `/` or `\` on any pass, encoded segments that become `.` or
`..`, controls, DEL, literal backslash, `?`, `#`, a network-path prefix, or any
colon, `*`, `[`, or `]` are `UNSAFE_TARGET`. Raw `.` and `..` segments are
resolved; escape above the package root fails. A leading `/` means
package-absolute. Repeated `/` and `.` segments collapse. Safe percent-encoded
ordinary Unicode is retained after decoding without NFC/NFD folding. Target
matching remains exact in case and Unicode code points.

If one selected physical work item fails part loading or selected-root parsing,
the response projects the successful loaded keys through
`projectLoadedSelection`: retained logical slots are filtered, contiguously
reindexed, and passed back through `assignPhysicalStoriesChecked` so physical
ordinals and canonical locator lists remain self-contained. Failed work emits
only its own structured issues; successfully loaded work and generic reports
remain visible, while aggregate `passed` is false.

### Aggregate resource limits are protocol constants

Protocol v4 pins these decimal-independent byte limits (`MiB = 1,048,576
bytes`) and count limits:

| Resource | Per package | Across three-package request | Per item |
| --- | ---: | ---: | ---: |
| Package file bytes | 32 MiB | 96 MiB | - |
| Classic central-directory bytes | 4 MiB | 12 MiB | - |
| ZIP entries | 1,024 | 3,072 | - |
| ZIP filename bytes | - | - | 256 |
| Supported sections | 64 | 192 | - |
| Direct header/footer bindings | 384 | 1,152 | - |
| Direct relationship records | 1,024 | 3,072 | - |
| Unique selected header/footer parts | 256 | 768 | - |
| Selected/fixed/selector XML compressed bytes | 16 MiB cumulative | 48 MiB cumulative | 8 MiB |
| Selected/fixed/selector XML expanded bytes | 32 MiB cumulative | 96 MiB cumulative | 16 MiB |
| XML parser events before semantic filtering | 1,000,000 cumulative | 3,000,000 cumulative | 500,000 |
| XML element depth | - | - | 128 |

At most 384 aligned logical relationship slots and 384 physical relationship
stories can be emitted. At most 1,536 structured selection plus optional-fixed
issues can be emitted. Relationship IDs are at most 128 UTF-8 bytes; raw
targets, normalized paths, package-part names, and other emitted locator
strings are at most 256 UTF-8 bytes; each `detail` is at most 256 UTF-8 bytes.
All variable identifier/path/target/detail strings as repeated in the complete
internal response share a 1 MiB aggregate UTF-8 budget before JSON escaping;
512 bytes of that budget are reserved for exactly one mutually exclusive
terminal `ISSUE_LIMIT_EXCEEDED` or
`EVIDENCE_STRING_BUDGET_EXCEEDED` issue.
Internal request JSON is at most 64 KiB, stdout response JSON at most 8 MiB,
and stderr at most 64 KiB.

Counts and byte sums are checked before allocation/extraction where metadata
permits and again against actual output. Reaching a ceiling exactly is allowed;
exceeding it fails. Each ZIP entry's compressed and expanded bytes counts once
per package even when it serves multiple roles. Package/index/main failures are
`not_run`; after valid main tokenization, relationship/selected/evidence
ceilings are structured `failed`; optional-note metadata/XML ceilings are
structured `failed`; actual extractor correspondence failures are `not_run`.
Budget accounting uses canonical phases and side order: required main first;
relationship XML plus all unique selected-target metadata and selected physical
work next in logical-slot order and original/revised/compared side order;
footnotes next; and endnotes last. Before any selected-target decompression,
the complete relationship phase metadata must satisfy unique-path,
selected-part, per-part, per-package, and three-package compressed/expanded
ceilings. A relationship-phase metadata ceiling emits a `selectionIssue` and
admits no selected-target decompression. Each admitted selected part is parsed
under its remaining per-part and package event budget; an aggregate event
failure stops later selected work. Optional notes are then admitted one story
at a time from central-directory metadata. A note whose metadata would cross a
byte ceiling emits its corresponding `fixedStoryIssue` without extraction; an
optional aggregate event failure likewise stops later optional parsing.
Truthful relationship evidence completed before an optional failure remains
visible. Bounded parse failures carry a typed reason plus completed/observed
event and depth counts. An event-limit failure is aggregate exhaustion whenever
the package's remaining event allowance is less than or equal to the
500,000-event per-part ceiling, including equality; it is a genuine per-part
overflow only when the remaining aggregate allowance is larger.
If issue count would exceed its budget, Lean emits the single bounded
`ISSUE_LIMIT_EXCEEDED`; if emitted variable strings would exceed their budget,
it emits `EVIDENCE_STRING_BUDGET_EXCEEDED`. Either terminal issue is emitted
only after a truthful main report exists, uses the reserved 512 bytes, emits no
partial slots/stories, clears optional fixed reports/issues, retains only the
schema-mandatory truthful main report, and returns `failed`.

The 8 MiB output bound is satisfied by construction. The prior flat
per-relationship-story bound is not used because a shared story can contain
many selector ordinals. Instead, the validated partition invariant says every
slot ordinal occurs in exactly one physical story's
`selectingSlotOrdinals`; therefore total selector-ordinal occurrences across
all physical stories equals `relationshipSlots.length` and is at most 384.

The schema serializer uses these conservative non-string upper bounds:

- 384 bytes per logical slot;
- 640 bytes of fixed overhead per physical story, excluding variable strings
  and selector-ordinal entries but including its selector-array brackets;
- eight bytes per selector-ordinal occurrence, covering up to three decimal
  digits, comma placement, and slack;
- 256 bytes per issue; and
- 128 KiB for root, fixed reports/issues, arrays, booleans, counts, and
  delimiters.

Any UTF-8 byte in a variable string expands to at most six JSON bytes. The
maximum structural charge for relationship stories is thus
`384 * 640 + 384 * 8`, independent of whether selectors share one story or are
distributed across 384 stories. Therefore the maximum response is:

```text
6 * 1,048,576
+ 384 * 384
+ 384 * 640
+ 384 * 8
+ 1,536 * 256
+ 131,072
= 7,212,032 bytes
< 8,388,608 bytes
```

The compiled `ProtocolV4MaximumShape.lean` producer uses the same
`protocolV4ResponseJson` constructor as `LeanDocxChecker` and constructs two
strict-decoder-accepted maximum-cardinality schema responses with near-ceiling
worst-case JSON-escaped string budgets:

1. one shared header story with the legal single-kind maximum selector list
   `[0, ..., 191]` (64 sections times three roles); and
2. 384 physical stories, each containing its one partitioned selector ordinal.

The shared response uses 1,047,663 emitted string bytes and serializes to
2,173,684 bytes; the distinct response uses 1,048,093 emitted string bytes and
serializes to 2,348,656 bytes. The strict TypeScript decoder accepts both and
asserts each remains below 8,388,608 bytes. Terminal-shape fixtures separately
require exactly one reserved terminal issue, only the main fixed report, and
empty fixed issues, slots, and relationship stories.

These limits comfortably contain the checked-in NVCA source (147,622 package
bytes, 44 entries, four sections, 18 direct bindings, 30 relationship records,
and less than 650 KiB expanded across document, relationships, headers, and
footers). They are verifier safety limits, not ECMA-376 maxima.

### Logical evidence and physical work are separate

Canonical logical ordering is:

1. section ordinal ascending;
2. kind `header`, then `footer`;
3. role `first`, `default`, then `even`.

Each logical slot records its original, revised, and compared relationship ID
and normalized target. Execution groups slots only when kind and the complete
three-side normalized target tuple are identical. Such a shared target triple
is parsed and checked once, and its report lists every selecting logical slot
in canonical order. If only one or two side paths match, the grouping key still
contains all three paths and cannot conflate different triples.

Physical work items are ordered by the first canonical selecting slot. Fixed
stories remain first. Diagnostics use canonical side order original, revised,
compared, then section/kind/role order, then stable code. ZIP entry order,
relationship order, attribute order, and relationship IDs do not affect report
ordering.

### Selection failures are structured and aggregate fail closed

A protocol v4 selection issue carries:

- stable `code`;
- `side`: `original`, `revised`, or `compared` when side-specific;
- `sectionOrdinal`, `kind`, and `role` when known;
- raw `relationshipId` and target when safely reportable;
- normalized part path when resolution reached one; and
- bounded human-readable `detail`.

`SelectionIssueCode` covers relationship XML/root/count/record defects, direct
binding and selector-observable slot-alignment defects, missing/ambiguous
relationship IDs, relationship type or target-mode mismatch, unsafe targets,
and selected-part presence/size/UTF-8/XML/root/depth/token defects.
`FixedStoryIssueCode` covers the corresponding optional footnote/endnote
failures. Required-main and ZIP index/extractor failures deliberately have no
structured response code because they are `not_run`.

Any selection issue makes protocol `passed` false even when every successfully
assembled story report passes. A selected candidate is never silently omitted,
substituted, or represented by empty XML after a resolution failure. Malformed
unreferenced header/footer parts remain outside the selected set and do not
fail verification.

### Public certificate protocol v1 is additive

The public `DocumentIntegrityCertificate.protocolVersion` remains `1`.
Existing verifier, `scope: "word/document.xml"`, reconstruction mode, main XML
hashes, main checks, main token counts, fixed-story scope, package hashes,
fixed-story reports, presence mismatches, statuses, and their meanings remain
available. Legacy public v1 producer fixtures remain decodable. The additive
TypeScript surface is exactly:

```ts
interface DocumentIntegrityRelationshipScope {
  selection: 'direct-explicit-section-bindings';
  alignment: 'sectionOrdinal-kind-role';
  kinds: readonly ['header', 'footer'];
  roles: readonly ['first', 'default', 'even'];
  inheritedRoles: false;
  reconstructionMode: 'inplace';
}

interface DocumentIntegrityRelationshipSideIdentity {
  relationshipId: string;
  normalizedPartPath: string;
}

interface DocumentIntegrityEvaluatedCheckCertificate {
  status: 'passed' | 'failed';
  claim: string;
}

interface DocumentIntegrityRelationshipSlot {
  slotOrdinal: number;
  sectionOrdinal: number;
  kind: 'header' | 'footer';
  role: 'first' | 'default' | 'even';
  original: DocumentIntegrityRelationshipSideIdentity;
  revised: DocumentIntegrityRelationshipSideIdentity;
  compared: DocumentIntegrityRelationshipSideIdentity;
  physicalStoryOrdinal: number;
}

interface DocumentIntegrityRelationshipStory {
  physicalStoryOrdinal: number;
  kind: 'header' | 'footer';
  originalPartPath: string;
  revisedPartPath: string;
  comparedPartPath: string;
  selectingSlotOrdinals: number[];
  status: 'passed' | 'failed';
  checks: {
    acceptingAllTrackedChangesMatchesRevisedText: DocumentIntegrityEvaluatedCheckCertificate;
    rejectingAllTrackedChangesMatchesOriginalText: DocumentIntegrityEvaluatedCheckCertificate;
    acceptingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityEvaluatedCheckCertificate;
    rejectingAllTrackedChangesKeepsValidFieldStructure: DocumentIntegrityEvaluatedCheckCertificate;
    comparedStoryHasNoFieldMarkersInsideDeletions: DocumentIntegrityEvaluatedCheckCertificate;
    trackedMoveRangesAreCorrectlyPaired: DocumentIntegrityEvaluatedCheckCertificate;
  };
  parsedTokenCounts: { original: number; revised: number; compared: number };
}

type DocumentIntegrityRelationshipSelectionIssueCode = SelectionIssueCode;

interface DocumentIntegrityRelationshipSelectionFailure {
  code: DocumentIntegrityRelationshipSelectionIssueCode;
  side?: 'original' | 'revised' | 'compared';
  sectionOrdinal?: number;
  kind?: 'header' | 'footer';
  role?: 'first' | 'default' | 'even';
  relationshipId?: string;
  rawTarget?: string;
  normalizedPartPath?: string;
  detail: string;
}

interface DocumentIntegrityFixedStoryFailure {
  code: FixedStoryIssueCode;
  name: 'footnotes' | 'endnotes';
  side: 'original' | 'revised' | 'compared';
  packagePart: 'word/footnotes.xml' | 'word/endnotes.xml';
  detail: string;
}

interface DocumentIntegrityCertificate {
  // Existing v1 fields are unchanged and omitted from this excerpt.
  checkerProtocolVersion?: 3 | 4;
  fixedStoryFailures?: DocumentIntegrityFixedStoryFailure[];
  relationshipStoryScope?: DocumentIntegrityRelationshipScope;
  relationshipSlots?: DocumentIntegrityRelationshipSlot[];
  relationshipStories?: DocumentIntegrityRelationshipStory[];
  relationshipSelectionFailures?: DocumentIntegrityRelationshipSelectionFailure[];
}
```

Existing `stories` remains the successfully tokenized fixed
main/footnote/endnote list. For a valid protocol v4 run,
`fixedStoryFailures` and all four relationship fields above are present
together, including empty arrays, and `checkerProtocolVersion` is `4`. Their
values are a plain mapping of the validated internal v4 response: `combined`
token counts become public `compared`; boolean checks become existing public
check certificates; and all ordinals, identities, ordering, cardinality
equations, and issue codes are preserved. For a legacy certificate or a
producer that did not run v4, all five may be absent and
`checkerProtocolVersion` may be absent or `3`. Partial presence of the five
fields is not emitted by this producer.

Absence of these additive fields means relationship-story verification was not
available, never that it passed. Header/footer exclusions are narrowed only
when v4 evidence is present. Exclusions continue to state that inherited role
semantics, unselected parts, complete relationship integrity, full OPC/schema
validation, rendering, and full ECMA-376 conformance are not checked.

Public status is an exact decision table: non-inplace reconstruction is
`not_applicable` without invoking v4; a valid v4 response is `passed` if and
only if its validated `passed` is true and otherwise is `failed`; absence of a
valid v4 response for any process/extraction/protocol reason listed above is
`not_run`. The five v4 evidence fields are emitted for valid `passed` and
`failed` responses, and omitted for `not_applicable` and `not_run`.

### Selector and aggregate proof obligations are mandatory

The implementation SHALL introduce these theorem names over the pure functions
that `LeanDocxChecker` actually calls. No result carries caller-supplied proof
fields, and no selector entry point is an identity wrapper:

```lean
theorem direct_binding_selection_complete
    (h : resolveCandidatesChecked ... = .ok (outcomes, slots)) :
    ∀ outcome ∈ outcomes, ∀ side ∈ [original, revised, compared],
      sideBindingCompleteB outcome slots side = true

theorem aligned_slot_unique_work_item
    (h : assignPhysicalStoriesChecked slots = .ok (assigned, stories)) :
    alignedSlotUniqueWorkB assigned stories = true

theorem dedup_preserves_selector_locators
    (h : assignPhysicalStoriesChecked slots = .ok (assigned, stories)) :
    selectorLocatorPartitionB assigned stories = true

theorem relationship_story_aggregate_sound
    (hSelection :
      validateAggregateSelection outcomes slots physicalStories loadedWorks
        selectedStories = .ok ())
    (hPassed : storyCollectionPassed
      (checkStoryCollection (fixedStories ++ selectedStories)) = true) :
    (∀ outcome ∈ outcomes, ∀ side ∈ [original, revised, compared],
      sideBindingCompleteB outcome slots side = true) ∧
    alignedSlotUniqueWorkB slots physicalStories = true ∧
    selectorLocatorPartitionB slots physicalStories = true ∧
    selectedStoryIdentityCorrespondsB physicalStories loadedWorks
      selectedStories = true ∧
    ∀ story ∈ fixedStories ++ selectedStories,
      CheckedStoryProperties story
```

`resolveCandidatesChecked` retains all three side outcomes, including
successful resolutions when a peer side fails, and checks every per-side
binding identity has exactly one identifying issue or exact membership in one
emitted aligned slot, mutually exclusively. `assignPhysicalStoriesChecked`
requires each physical locator list to equal the canonical sorted locator list
derived from aligned slots. `validateAggregateSelection` compares each selected
triple with a `LoadedPhysicalWork`, including the complete physical story/key,
generated name, and exact original/revised/combined token lists. These are the
fail-closed executable constructors used by the checker; no proof field or
caller-built identity wrapper participates. Inputs rejected by
package/main/section/binding limits remain `not_run`.

`relationship_story_aggregate_sound` SHALL invoke, rather than restate or
duplicate, `story_collection_checker_sound` for the final deterministic list of
fixed and selected physical stories. `SelectionComplete`, `SlotsAligned`, and
`DedupExact` SHALL encode the response equations above, including exactly one
aligned slot for every issue-free supported direct binding, exactly one work
item per successful slot, no duplicate physical key, and preservation of every
selector locator.

`verification/lean/AxiomAudit.lean` SHALL retain its existing targets and add
exactly these `#print axioms` targets:

```lean
#print axioms Tier2.RelationshipStorySelector.direct_binding_selection_complete
#print axioms Tier2.RelationshipStorySelector.aligned_slot_unique_work_item
#print axioms Tier2.RelationshipStorySelector.dedup_preserves_selector_locators
#print axioms Tier2.RelationshipStorySelector.relationship_story_aggregate_sound
```

The normalized union across the full audit must remain exactly:

```text
Classical.choice
LeanSpike.compareDocumentXml
LeanSpike.compareDocumentXml_output_preservation_friendly
LeanSpike.compareDocumentXml_output_text_roundtrip
Quot.sound
propext
```

No new axiom is added, and no selector theorem may depend on the three
`LeanSpike.compareDocumentXml*` residuals merely because those names remain in
the repository-wide union. All Lean modules remain zero-`sorry`.

### Tests exercise synthetic adversaries and real NVCA packages

Compiled executable and launcher tests cover:

- multiple sections and every header/footer first/default/even role;
- side-specific relationship IDs and target paths aligned by logical slot;
- relative, package-absolute, and safe normalized targets;
- shared targets selected by multiple slots, checked once with all selectors;
- deterministic output under reordered ZIP entries, relationships, namespace
  prefixes, and attributes;
- section-count and selector-observable ordered-slot mismatches without
  heuristic reconciliation, plus the explicit non-claim for permutations of
  selector-indistinguishable sections;
- duplicate bindings and relationship IDs, missing relationships or rels
  parts, wrong relationship types, external/invalid target modes, unsafe
  targets, missing parts, malformed XML, wrong roots, and extraction bounds;
- ambiguous/truncated EOCD, ZIP64 sentinels or `0x0001` extras, nonzero central
  disk starts, multi-disk/encrypted/unsupported-method archives,
  method-specific flag-mask violations, central/local name/flag/size mismatch,
  invalid UTF-8/non-ASCII unflagged names, Unicode Path extra fields,
  duplicate/unsafe/pattern names, invalid complete local-record
  size/offset/overlap spans, and extractor length/CRC mismatch;
- request/output version rejection, unknown fields, duplicate or out-of-order
  evidence, inconsistent counts, mandatory-main `not_run`, post-main
  structured failures, both selector-partition maximum response shapes, both
  terminal issue reservations, worst-case JSON escaping, and inconsistent
  aggregate pass bits; and
- continued fixed main/footnote/endnote behavior under protocol v4.

The real regression loads
`tests/test_documents/nvca-coi-regression/source.docx`, derives the revised
package through one minimal unrelated body edit with exported
`replaceParagraphTextRange`, and produces a true inplace comparison. It first
requires a passing v4 certificate with nonzero selected relationship-story
evidence. It then keeps original and revised snapshots byte-identical and
mutates only the compared snapshot, one deduplicated selected header/footer
target at a time.

Each mutation preserves the selected part path, relationship record, target
root, namespaces, accepted XML subset, limits, and successful selection. It
changes one parser-accepted, token-observable input to the generic checker:
visible `w:t`/`w:delText`, field-marker placement/type, or a tracked-move token.
The test first asserts the mutated run has no selection issue and retains the
same relationship slot/work-item identity, then asserts the corresponding
relationship story report has `status: "failed"` and at least one failed
generic check. It does not accept a selection failure, `not_run`, or mutation
of an ignored formatting-only node as evidence that story checking worked.
Shared targets are mutated once and the failed physical report must retain
every selecting slot locator. No test uses `filled.docx` to stand in for the
source-derived pair.

### Coverage and CI are explicit

`verification/registry/lean-xml-checker-coverage.json` moves to protocol v4 and
lists the newly parsed document binding, package relationship, header, and
footer surfaces plus exact exclusions. Tier 2/verifier documentation describes
the required-main status boundary, classic-ZIP binary index and ZIP64
exclusion, output-size proof, ordinal alignment, selected-target normalization,
certificate fields, and non-goals.

The ECMA registry may cite edition 5 Part 1 §§17.10.2 and 17.10.5 for typed
footer/header bindings and §§17.10.3 and 17.10.4 for selected story roots.
Safe OPC normalization, containment, alignment, deduplication, and certificate
aggregation remain SafeDocX policies. Registry `verifiedBy` paths and generated
`spec-compliance/CONFORMANCE.md` are updated and drift-checked.

Lean CI path filters include the launcher, its compiled-verifier tests, the
NVCA mutation test, and relevant fixtures. After `lake build`, CI runs the
focused protocol v4 verifier suite with the actual compiled executable before
the existing differential jobs.

## Risks / Trade-offs

- Ordinal section alignment deliberately rejects structurally changed section
  inventories rather than guessing correspondence. This narrows passing
  coverage but prevents false alignment.
- Implementing XML and relationship selection in Lean adds parser surface.
  Exact accepted syntax, bounds, adversarial tests, and a coverage ledger keep
  that surface auditable.
- The classic-ZIP-only binary index intentionally returns `not_run` for ZIP64
  and other unsupported archives that `unzip` could otherwise read. This
  narrows verifier availability in exchange for independently established
  entry identity; coverage docs state that scope without an OPC conformance
  claim.
- Shared-target dedup complicates evidence. Separating logical selectors from
  physical work items prevents a performance optimization from erasing
  identity.
- Public v1 grows additively while internal v4 is intentionally incompatible
  with v3. Strict fixture migration and legacy public-certificate tests make
  that boundary explicit.

## Migration Plan

1. Add Lean selector structures, parsing, normalization, failures, and audited
   selector theorem(s), then reuse the existing collection checker.
2. Change the executable and launcher fixtures atomically from internal v3 to
   v4; do not retain a dual-version executable path.
3. Add optional public v1 fixed-failure and relationship-story fields and
   preserve legacy v1 decoding tests.
4. Add compiled synthetic/adversarial and real NVCA mutation coverage.
5. Update CI, checker coverage, verifier docs, ECMA registry evidence, and
   generated conformance docs.

Rollback restores the v3 executable/launcher pair and removes only the additive
v1 fixed-failure/relationship fields. Existing public v1 fixed-story
certificates remain valid throughout.

## Open Questions

None. Section-count and selector-observable ordered-slot differences are
intentionally fail-closed under ordinal alignment; semantic identity and
permutations of selector-indistinguishable sections are not claimed. Inherited
role semantics and rebuild certification remain future work.
