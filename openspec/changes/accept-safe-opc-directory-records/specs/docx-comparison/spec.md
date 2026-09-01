## MODIFIED Requirements

### Requirement: Protocol v4 pins its accepted syntax and aggregate limits

The verifier SHALL accept only the Transitional namespaces and the exact
XML/namespace, relationship-record, ZIP, and relationship-target subsets
specified in the change design. Strict OOXML namespace URIs SHALL remain
outside this increment. Prefixes SHALL resolve namespace-aware; malformed
QNames, unbound or illegally rebound prefixes, duplicate expanded attributes,
unsupported declarations/entities, comments, non-declaration processing
instructions, CDATA, DTDs, external entities, extra roots, or non-whitespace
outside the root SHALL fail closed.

Relationship records SHALL be direct children of the package-relationships
root with exactly one `Id`, `Type`, and `Target` and at most one `TargetMode`.
Both self-closing and explicit-empty records SHALL be accepted; child content
SHALL fail structurally. Malformed records and duplicate IDs SHALL fail
structurally even when unselected. A structurally valid unselected record's
type/target semantics SHALL remain unchecked and SHALL receive no passing
evidence.

Lean SHALL construct the trusted package inventory by bounded binary parsing of
a classic single-disk ZIP central directory. It SHALL perform the exact EOCD
search/validation, central-record consumption, central/local filename and
flags/method agreement, UTF-8-flag/printable-ASCII name policy, Unicode Path
extra-field rejection, duplicate and unsafe-name rejection, compression/
encryption policy, and size/offset/range/overlap checks specified in the
design. It SHALL reject ZIP64 extra field ID `0x0001` in every central or local
extra sequence regardless of sentinel use, require every central disk-start
field to equal zero, and require classic size/offset fields rather than ZIP64
sentinels.

Every central record SHALL be classified from the exact decoded name's trailing
slash, DOS directory attribute, and recognized Unix file type. A directory
record name SHALL end in `/` but not `//`, have at least one DOS or Unix
directory indication, and have no contradictory Unix regular-file type. The
one final empty path segment represented by that slash SHALL be the only
directory-specific exception to the existing safe-name policy. A regular file
SHALL have no trailing slash or DOS directory indication and either no Unix
type or Unix regular-file type. Ambiguous classification, symlinks, and
special-file types SHALL be `not_run`.

An accepted directory record SHALL use stored method `0` and declare zero
CRC-32, compressed size, and expanded size. Its central and local flags,
method, raw filename, CRC-32, compressed size, and expanded size SHALL agree,
and its computed data offset SHALL equal its complete local-record span end.
The verifier SHALL retain each directory through package, central-directory,
entry-count, name-length, duplicate, complete-local-span, and overlap checks.
For collision identity only, it SHALL remove exactly one final slash from a
validated directory name while retaining a regular-file name unchanged, and
SHALL reject a file/directory identity collision. Only after all checks pass
SHALL directories be omitted from the trusted OPC part inventory and therefore
from selected-part lookup, decompression, and certificate evidence.

For stored method `0`, only UTF-8 bit 11 SHALL be allowed
(`flags & ~0x0800 == 0`). For deflate method `8`, only option bits 1-2 and
UTF-8 bit 11 SHALL be allowed (`flags & ~0x0806 == 0`). Central/local flags
SHALL be equal. Every complete local-record span, comprising fixed local
header, filename, extra field, and compressed data, SHALL agree with its
central record, end no later than the central-directory start, remain
package-bounded, and be pairwise non-overlapping. ZIP64, multi-disk, encrypted,
data-descriptor/patch/strong-encryption/reserved-flag, unsupported-method,
ambiguous-name, or invalid index input SHALL be `not_run`, not structured
selection failure.

Only after one unique safe central/local regular-file entry is proven MAY Lean
invoke `unzip -p --` by argv for decompression. It SHALL use an absolute
controlled snapshot path and exact pattern-safe entry name, then verify exit
status, bounded output length, and CRC-32 against the binary index. Extractor
correspondence failure SHALL be `not_run`; `unzip` output SHALL NOT supply
trusted inventory metadata.

The verifier SHALL enforce the exact per-item, per-package, and three-package
limits specified in the design: 32/96 MiB packages; 4/12 MiB classic central
directories; 1,024/3,072 ZIP entries, including directory records; 256-byte
ZIP names; 64/192 sections; 384/1,152 direct bindings; 1,024/3,072 relationship
records; 256/768 unique selected parts; 8 MiB compressed and 16 MiB expanded
per XML part; 16/48 MiB cumulative compressed XML; 32/96 MiB cumulative
expanded XML; 500,000 per-part, 1,000,000 per-package, and 3,000,000
per-request XML events; depth 128; 1,536 issues; 128-byte relationship IDs;
256-byte path/target/locator/detail values; 1 MiB aggregate emitted variable
strings; 64 KiB request/stderr; and 8 MiB response.

Resource admission SHALL proceed as required main first; relationship XML,
complete unique selected-target metadata, and selected physical work next;
footnotes next; and endnotes last. Before decompressing any selected target,
Lean SHALL enforce every metadata-known relationship path-count, selected-part,
compressed-byte, and expanded-byte ceiling over each package and the triple.
A relationship metadata ceiling SHALL emit a selection issue and SHALL admit
no selected-target decompression. Each admitted XML part SHALL be event-parsed
under the remaining per-part and package bounds, and its semantic tokens SHALL
be derived from that bounded event stream without an unbounded second parse.
Aggregate event exhaustion SHALL stop later selected work. An optional note
whose metadata would cross a byte ceiling SHALL emit its corresponding fixed
story issue without extraction; optional processing SHALL remain ordered
footnotes before endnotes, and truthful relationship evidence already completed
SHALL remain visible.
Bounded XML parse failure SHALL carry a typed reason and completed/observed
event and depth counts. A typed event-limit failure SHALL be aggregate
exhaustion when the remaining package allowance is less than or equal to the
500,000-event per-part ceiling, including equality, and SHALL stop subsequent
selected and optional extraction. It SHALL remain a per-part overflow only when
the remaining package allowance is greater than 500,000.

