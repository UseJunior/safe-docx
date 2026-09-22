## 1. Proposal and contract

- [x] 1.1 Validate this OpenSpec change in strict mode.
- [x] 1.2 Obtain dynamic peer review and merge the approval PR before implementation.

## 2. Canonical parsing and validation

- [x] 2.1 Add the tag-free greenfield body parser and stable diagnostics.
- [x] 2.2 Add the plain-data style-profile and certificate types.
- [x] 2.3 Validate used style IDs against the template style table.
- [x] 2.4 Add or expose a shared plain-text OOXML run emitter with escaping and `xml:space` coverage.

## 3. Template projection

- [x] 3.1 Admit only the bounded one-section, revision-free template topology.
- [x] 3.2 Replace direct body content while retaining the final section properties.
- [x] 3.3 Emit escaped styled paragraphs from canonical headings and paragraphs.
- [x] 3.4 Add a deterministic archive replacement option that pins the new `word/document.xml` entry date.

## 4. Certification and output

- [x] 4.1 Bind canonical, template, optional profile, and output hashes.
- [x] 4.2 Verify body/style projection, unchanged OPC parts, and story bindings.
- [x] 4.3 Add the library export and transactional `compile-greenfield` CLI output.
- [x] 4.4 Preflight every input/output collision in addition to exclusive output creation.

## 5. Evidence and documentation

- [x] 5.1 Add positive public synthetic coverage and unsupported-syntax/topology controls, including proof that clone/clear/style/footer preservation no longer needs custom OOXML when the template already supplies its running stories.
- [x] 5.2 Add a real OpenAgreements template-backed end-to-end regression.
- [x] 5.3 Document the command, grammar, certificate, and phase-one limits.
- [x] 5.4 Run package and repository pre-submit gates.
- [x] 5.5 Tag every scenario test with the change feature label and single-line OpenSpec mapping.
- [x] 5.6 Dry-run archive ordering against the other active `docx-markdoc` deltas and inspect requirement totals.
- [x] 5.7 Mark every task complete only after the implementation and evidence land.
