# `@usejunior/docx-render-verifier`

An optional independent renderer check for finished tracked DOCX paths. It has
no dependency on Safe DOCX generators, mutators, comparison engines, or IR.

`verifyRenderedMarkup` renders a disposable configured LibreOffice profile
(blue/underlined insertions, red/struck deletions) and a same-input by-author
control. It binds `pdftotext` output to caller-supplied independent markup
text, measures broad blue/red pixel bands after downsampling, and writes only
selected PDF-page PNGs to the requested output path. Required missing tools are
reported as `not_run`, not pass.

Text binding is story-scoped and pagination-aware rather than exact equality.
The extracted PDF text is split into rendered pages; on each page,
pagination-owned material is reserved first and maximally — referenced
header/footer story tokens up to their story occurrence count, and numeric
page-number renderings (values within the rendered page-number range) up to
the header/footer PAGE-family field count per page plus a whole-document
budget for body-story fields. The caller's logical projection must then be
covered by the remaining tokens, and any leftover token fails. Because
reservation is maximal, repeated header vocabulary can never substitute for
missing logical content, and duplicated or hallucinated rendered text is
never absorbed. Reading order is deliberately outside this automated verdict:
the emitted review PNGs support optional human placement review, and no
automated placement comparison is performed. The structured outcome is
reported in `verdict.textBinding` separately from colour visibility.

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
