# Change: Add verified comparisons to the Safe DOCX CLI

## Why

`safe-docx compare` currently runs reconstruction safety checks but does not
expose the compiled Lean verifier, so CLI users cannot request or retain a
document-integrity certificate. The verifier also rejects harmless zero-byte
ZIP directory placeholders emitted by common DOCX tooling, and its documented
timeout does not match its implementation.

## What Changes

- Add an explicit `--verify` mode to `safe-docx compare`.
- Include the public document-integrity certificate in CLI JSON and optionally
  write it to a caller-selected JSON file.
- Fail closed without publishing a redline when requested verification does not
  return `passed`.
- Use a consistent 10-second verifier timeout by default.
- Admit unambiguous, zero-byte ZIP directory placeholders into the trusted
  package inventory while continuing to forbid them as selected XML parts.
- Add public NVCA-derived end-to-end evidence that verified comparison completes
  within 10 seconds on the supported test environment.

## Impact

- Affected specs: `docx-comparison`
- Affected code: CLI comparison parsing and command execution, verifier option
  defaults, Lean ZIP inventory parsing and typed semantics, tests, and CLI help
- Tracking: GitHub issue #775
- Privacy: only committed public or sanitized fixtures are permitted

