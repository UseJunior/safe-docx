# Change: Upstream the generic Markdoc → DocumentSpec engine

## Why

Two Markdoc-to-DOCX paths exist. legal-explainer has a private `markdocx`
package whose generic engine lowers Markdoc onto `@usejunior/docx-core`
`DocumentSpec` through plugin seams; it drives the published agreement
templates. safe-docx needs the same engine to create new instruments without a
template (#1162). Keeping two engines would split one concern across two repos.

The generic engine imports only `@markdoc/markdoc` and docx-core and has no
runtime dependency on legal-explainer. Moving it into safe-docx gives one source
of truth. legal-explainer can then consume the published package in a separate,
later change.

## What Changes

- Add `packages/docx-markdoc/src/markdocx/`, exported from the package root:
  - `engine.ts`: `createMarkdocxRenderer`, `Theme`, `BlockTagPlugin`,
    `InlineTagPlugin`, `RenderApi`, `transformBlock`;
  - `ast.ts`: Markdoc node helpers;
  - `default-theme.ts`: the default preset;
  - `render.ts`: `renderMarkdocxToDocumentSpec`, `renderMarkdocxToDocx`.
- Rendering behaviour is unchanged. `engine.ts` and `render.ts` match the
  source except for ESM import suffixes, and `default-theme.ts` adds only a
  non-null assertion for strict index checking.
- Unhandled nodes and tags now throw a typed `MarkdocxUnhandledNodeError`
  (`nodeType`, `tag`) with a generic message. The old message named the
  agreement renderer and a legal-explainer file path.
- Port the engine's tests, and pin the lenient contract the agreement adapter
  relies on:
  - links keep their text and lose the hyperlink;
  - code renders as plain text;
  - breaks become spaces;
  - fields resolve through the caller;
  - list depth is capped;
  - unknown nodes fail loudly.

## Impact

- Affected specs: `docx-markdoc` (one ADDED requirement).
- Affected code: new `packages/docx-markdoc/src/markdocx/*` and a package-root
  re-export.
- No existing safe-docx behaviour changes.
- Follow-up, not in this change: legal-explainer swaps
  `@open-agreements/markdocx` for `@usejunior/docx-markdoc` and updates its two
  tests that match the old message text.
