## ADDED Requirements

### Requirement: Deterministic Locator Resolution
The system SHALL provide `resolveLocator(view, locator)` that resolves a `Locator` against a `DocumentViewNode[]` to at most one text span, deterministically. A `Locator` SHALL consist of an optional ordered `scope` (one or more `section` steps), a required single `primary` step, and optional ordered `assertions`. Resolution SHALL be total and reproducible: identical inputs SHALL always yield identical output, with no randomness, no scoring, no confidence weighting, and no fuzzy matching. The returned `match` offsets SHALL be **raw** paragraph-text offsets (consumable directly by `replaceParagraphTextRange`/`replaceTextAtRange`), translated from the `clean_text` match position via the offset map.

#### Scenario: primary resolves exactly one span
- **GIVEN** a view and a locator whose `primary` regex matches exactly one span in scope
- **WHEN** `resolveLocator` is called
- **THEN** `match` SHALL be `{ nodeId, start, end }` with raw-text offsets
- **AND** `unresolved` SHALL be `false`

#### Scenario: zero matches is unresolved
- **GIVEN** a locator whose `primary` step matches nothing in scope
- **WHEN** `resolveLocator` is called
- **THEN** `match` SHALL be `null`
- **AND** `unresolved` SHALL be `true`

#### Scenario: multiple matches is unresolved, never a guess
- **GIVEN** a locator whose `primary` step matches more than once in scope
- **WHEN** `resolveLocator` is called
- **THEN** `unresolved` SHALL be `true`
- **AND** the resolver SHALL NOT pick the first or any "best" match

#### Scenario: resolution is reproducible
- **GIVEN** the same view and locator
- **WHEN** `resolveLocator` is called twice
- **THEN** both calls SHALL return byte-identical results

### Requirement: Locator Scope Narrowing
A `section` scope step SHALL narrow resolution to a contiguous region of the view: from the single heading node it matches, up to (but excluding) the next heading at outline level `≤ untilLevel`. A `section` step SHALL match **exactly one** heading in the current scope; zero or multiple matching headings SHALL make the locator `unresolved`. Multiple `scope` steps SHALL apply in order, each narrowing within the previous region.

#### Scenario: section narrows to its region
- **GIVEN** a view with a heading "Preamble" followed by body paragraphs and a later heading
- **AND** a locator with `scope: [{ kind: 'section', headingText: 'Preamble' }]` and a `primary` regex present both inside and outside the region
- **WHEN** `resolveLocator` is called
- **THEN** only the occurrence inside the Preamble region SHALL be considered

#### Scenario: repeated heading is unresolved
- **GIVEN** a view containing two headings with identical text matched by a `section` step
- **WHEN** `resolveLocator` is called
- **THEN** `unresolved` SHALL be `true`
- **AND** the resolver SHALL NOT silently choose the first heading

### Requirement: Locator Step Kinds
The resolver SHALL support four deterministic step kinds. `section` SHALL match a heading by `headingText`/`headingRegex`/`headingStyleId` and SHALL be valid ONLY as a `scope` step — it SHALL NOT be used as a `primary` or assertion, because it denotes a region, not a span. `regex` SHALL match against node `clean_text` and report 0, 1, or many matches; a pattern that yields a zero-length match SHALL be treated as invalid and make the locator `unresolved` (no heuristic advance). `contextual` SHALL require a `contextPattern` to precede the `targetPattern` within a node, optionally gated by `rowLabelPattern` over `table_context.col_header`; its `targetPattern` SHALL likewise be non-zero-length. `fingerprint` SHALL select a whole node whose content fingerprint — computed from the node's raw visible text (`node.text`) via `computeContentFingerprint`, consistent with that function's existing definition — equals the given `sha256:nfkc:` value; it is a node-level anchor and SHALL NOT denote a sub-span.

#### Scenario: section is scope-only
- **GIVEN** a locator whose `primary` (or an assertion) is a `section` step
- **WHEN** `resolveLocator` is called
- **THEN** it SHALL be rejected as invalid because `section` does not produce a span

#### Scenario: zero-length regex is unresolved
- **GIVEN** a `regex` primary whose pattern can match an empty string
- **WHEN** `resolveLocator` is called
- **THEN** `unresolved` SHALL be `true`
- **AND** no zero-length span SHALL be returned

