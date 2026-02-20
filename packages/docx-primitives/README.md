# @usejunior/docx-primitives

Internal(ish) OOXML primitives used by `@usejunior/safedocx`.
OpenAgreements project, built by the UseJunior team.

This package focuses on:
- `.docx` ZIP handling via `jszip`
- DOM-based parse/edit/serialize via `@xmldom/xmldom`
- bookmark-based paragraph targeting (`jr_para_*`)

## Development (Repo)

```bash
npm run build -w @usejunior/docx-primitives
```

## Publish (NPM)

```bash
npm publish -w @usejunior/docx-primitives --access public
```

If your machine has a broken npm cache ownership, add `--cache /tmp/npm-cache`.