The response serializer SHALL use the invariant that selecting slot ordinals
form an exact partition across physical stories. It SHALL bound relationship
story structure as at most 384 fixed story-overhead charges of 640 bytes plus
384 selector-ordinal charges of eight bytes, rather than a false flat bound
that includes an unbounded selector list. Together with the other design
charges and six-times worst-case JSON expansion of the 1 MiB string budget,
the maximum SHALL be 7,212,032 bytes, below 8,388,608.

Executable maximum-shape fixtures SHALL cover one shared story with the legal
192-selector single-kind maximum and 384 stories with one selector each, both
with worst-case escaping and near-ceiling string budgets. Separate fixtures
SHALL spend the reserved 512 string bytes on `ISSUE_LIMIT_EXCEEDED` and
`EVIDENCE_STRING_BUDGET_EXCEEDED` in turn. No within-budget input SHALL
overflow the output cap.

#### Scenario: [LEAN-REL-14] XML and namespace subset fails closed

- **WHEN** selector or selected-story XML uses a Strict namespace, malformed or
  unbound QName, duplicate expanded attribute, unsupported declaration/entity,
  comment, processing instruction, CDATA, DTD, external entity, or extra root
- **THEN** protocol v4 SHALL reject it under the pinned accepted subset
- **AND** alternate prefixes correctly bound to the Transitional namespaces
  SHALL remain accepted

#### Scenario: [LEAN-REL-15] Unselected relationship records remain structurally bounded

- **WHEN** an unselected direct relationship record is malformed or duplicates
  any relationship ID
- **THEN** selection SHALL fail with a structured issue
- **BUT WHEN** an unselected record is structurally valid but has an unsupported
  type, external mode, or unsafe target
- **THEN** its target semantics SHALL remain unchecked and no passing evidence
  SHALL be emitted for it

#### Scenario: [LEAN-REL-16] Aggregate budgets prevent amplification

- **WHEN** an item, package, or three-package aggregate exceeds any pinned ZIP,
  section, binding, relationship, selected-part, byte, XML event/depth, issue,
  locator/detail, request, diagnostic, or response limit
- **THEN** the run SHALL fail before publishing a passing certificate
- **AND** reaching a limit exactly SHALL remain permitted

#### Scenario: [LEAN-REL-22] Metadata and event admission stop decompression

- **WHEN** selected paths exceed 256, relationship metadata exceeds a byte
  aggregate, an optional note would cross the remaining byte budget, or an
  admitted part exhausts the aggregate XML-event budget
- **THEN** Lean SHALL not decompress metadata-rejected selected or optional
  parts and SHALL stop parsing later work after event exhaustion
- **AND** relationship failures SHALL remain selection issues, optional
  crossings SHALL remain fixed-story issues, and prior truthful relationship
  evidence SHALL remain visible
- **AND** exact equality between remaining aggregate events and the per-part
  ceiling SHALL use aggregate classification without inspecting diagnostic text

#### Scenario: [LEAN-REL-20] Lean binary index establishes exact extraction identity

- **WHEN** a classic single-disk stored/deflated package satisfies the bounded
  EOCD, central-directory, local-header, filename, flag, size, offset, and CRC
  contract
- **THEN** Lean MAY decompress one uniquely indexed safe exact regular-file name
  through `unzip -p --`
- **AND** SHALL accept the bytes only when output length and CRC match the index

#### Scenario: [LEAN-REL-21] Archive ambiguity is not a structured verifier result

- **WHEN** a package is ZIP64, multi-disk, encrypted, uses a data descriptor or
  unsupported method, has ambiguous EOCD, mismatched central/local names,
  invalid UTF-8/ASCII naming, Unicode Path ambiguity, duplicate/unsafe names,
  ZIP64 `0x0001` extra field, nonzero central disk start, forbidden flag bit,
  ambiguous or unsafe directory/symlink/special entries, file/directory
  identity collisions, overlapping or out-of-bounds complete local-record
  spans, or extractor correspondence failure
- **THEN** the executable SHALL produce no valid v4 response
- **AND** the public certificate SHALL be `not_run`

#### Scenario: [LEAN-REL-23] Safe directory records do not become OPC parts

- **WHEN** a classic ZIP carries a central/local directory record whose name
  and DOS/Unix classification are unambiguous, whose method is stored, and
  whose CRC-32, sizes, and payload are zero
- **THEN** Lean SHALL charge and validate the record before omitting it from the
  trusted regular-file part inventory
- **AND** the directory SHALL produce no selected-part or certificate evidence
- **AND** an ambiguous, contradictory, payload-bearing, duplicate,
  file/directory-colliding, overlapping, or over-limit directory record SHALL
  return process-level `not_run`

#### Scenario: [LEAN-REL-22] Every legal response fits the output cap

- **WHEN** response arrays and variable strings reach every protocol-v4
  cardinality and aggregate evidence ceiling
- **THEN** production serialization SHALL remain below 8 MiB even under
  worst-case JSON escaping
- **AND** maximum-schema fixtures SHALL cover both one shared story with the
  legal 192-selector single-kind maximum and 384 one-selector stories
- **AND** either terminal issue SHALL fit using its mutually exclusive reserved
  bytes
