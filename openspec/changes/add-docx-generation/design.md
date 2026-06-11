# Design: From-scratch DOCX generation

## Context

safe-docx's read/rewrite side already owns a canonical model (DOM Elements under the WML
namespace, parsed styles/numbering models, jszip-backed `DocxZip`). Generation must produce
packages that (a) open cleanly in Microsoft Word for Mac, Pages, Google Docs import,
LibreOffice, and headless renderers, and (b) round-trip through safe-docx's own read side
(`DocxDocument.load`, comparison, markdown export) without special cases. The issue's
anti-goal rules out cloning any third-party generator's API.

## Goals / Non-Goals

- Goal: one declarative, JSON-serializable `DocumentSpec` recipe compiled to a full OPC
  package in one pass; every emitted construct conformance-cited and structurally validated.
- Goal: the generated output is a first-class citizen of the existing pipelines (comparison,
  tracked changes, MCP read tools) — not a parallel dialect.
- Non-goal: an MCP tool surface (follow-up once the spec shape settles).
- Non-goal: a fluent builder API; recipes (`coverTermsTable`, `signatureBlock`) are pure
  `opts → spec-node` functions, keeping the spec grammar closed.
- Non-goal: ODT generation parity (tracked as a follow-up issue at completion).

## Decisions

### Declarative spec, compiled in one pass
`DocumentSpec → SectionSpec → BlockSpec (paragraph | table) → InlineSpec (text | field |
tab | break)` with document-level `StyleSpec[]`/`NumberingSpec[]`. Discriminated unions on
`kind`; explicit unit suffixes (`...Twips`, `...Pt`); no `Map`/`Date`/class instances, so
`JSON.parse(JSON.stringify(spec))` is identity. The compiler validates referential
integrity up front (`validate-spec.ts`) and **rejects** any spec feature whose emitter has
not shipped yet — never silently ignores — so each phase PR leaves a sound public surface.

### DOM construction and serialization
Each part starts from a one-line namespace-declaring skeleton parsed with xmldom, then is
built exclusively with `createWmlElement`/`createWmlTextElement` (namespace-safe, emits
`xml:space="preserve"`). xmldom's serializer omits the XML declaration, so every part
prepends it; a structural check asserts all parts begin with `<?xml`. The compiler builds
the zip-file record with `[Content_Types].xml` first (`createZipBuffer` preserves insertion
order but does not enforce ordering itself).

### Property-order discipline
Single mechanism: ordered local-name tables (`PPR_ORDER`, `RPR_ORDER`, `SECTPR_ORDER`,
`TBLPR_ORDER`, `TCPR_ORDER`) plus `appendInOrder()`, which throws on a property name absent
from its table — adding a property forces a conscious ordering decision. A unit test
cross-checks each table's relative order against the vendored transitional `wml.xsd`.

### Sections
Non-final sections end with a dedicated break paragraph whose `pPr` contains only that
section's `sectPr` (what Word itself emits; sidesteps the trailing-table case); the final
section's `sectPr` is the last child of `w:body`. Cover-page → body is primarily one
section + `first` header/footer + `w:titlePg`; explicit two-section references are the
documented fallback because header inheritance is the likeliest cross-reader divergence.

### Fields
`FieldSpec` compiles to `fldChar begin → instrText (xml:space="preserve") → separate →
cached result run → end`, matching the established `completeField()` fixture shape.
`cachedResult` is a required property — the no-recovery-dialog guarantee is
unrepresentable-by-omission. `w:dirty` is never set.

### Drafting notes
OOXML comments (`w:comment` part + range anchors), not `w:vanish` (leaks into the text
layer; Google Docs shows hidden text) and not `w:sdt` (Google Docs unwraps, Pages drops).
Separability is two-fold: compiling with `includeDraftingNotes: false` produces zero
comment parts and a byte-identical body text layer; post-hoc stripping reuses the shipped
`deleteComment` machinery. Open sub-decisions resolved in the drafting-notes phase:
ancillary parts (commentsExtended/people) default ON until the manual matrix proves
plain-comments-only safe; the content-type discrepancy between `comments.ts`
(`vnd.openxmlformats-officedocument...`) and the synthetic fixture (`vnd.ms-word...`) is
resolved against a Word-authored document. All comment ids/dates are deterministic, derived
from `CompileContext` counters and spec-provided ISO dates — generation never reads the
clock or randomness, so identical specs produce identical bytes.

### Validation layers
1. spec validation; 2. per-emitter XML assertions (namespaces, order, `xml:space`);
3. structural checks on the built package: `auditSectPr` (as one component — it allows zero
body-level sectPr, so generation adds a required-final-sectPr check), field pairing across
all story parts, package closure (rels targets resolved relative to the owning part,
`TargetMode="External"` skipped, content-type coverage, r:id resolution), table grid
arithmetic, trailing `w:p` in cells; 4. round-trip through `DocxDocument.load` +
`validateDocument()` with zero warnings + re-serialize idempotence + `compareDocuments`
smoke; 5. local-only LibreOffice probes (full-package identity load→save and
`--convert-to pdf`) via a separate helper with its own result type — the existing
`runLibreOfficeOracle()` contract (main-XML `string[]`) is not overloaded; 6. recorded
manual matrix (Word for Mac, Pages, Google Docs) per artifact in
`packages/docx-core/docs/generation-manual-compat-checklist.md`.

### Coverage validator strictness phasing
`validate_generation_openspec_coverage.mjs` discovers `specs/docx-generation/` deltas,
scans `src/generation/` + `src/integration/` (not the primitives roots), and supports
`--report-only`. It is wired into the root `check:spec-coverage` chain without `--strict`
during the phased rollout; the final phase flips its own explicit invocation to strict.
Positional `--strict` forwarding through npm chains is never relied upon (it reaches only
the last command).

## Risks / Trade-offs

- ECMA-376 section numbers must be verified against the vendored spec/XSDs before registry
  entries are added; the citation gate parses the exact grammar.
- LibreOffice probes are local-only (no soffice in CI); the structural checks are the
  CI-enforceable proxy for "opens cleanly".
- Freezing the scenario list up front risks churn in later phases; amendments ride in the
  same PR as the code they describe while the validator is report-only.
