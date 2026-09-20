## 1. Lean ZIP classification and validation

- [ ] 1.1 Make safe-name validation directory-aware only for one terminal slash,
  then classify every central record from that slash, the DOS directory bit,
  and recognized Unix file type; accept only unambiguous regular-file or
  directory identities and continue rejecting every other empty segment plus
  symlink/special types.
- [ ] 1.2 Admit a directory record only when its central metadata uses stored
  method `0` with zero CRC-32, compressed size, and expanded size, and its local
  header agrees on raw name, flags, method, CRC, and sizes with a zero-byte
  payload.
- [ ] 1.3 Retain directories through entry/name limits, exact-name duplicate
  checks, central/local validation, complete-local-span bounds, and overlap
  checks; then omit them from the trusted OPC part inventory.
- [ ] 1.4 Compute collision identity by removing exactly one trailing slash
  from a validated directory name and reject every regular-file/directory
  identity collision before inventory projection.

## 2. Certificate and regression evidence

- [ ] 2.1 Add focused compiled Lean fixtures for accepted DOS-only,
  Unix-only, and consistently dual-marked empty directories.
- [ ] 2.2 Add compiled adversarial fixtures for slash/attribute ambiguity,
  contradictory Unix/DOS type signals, non-stored method, nonzero CRC or size,
  central/local mismatch, payload, exact duplicate, file/directory collision,
  span overlap, and archive-limit charging.
- [ ] 2.3 Add a compiled public-certificate regression using the Word-authored
  package that previously returned `not_run`; prove directory records are
  absent from package-part evidence while ordinary selected parts still
  determine `passed` or `failed`.
- [ ] 2.4 Preserve process-level `not_run` for every rejected directory record
  and verify that no partial v4/v6 or public passing evidence is published.

## 3. Policy and conformance documentation

- [ ] 3.1 Update the Lean checker coverage ledger and verifier/Tier 2
  documentation with the exact accepted directory subset, collision policy,
  trusted-inventory omission, archive charging, and certificate boundary.
- [ ] 3.2 Keep directory-record acceptance labeled as bounded SafeDocX verifier
  policy; add no OPC-completeness or ECMA-376 citation.
- [ ] 3.3 Regenerate conformance documentation and update coverage drift checks
  that currently require unconditional directory rejection.

## 4. Acceptance checks

- [ ] 4.1 Run `openspec validate accept-safe-opc-directory-records --strict`.
- [ ] 4.2 Run `cd verification/lean && lake build`, the normalized axiom audit,
  and the zero-`sorry` audit.
- [ ] 4.3 Run focused compiled verifier and public-certificate regression tests.
- [ ] 4.4 Run `npm run check:lean-xml-checker-coverage`,
  `npm run check:spec-coverage`, `npm run check:conformance-citations`, and
  `npm run check:conformance-doc`.
- [ ] 4.5 Run the repository pre-submit command from `CONTRIBUTING.md`.
