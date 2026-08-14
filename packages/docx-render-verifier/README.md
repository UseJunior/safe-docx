# `@usejunior/docx-render-verifier`

An optional independent renderer check for finished tracked DOCX paths. It has
no dependency on Safe DOCX generators, mutators, comparison engines, or IR.

`verifyRenderedMarkup` renders a disposable configured LibreOffice profile
(blue/underlined insertions, red/struck deletions) and a same-input by-author
control. It binds `pdftotext` output to caller-supplied independent markup
text, measures broad blue/red pixel bands after downsampling, and writes only
selected PDF-page PNGs to the requested output path. Required missing tools are
reported as `not_run`, not pass.

Text binding is story-scoped and pagination-aware rather than exact equality:
every token of the caller's logical projection must appear in the PDF text at
least as often as in the projection, and every extra PDF token must be
attributable to renderer-created pagination artifacts with explicit occurrence
bounds — referenced header/footer story tokens up to `pageCount x` their story
occurrence, and numeric page-number residue only when a PAGE-family field
exists, capped at `pageCount x` the field count. Missing logical content or
unattributable residue still fails; reading order is deliberately left to the
image-review domain. The structured outcome is reported in
`verdict.textBinding` separately from colour visibility.

If Writer displays configured insertions but suppresses deletions, verification
fails with `revisionVisibility: "hidden-deletions"` rather than reporting only
a generic colour-contrast failure. A text-binding failure keeps
`revisionVisibility` truthful to the pixel and revision-markup evidence; it is
never relabelled `insufficient-contrast`.

An optional render transform receives only a copied input and a disposable
workspace. The verifier hashes the authoritative DOCX before and after and
rejects any transform that changes it or returns a path outside the workspace.
Transforms and their input/output hashes are retained in the verdict.

The private corpus runner accepts a local gitignored manifest; see
`private-corpus/README.md`. It refuses tracked manifests and output paths and
never emits artifact text in its summary.
