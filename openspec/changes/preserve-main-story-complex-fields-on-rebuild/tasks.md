## 1. Neutral scenario and specification

- [ ] 1.1 Add and independently review a docx-platform-tests scenario for a
  complete unchanged complex field with a same-paragraph outside edit.
- [ ] 1.2 Pin the reviewed neutral-suite commit and record registry hashes.
- [ ] 1.3 Validate this OpenSpec proposal and delta requirements.
- [ ] 1.4 Confirm and cite the existing ECMA-376 edition 5 complex-field and
  PAGE/NUMPAGES/REF/PAGEREF instruction sections; label exact preservation as a
  SafeDocX metamorphic invariant.

## 2. Shared fixtures and interval model

- [ ] 2.1 Add REF instruction and complete-field constants to
  `packages/docx-core/src/testing/ooxml-fixtures.ts`.
- [ ] 2.2 Add the process-local field interval descriptor with paragraph,
  container, ordinal, fingerprint, cloned nodes, atom ownership, and namespace
  context.
- [ ] 2.3 Detect complete, non-nested, same-paragraph PAGE, NUMPAGES, REF, and
  PAGEREF candidates in the main story.

## 3. Counterpart binding and rebuild emission

- [ ] 3.1 Bind exact original/revised counterparts and reject ambiguous
  occurrence, ownership, movement, boundary crossing, or mutation.
- [ ] 3.2 Preserve existing field insert/delete/modify behavior outside the
  exact-passthrough path.
- [ ] 3.3 Emit each validated sequence once in paragraph order while retaining
  tracked edits before and after it.
- [ ] 3.4 Run mandatory field, revision, namespace/MCE, schema, and
  accept/reject postconditions.

## 4. Focused and real-document evidence

- [ ] 4.1 Add shared-fixture forced-rebuild tests for every supported
  instruction, prefix/suffix edits, split instruction/result runs, multiple
  sibling fields, run properties, contained markers, and namespace context.
- [ ] 4.2 Add negative tests for nested/paragraph-spanning fields, mixed
  ownership, reordered/missing counterparts, mutation, crossed ranges, and
  non-contiguous atoms.
- [ ] 4.3 Measure before/after field counts and structural fingerprints on real
  field-bearing repository DOCX files; label the exact field types/stories
  actually present without overclaiming.

## 5. Neutral projection and verification

- [ ] 5.1 Run the reviewed neutral field scenario through the SafeDocX adapter.
- [ ] 5.2 Reconcile and regenerate the capability projection while keeping
  neutral and forced-rebuild evidence separate.
- [ ] 5.3 Run focused tests, real-package/LibreOffice smoke where available,
  and every mandatory repository pre-submit gate.
- [ ] 5.4 Review the diff for bounded scope and commit with `Ref: #582`.
