## 1. Spec

- [x] 1.1 Add the `Pull Word edits on a create output back into its creation
      source` requirement with scenarios `SDX-MDOC-PULL-01`–`-06`.

## 2. Implementation

- [x] 2.1 Record the source node of each projected paragraph in the lowering,
      and run offsets and simple fields in the read-back (`create/lower.ts`,
      `create/readback.ts`).
- [x] 2.2 Read an edited DOCX: paragraphs with character and paragraph
      formatting, stories per section, page setup, styles, tracked changes,
      comments and unsupported content (`create/pull-docx.ts`).
- [x] 2.3 Map each projected paragraph to its source: text pieces with raw
      offsets, the containers that hold them, and the generated text around
      them (`create/pull-source.ts`).
- [x] 2.4 Pair paragraphs, diff them word by word, plan each change against
      the source, verify each one, map headers and footers to running-text
      keys, and check the rebuild against the edited DOCX (`create/pull.ts`).
- [x] 2.5 The `pull` subcommand, its help and exit codes, and the pull record
      (`create/cli-pull.ts`, `cli-run.ts`, `cli-help.ts`).
- [x] 2.6 Accept a pulled DOCX in `create --replace` when the record binds it
      to the source being built (`create/cli-create.ts`).
- [x] 2.7 Document `pull` in the README.

## 3. Verification

- [x] 3.1 A mutation harness over a created letter: each edit reported at its
      source line, each expressible edit rebuilt to the edited body and
      running text with the markup kept, each other edit diagnosed, and
      negative controls that fail the harness when an edit, a line or a
      diagnostic goes missing.
- [x] 3.2 CLI: exit codes 0, 2 and 1, `--apply` writing a new file only,
      refusals, and the `create --replace` record handshake.
