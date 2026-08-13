# DOCX Release Verifier

`@usejunior/docx-release-verifier` independently checks finished DOCX bytes. It
does not import Safe DOCX mutation, comparison, replay, or generator packages.

Its manifest names an original DOCX, intended-clean DOCX, and tracked DOCX. The
verifier derives accept/reject text from `word/document.xml`, checks hashes and
expectations, validates the ZIP and optional native comments, and independently
computes exact emitted-redline token-LCS minimality from the finished OOXML.
A certificate records each gate as `pass`, `fail`, or `not_run`; the CLI exits
0, 1, or 3 respectively.

```sh
docx-release-verify --manifest release-manifest.json --report certificate.json
```

Generator-local replay certificates remain useful diagnostic evidence, but are
not inputs to this package and never imply delivery readiness. The independent
release certificate is the delivery verdict. When rendering is required,
`rendererEvidencePath` names the separate renderer verifier's JSON verdict; the
release verifier checks that it is bound to the exact tracked-document hash.
