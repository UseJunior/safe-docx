# Oracle probe: can LibreOffice adjudicate row-level revisions?

Recorded so the claim in `proposal.md` (`## Out of scope`) is reproducible rather than asserted.
Run from the worktree root with `npx tsx`, in a **real terminal** — `soffice` aborts (SIGABRT) under a
sandboxed shell, which is a known environment limitation, not a regression.

## Probe

```ts
import { resolveSoffice, runLibreOfficeOracle } from './packages/docx-core/src/integration/libreoffice-oracle.js';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Row 1 carries the row-level marker AND a content deletion inside its cell.
// The content deletion is the POSITIVE CONTROL: if LibreOffice resolves it but
// leaves the row marker alone, LO imported content revisions and ignored the row one.
const doc = (marker: 'ins' | 'del') =>
  `<w:document xmlns:w="${W}"><w:body><w:tbl>`
  + `<w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>`
  + `<w:tr><w:trPr><w:${marker} w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/></w:trPr>`
  + `<w:tc><w:tcPr/><w:p><w:r><w:t>ROWMARKED</w:t></w:r>`
  + `<w:del w:id="9" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">`
  + `<w:r><w:delText>CONTENTDEL</w:delText></w:r></w:del></w:p></w:tc></w:tr>`
  + `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>CONTROLROW</w:t></w:r></w:p></w:tc></w:tr>`
  + `</w:tbl><w:p><w:r><w:t>TAIL</w:t></w:r></w:p></w:body></w:document>`;

const out = await runLibreOfficeOracle([
  { op: 'identity', documentXml: doc('del') },
  { op: 'identity', documentXml: doc('ins') },
  { op: 'accept',   documentXml: doc('del') },
  { op: 'reject',   documentXml: doc('ins') },
], resolveSoffice()!);
// then report, per result: w:tr count, ROWMARKED/CONTROLROW/CONTENTDEL presence, and the trPr block
```

## Captured output (2026-08-14, LibreOffice via `/opt/homebrew/bin/soffice`)

```text
--- IDENTITY (load+save) with trPr>del  — does LO preserve the row marker at all?
  rows: 2 | ROWMARKED: true | CONTROLROW: true
  CONTENTDEL text present: true | any w:del elem: true | any w:ins elem: false
  trPr block: <w:trPr></w:trPr>

--- IDENTITY (load+save) with trPr>ins  — same question
  rows: 2 | ROWMARKED: true | CONTROLROW: true
  CONTENTDEL text present: true | any w:del elem: true | any w:ins elem: false
  trPr block: <w:trPr></w:trPr>

--- ACCEPT over trPr>del
  rows: 2 | ROWMARKED: true | CONTROLROW: true
  CONTENTDEL text present: false | any w:del elem: false | any w:ins elem: false
  trPr block: <w:trPr></w:trPr>

--- REJECT over trPr>ins
  rows: 2 | ROWMARKED: true | CONTROLROW: true
  CONTENTDEL text present: true | any w:del elem: false | any w:ins elem: false
  trPr block: <w:trPr></w:trPr>
```

## Reading

The `identity` jobs perform no accept or reject, and they already emit `<w:trPr></w:trPr>`. **The row-level
marker is discarded on IMPORT**, before any operation runs. Every accept/reject result below it is therefore
vacuous — "row kept" is what a document carrying no row revision at all would produce.

The positive control separates "LibreOffice cannot read this" from "the fixture or harness is broken": the
content deletion in the same cell round-trips through import, is removed by `accept` (`CONTENTDEL` gone) and
restored by `reject` (`CONTENTDEL` present, wrapper gone). So the package loads, the table loads, and the
revision machinery runs — only the row-level marker fails to survive.

## Consequence

LibreOffice cannot adjudicate this class of revision, so it cannot confirm or refute the four-direction
asymmetry. The asymmetry rests instead on the vendored strict and transitional schemas (`CT_TrPr` admits only
`ins`/`del`/`trPrChange`; `CT_TrPrBase` admits no revision children) plus the classification already encoded in
`cli/conformance-adapter.ts`. That is sufficient warrant for preserving evidence we cannot resolve, and it is
NOT sufficient to implement the row semantics — which is why implementation stays out of scope.

Microsoft Word for Mac via AppleScript was attempted next as the canonical oracle. `open file name` left Word
on its start screen and no fixture was rewritten; abandoned rather than pursued. A follow-up implementing the
semantics must obtain a real Word projection first.
