# Change: Keep-with-next and keep-lines flags on created paragraph layout

## Why
`create` sets `w:keepNext` itself only on the paragraph before a legend or a
first signer. An author has no way to keep a caption line ("If to the Buyer:")
or a run-in heading paragraph with the paragraph after it, so Word and
LibreOffice can leave the caption alone at the bottom of a page (issue #1496).

## What Changes
- `{% paragraph-layout %}` admits two flags, `keep-with-next=true` and
  `keep-lines=true`, written as `w:keepNext` and `w:keepLines` in the
  paragraph's own `w:pPr`, in schema order.
- The flags combine with the keep-with-next `create` sets before a legend or a
  first signer: the paragraph gets one `w:keepNext`.
- The read-back and the round trip check the flags as part of each
  paragraph's layout; `pull` writes them back on a retyped paragraph.

## Impact
- Affected specs: docx-markdoc
- Affected code: `packages/docx-markdoc/src/create/{validate,theme,lower,readback,oracle,create,pull}.ts`, `cli-help.ts`, README
