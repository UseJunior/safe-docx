## Context

OPC stores core properties in one Core Properties part, named by a package
relationship (ECMA-376 Part 2 §8.2). Its elements come from three namespaces:
Dublin Core (`dc:`), DCMI terms (`dcterms:created`, `dcterms:modified`), and
the core-properties namespace (`cp:`). `dcterms:created` and
`dcterms:modified` must carry `xsi:type="dcterms:W3CDTF"` with `dcterms`
declared as the prefix of the DCMI terms namespace (§8.3.4.3). Extended
properties live in the Extended File Properties part (Part 1 §22.2); each is
a non-repeatable element of `CT_Properties`, and `AppVersion` must have the
form `XX.YYYY` (§22.2.2.2). Both complex types are `xsd:all`, so element
order carries no meaning.

Word writes both parts as `docProps/core.xml` and `docProps/app.xml`, but
other producers vary: the real NVCA corpus writes `ap:Properties` with a
prefixed root, and some packages have no `docProps` parts at all.

## Goals / Non-Goals

- Goals: let a caller choose or omit the properties a reader sees, in created
  and existing documents; keep generation deterministic; change nothing in a
  part but the named elements.
- Non-Goals: custom properties, statistics, automatic save stamps, signed
  packages (see the proposal).

## Decisions

### 1. One primitive for reading and writing

`docx-core` owns one module that both the MCP tools and the `create`
read-back use. The `create` read-back stays independent of the generator:
generation writes the parts with its own emitter (`package-parts.ts`), and
the check parses the bytes with the primitive and compares with values read
straight from the source frontmatter.

### 2. Locate parts by relationship, edit element by element

Parts are found through `_rels/.rels` by relationship type (the core type,
its legacy `officedocument` spelling, and the transitional and strict
extended types), never by fixed path. A write sets the text of the named
element, creating it at the end of the root when absent, and removes it for
null. Every other element, attribute and namespace declaration is kept.
A new element reuses the root's prefix for the root namespace and an
existing declaration for others; a missing declaration is added on the root.
`dcterms` is required as the prefix for dates; a part that binds `dcterms`
elsewhere is refused rather than rewritten.

### 3. Create missing parts only when a value is set

A package without a part gets one, at `docProps/core.xml` or
`docProps/app.xml` (or a numbered name if that entry is taken), with a new
package relationship (an Id unused in `_rels/.rels`) and a content-type
override. Removing a property from a part that does not exist is a no-op.
If a relationship names a part whose entry is missing, the part is created at
that path and given an override.
A new extended part takes the strict namespace and relationship type when the
package's main document relationship is strict; core properties have one
vocabulary in both conformance classes. A rewritten part writes each carriage
return as `&#13;`, so a value read back equals the value written.

### 4. Validate everything, then write

Every name and value is validated before any part is written: non-empty
strings without characters XML cannot carry (markup characters are escaped
by the serializer), W3CDTF dates, a non-negative integer revision, a
language tag, and `XX.YYYY` for `AppVersion`. A write whose values already
hold changes nothing and reports `changed: false`.

### 5. Package mutation, not a tracked change

Document properties have no tracked-change form. `set_document_properties`
is classified `package-mutation`: an effective write is recorded in the
session's non-revision change manifest and appears in the save report. It
counts as an edit; a no-op write does not.

### 6. Creation keys

`author` already writes `dc:creator`, so no `creator` key is added. The new
keys are `modified` (same forms as `date`, not earlier than it),
`last-modified-by`, and `application` (`none` omits the element). Without
`application`, `Application` stays `safe-docx`, so existing sources build
the same bytes. The 2006 default is reported in the summary line rather than
as a warning, matching how `create` reports what it wrote.

## Risks / Trade-offs

- Appending new elements changes element order relative to Word's habit.
  `xsd:all` makes any order valid, and Word reads it.
- Keywords with per-language `cp:value` children are replaced by one text
  value when set. Reading returns the concatenated text.

## Migration Plan

Additive. Existing specs, sources and tool calls behave as before.