#### Scenario: contextual requires context before target
- **GIVEN** a node "by and among NewCo, Inc., a Delaware corporation and the Investors"
- **AND** a `contextual` step with `contextPattern: "by and among"` and `targetPattern: "[A-Z][\\w, .]+, a Delaware corporation"`
- **WHEN** `resolveLocator` is called
- **THEN** the span matching the target after the context SHALL be returned

#### Scenario: fingerprint selects a whole node
- **GIVEN** a `fingerprint` primary whose value equals one node's `computeContentFingerprint(node.text)` (raw visible text)
- **WHEN** `resolveLocator` is called
- **THEN** the match SHALL span that whole node
- **AND** no sub-span offset narrowing SHALL be applied

### Requirement: Locator Assertions
Assertions SHALL corroborate, never select. A `regex` or `contextual` assertion SHALL be satisfied only when it resolves to the **same** `{ nodeId, start, end }` as `primary` (raw coordinate system, post-translation). A `fingerprint` assertion SHALL be satisfied when it matches the **same `nodeId`** as `primary` — span equality SHALL NOT apply to fingerprint assertions, since a fingerprint is a whole-node anchor. Each assertion result SHALL be reported in `assertionResults`; any failed assertion is a drift signal.

#### Scenario: span assertion must equal primary span
- **GIVEN** a resolved primary span and a `regex` assertion resolving to a different span in the same node
- **WHEN** `resolveLocator` is called
- **THEN** that assertion's result SHALL be `ok: false`

#### Scenario: fingerprint assertion matches node identity only
- **GIVEN** a resolved primary span and a `fingerprint` assertion whose value equals the primary node's fingerprint
- **WHEN** `resolveLocator` is called
- **THEN** that assertion's result SHALL be `ok: true`
- **AND** the whole-node fingerprint SHALL NOT be compared against the primary sub-span offsets

#### Scenario: failed assertion does not change the match
- **GIVEN** a resolved primary span and a failing assertion
- **WHEN** `resolveLocator` is called
- **THEN** `match` SHALL still be the primary span
- **AND** the failure SHALL be reported in `assertionResults`

### Requirement: Clean-to-Raw Offset Map
The system SHALL provide a per-node `clean_text → raw` offset map that translates a character offset in a node's `clean_text` to the corresponding offset in its raw visible text. The map SHALL account for the transforms `clean_text` actually applies: leading/trailing trim, CR/LF removal, and manual list-label stripping. It SHALL NOT assume internal whitespace collapse, because `clean_text` does not collapse internal whitespace (only `computeContentFingerprint` does). This map generalizes the scalar `visible_offset_correction` for offset translation and SHALL be the mechanism by which locator matches (authored against `clean_text`) become raw offsets for mutation.

#### Scenario: leading trim is mapped
- **GIVEN** a paragraph whose raw text has leading whitespace that `clean_text` trims
- **WHEN** a clean_text offset is translated
- **THEN** the resulting raw offset SHALL include the trimmed leading length

#### Scenario: stripped list label is mapped
- **GIVEN** a paragraph with a manual list label stripped from `clean_text`
- **WHEN** a clean_text offset is translated
- **THEN** the raw offset SHALL include the stripped-label length

#### Scenario: identity when clean equals raw
- **GIVEN** a paragraph whose `clean_text` equals its raw text
- **WHEN** any offset is translated
- **THEN** the raw offset SHALL equal the clean offset

### Requirement: Populated Free buildDocumentView
The free `buildDocumentView(params)` export SHALL return populated nodes equivalent to `DocxDocument.buildDocumentView()`, by sharing a common pure core. The previous behavior of returning an empty `nodes` array SHALL be removed. Both the method and the free function SHALL include only paragraphs carrying a `_bk_*` bookmark id, and neither SHALL insert bookmarks.

#### Scenario: free function returns populated nodes
- **GIVEN** a parsed document XML whose paragraphs carry `_bk_*` bookmark ids
- **WHEN** the free `buildDocumentView(params)` is called
- **THEN** it SHALL return one node per bookmarked paragraph (not an empty array)

#### Scenario: free function matches the method
- **GIVEN** the same bookmarked document loaded via `DocxDocument`
- **WHEN** both the free function and `DocxDocument.buildDocumentView()` run with equivalent options
- **THEN** their node lists SHALL be equivalent
