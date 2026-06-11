# Change: Document odf-core ODT generation boundary

## Why
`@usejunior/docx-core` now supports from-scratch DOCX generation through `generateDocx(spec)` and a declarative `DocumentSpec`, while `@usejunior/odf-core` has no equivalent native ODT compiler. Without an explicit decision, the sister packages can appear to drift accidentally: users may expect the same `DocumentSpec` to compile directly to ODT even though the shipped ODT path is DOCX-to-ODT conversion.

## What Changes
- Record `@usejunior/odf-core` as conversion-first for near-term generation workflows: generate DOCX with `generateDocx(spec)`, then convert with `convertDocxToOdt`.
- Add a package README for `@usejunior/odf-core` that makes this boundary explicit and links native ODT generation to a future proposal rather than an implied roadmap.
- Keep `generateOdt(spec)` out of scope for this change. A future native compiler would require a separate OpenSpec proposal covering ODF schema mapping, fidelity guarantees, validation, and parity with the DOCX `DocumentSpec` compiler.

## Impact
- Affected specs: `odf-core`
- Affected code/docs: `packages/odf-core/README.md`
- Related issues: #426, #280, #401
