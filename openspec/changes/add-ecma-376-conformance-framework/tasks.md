# Tasks: add-ecma-376-conformance-framework

## 1. Scaffolding
- [x] Create `spec-compliance/{README.md,AGENTS.md}` and the registry directory.
- [x] Vendor ECMA-376 5th-edition XSDs (Strict + Transitional + OPC) and informative RELAX NG schemas into `spec-compliance/ecma-376/schemas/`.
- [x] Write `spec-compliance/ecma-376/COPYRIGHT.txt` preserving the Ecma International notice.
- [x] Write `spec-compliance/ecma-376/README.md` documenting edition, source archives, normative-vs-informative split.

## 2. Registry
- [x] Author `spec-compliance/registry/ecma-376.md` with three seed entries:
  - [x] `[ECMA-PART4-17-16-5]` — `wml.xsd#element:delInstrText` verified at line 1750.
  - [x] `[ECMA-PART1-17-13-5]` — `wml.xsd#element:pPrChange` verified at line 1093.
  - [x] `[ECMA-PART1-17-11]` — `wml.xsd#element:footnoteReference` verified at line 1772.
- [x] Add `## Non-Goals` heading section (empty body for phase 1; framework
      treats Non-Goal IDs as first-class).

## 3. OpenSpec change directory
- [x] Author `proposal.md`, `tasks.md` (this file), `design.md`.
- [x] Author delta spec at `specs/spec-compliance/spec.md`.
- [ ] `openspec validate add-ecma-376-conformance-framework --strict` passes.

## 4. Allure helper
- [ ] Add `.conformance({ spec, edition, part, section })` to
      `packages/allure-test-factory/src/index.js`. Mirror the `.openspec(…)`
      hook pattern (`wrapped.conformance`, `mergeAllureDefaults`).
- [ ] Emit `label('conformance', 'ECMA-376/edition-5/part-4/17.16.5')`.
      Do **not** overload `story`.
- [ ] Add type signatures to `packages/allure-test-factory/src/index.d.ts`
      (or the equivalent typing surface).

## 5. Citation-hygiene lint
- [ ] `scripts/check_conformance_citations.mjs` (new). Use
      `@typescript-eslint/parser` (already in root devDeps). Document the
      AST-vs-regex departure inline.
- [ ] Parse registry once at startup; build index of legal `[ECMA-…]` IDs
      and Non-Goal IDs.
- [ ] Parse vendored XSDs via `fast-xml-parser`; index
      `xsd:complexType[@name]`, `xsd:simpleType[@name]`,
      `xsd:element[@name]`, `xsd:attribute[@name]`. Accept both `xsd:` and
      `xs:` namespace prefixes.
- [ ] Enforce the five rules from `spec-compliance/AGENTS.md`:
  - [ ] Tag grammar resolves to a known section ID.
  - [ ] Scoped hygiene check (top-level decl JSDoc + file-leading JSDoc;
        exclude tests, docs, verification, SUPPORT.md, change/spec
        directories).
  - [ ] No `#NNN` in `@conformance` tag values.
  - [ ] Tests mentioning "ECMA-376" must carry `.conformance(…)` label.
  - [ ] No annotation may point at a Non-Goal section.
- [ ] Verify every `schemaRef:` in the registry resolves.

## 6. Generator + drift gate
- [ ] `scripts/generate_conformance_doc.mjs` (new). Reads
      `spec-compliance/registry/*.md`, writes:
  - [ ] `spec-compliance/CONFORMANCE.md` (full doc, includes section table
        with `verifiedBy:` column).
  - [ ] Replaces the `<!-- AUTO-GENERATED:conformance-summary START -->` …
        `END` block in the canonical `README.md`. Localized READMEs
        (`README.es.md`, `README.zh.md`, `README.pt-br.md`, `README.de.md`)
        carry hand-translated static content and are not touched by the
        generator (see Task 8 below for the rationale).
- [ ] `scripts/check_conformance_doc.mjs` (new) — runs the generator then
      `git diff --exit-code` on both files. Mirrors the
      `check:tool-docs` / `check:trust-metrics` package-script pattern.

## 7. CI wiring
- [ ] Add `check:conformance-citations` and `check:conformance-doc` to root
      `package.json` scripts.
- [ ] Wire both into `preflight:ci` alongside existing checks.
- [ ] Update root `AGENTS.md` mandated pre-submit chain to append both.

## 8. Advertise from root
- [ ] Update `AGENTS.md` (root) with `## ECMA-376 conformance` section
      pointing at `spec-compliance/CONFORMANCE.md`, the registry, and
      `spec-compliance/AGENTS.md`.
- [ ] Add `## Standards Conformance` section to `README.md` (between
      `## Positioning` and `## Trusted By`) containing the
      `<!-- AUTO-GENERATED:conformance-summary -->` marker block.
- [ ] Localized READMEs (`README.es.md`, `README.zh.md`, `README.pt-br.md`,
      `README.de.md`) carry a **hand-translated static block** with a
      localized link to `spec-compliance/CONFORMANCE.md`. They do **not**
      receive the dynamic `<!-- AUTO-GENERATED:conformance-summary -->`
      marker block, and the drift gate does **not** verify them. Rationale:
      injecting English content into the middle of a translated file
      violates the localization contract and risks translators silently
      breaking the AUTO-GENERATED markers (round-2 peer-review decision
      on #230; see also #233).

## 9. Annotate seeds
- [ ] `packages/docx-core/src/baselines/atomizer/pipeline.ts:418` — add
      `@conformance ECMA-376 edition 5, Part 4 § 17.16.5`.
- [ ] `packages/docx-core/src/atomizer.ts:219` — add
      `@conformance ECMA-376 edition 5, Part 1 § 17.13.5`.
- [ ] `packages/docx-core/src/footnotes.ts:6` (file-leading JSDoc) — add
      `@conformance ECMA-376 edition 5, Part 1 § 17.11`.
- [ ] `packages/docx-core/src/core-types.ts:340` — add
      `@conformance ECMA-376 edition 5, Part 1 § 17.11`.
- [ ] One test in each corresponding area gains a
      `testAllure.conformance({…})` label.

## 10. Verification
- [ ] `npm run check:conformance-citations` passes.
- [ ] `npm run check:conformance-doc` passes (regenerate, then diff is
      clean).
- [ ] `npm run preflight:ci` passes.
- [ ] `openspec validate add-ecma-376-conformance-framework --strict`
      returns "valid".
- [ ] WHATWG-style audit walkthrough: pick one row in `CONFORMANCE.md`,
      cross-reference its registry entry, click through the `schemaRef:`
      to the vendored XSD declaration, find the source `@conformance` tag,
      find the test `.conformance(…)` label. Every hop resolves without
      leaving the repo (PDF URL aside).
