## 1. Move

- [x] 1.1 Copy `engine.ts`, `ast.ts`, `default-theme.ts` and `render.ts` into
      `packages/docx-markdoc/src/markdocx/` with ESM import suffixes and no
      behaviour change.
- [x] 1.2 Replace the agreement-specific unhandled-node messages with a typed
      `MarkdocxUnhandledNodeError`.
- [x] 1.3 Re-export from the package root.

## 2. Tests

- [x] 2.1 Port the four engine test files.
- [x] 2.2 Add `lenient-contract.test.ts` with
      `TEST_FEATURE = 'add-markdocx-generic-engine'` and `[SDX-MDOC-156]`.

## 3. Verify

- [ ] 3.1 Package tests, workspace lint, allure labels, strict validation.
