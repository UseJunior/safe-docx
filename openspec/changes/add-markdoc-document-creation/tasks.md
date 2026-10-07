## 1. Prerequisite

- [ ] 1.1 `add-generation-document-defaults` (#1163): document defaults and
      four-channel fonts in docx-core.

## 2. Lowering (library)

- [ ] 2.1 Frontmatter, block grammar, inline formatting and house profile →
      `DocumentSpec` (`SDX-MDOC-CREATE-01`, `-03`).
- [ ] 2.2 Fill-in detection with nesting and exemptions (`-02`).
- [ ] 2.3 Signer, legend, page-break and sections/footers (`-04`, `-05`).
- [ ] 2.4 Lists bound to numbering, and tables (`-06`, `-07`).

## 3. Verification and CLI

- [ ] 3.1 Read-back and footer projections with negative controls,
      determinism, and certificate (`-08`).
- [ ] 3.2 Brownfield import check (`-09`).
- [ ] 3.3 `create` CLI, `.txt` mirror, `--replace` / `--require-pdf`, and the
      plain PDF render export in `docx-render-verifier` (`-10`).

## 4. Benchmark and migration

- [ ] 4.1 Synthetic board-resolution benchmark against a python-docx
      renderer, scored on every axis, checked into the repo.
- [ ] 4.2 README section and a matter-seat migration note.

## 5. Verify

- [ ] 5.1 Package tests, spec coverage, conformance citations, workspace lint,
      and `openspec validate add-markdoc-document-creation --strict`.
