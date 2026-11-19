## 1. Grammar and rendering

- [x] 1.1 Render `{% u %}` in the markdocx engine and carry `underline` in
      `InlineStyle`, the default preset and the creation theme
      (`SDX-MDOC-UNDERLINE-01`, `-04`).
- [x] 1.2 Admit `{% u %}` in the closed creation grammar, with no attributes,
      nesting with bold, italic, fill-ins and literal text (`-02`).
- [x] 1.3 Fail closed on an empty tag, attributes, block placement and inline
      `<u>` HTML (`-03`).

## 2. Verification

- [x] 2.1 Treat `{% u %}` as inline text in the round-trip oracle, so a
      paragraph holding only an underlined term passes verification (`-02`).

## 3. Documentation and validation

- [x] 3.1 Document `{% u %}` in the docx-markdoc README and the changelog.
- [x] 3.2 Run focused package tests, `openspec validate --strict` and the
      repository pre-submit chain.
