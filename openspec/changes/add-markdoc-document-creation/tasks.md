## 1. Prerequisite

- [ ] 1.1 `add-generation-document-defaults` (#1163): document defaults and
      four-channel fonts in docx-core.
- [ ] 1.2 `add-generation-section-break-placement` (#1166).
- [ ] 1.3 `add-markdocx-generic-engine` (#1172): the upstreamed engine.
- [ ] 1.4 Plain PDF render in docx-markdoc `src/pdf` (#1173).

## 2. Lowering (library)

- [x] 2.1 Frontmatter, block grammar, inline formatting and house profile →
      `DocumentSpec` (`SDX-MDOC-CREATE-01`, `-03`).
- [x] 2.2 Fill-in detection with nesting and exemptions (`-02`).
- [x] 2.3 Signer, legend, page-break and sections/footers (`-04`, `-05`).
- [x] 2.4 Lists bound to numbering, and tables (`-06`, `-07`).

## 3. Verification and CLI

- [x] 3.1 Read-back and footer projections with negative controls,
      determinism, and certificate (`-08`).
- [x] 3.2 Brownfield import check (`-09`).
- [x] 3.3 `create` CLI, `.txt` mirror, `--replace` / `--require-pdf`, and the
      plain PDF render in docx-markdoc `src/pdf` (`-10`).

## 4. Benchmark and migration

- [x] 4.1 Synthetic board-resolution benchmark against a python-docx
      renderer, scored on every axis, checked into the repo.
- [ ] 4.2 README section and a matter-seat migration note.

## 5. Verify

- [ ] 5.1 Package tests, spec coverage, conformance citations, workspace lint,
      and `openspec validate add-markdoc-document-creation --strict`.
