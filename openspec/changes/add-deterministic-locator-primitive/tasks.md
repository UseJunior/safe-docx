## 1. docx-core: buildDocumentView shared core
- [x] 1.1 Extract the populated per-paragraph view logic from `DocxDocument.buildDocumentView()` (document.ts) into a shared pure helper in `document_view.ts`
- [x] 1.2 Have both `DocxDocument.buildDocumentView()` and the free `buildDocumentView(params)` (document_view.ts) delegate to the shared helper
- [x] 1.3 Add a test asserting the free `buildDocumentView` returns populated nodes (one per bookmarked paragraph) and matches the method output; confirm neither inserts bookmarks

## 2. docx-core: clean_text → raw offset map
- [x] 2.1 Add a per-node `clean_text → raw` offset-map builder in `document_view.ts` covering the actual `clean_text` transforms: leading/trailing trim, CR/LF removal, and manual-list-label stripping (NOT internal whitespace collapse — `clean_text` does not collapse it)
- [x] 2.2 Expose a `cleanToRawOffset(node, cleanOffset)` translation helper; generalize the scalar `visible_offset_correction` for translation
- [x] 2.3 Unit-test each transform (leading trim, CR/LF, list-label) and the identity case

## 3. docx-core: locator primitive
- [x] 3.1 Create `locator.ts` with `LocatorStep`/`Locator`/`LocatorResolution` types and `resolveLocator(view, locator)`; constrain `section` to `scope` only and `primary`/`assertions` to `regex`/`contextual`/`fingerprint` (schema/runtime validation)
- [x] 3.2 Implement `scope` (`section`) narrowing with the exactly-one-heading rule and `untilLevel` region boundary
- [x] 3.3 Implement `primary` resolution (`regex`/`contextual`/`fingerprint`) with the exactly-one-span rule (0/>1 → `unresolved`); reject zero-length `regex`/`contextual` matches as `unresolved`
- [x] 3.4 Compute `fingerprint` from the node's raw visible text (`node.raw_text`, falling back to `node.text`) via `computeContentFingerprint`; translate the matched clean_text span to raw offsets via the offset map for the returned `match`
- [x] 3.5 Implement `assertions`: span kinds (`regex`/`contextual`) compare `{nodeId,start,end}`; `fingerprint` compares `nodeId` only; report `assertionResults`
- [x] 3.6 Export `resolveLocator` and the locator types from `index.ts`

## 4. Tests and verification
- [x] 4.1 `locator.test.ts` (allure BDD-style) covers every scenario in the spec delta (exactly-one, zero, many, reproducibility, scope narrowing, repeated-heading, each step kind, assertion semantics)
- [x] 4.2 Determinism test: `resolveLocator` called twice on the same inputs returns identical results
- [x] 4.3 `npm run build` and `npm run test` pass; `npm run check:spec-coverage` maps new scenarios to tests
- [ ] 4.4 Release `@usejunior/docx-core` 0.12.0 (this is the hard prerequisite for the open-agreements consuming change)
