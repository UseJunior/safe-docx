# Change: Add Declarative Markdoc Compilation Profiles

## Why

Brownfield Markdoc makes edit operations replayable, but the identity and policy
that produce a fully attributed Word redline currently live outside the canonical
revision in TypeScript options. That means an `.mjs` wrapper or ephemeral shell
state is still required to reproduce external rationale comments. Internal
rationales also need an intentionally difficult export path so an agent cannot
casually disclose them to a counterparty.

## What Changes

- Add one optional, singleton compilation-profile tag to canonical Markdoc for
  tracked-revision identity, comment identity, an optional pinned build time,
  and the default external-comment rendering policy.
- Make rationale visibility required and explicit as `internal` or
  `external-facing`; this is a clean syntax break with no compatibility window.
- Render present external-facing rationales by default, while allowing one
  complete CLI rendering override to suppress them.
- Keep validation mandatory inside compile while retaining standalone `validate`
  as a no-output lint/editor/CI surface.
- Add the exact `--dangerously-include-internal-comments` CLI-only opt-in. It
  cannot be activated by Markdoc content.
- Require a distinct explicit internal output path, force the complete
  `INTERNAL COMMENTS INCLUDED` filename suffix under platform-safe length limits,
  and disclose the mode in CLI and certificate output.
- Document and test the complete no-JavaScript import-to-redline workflow.
- Warn when external-facing rationales are present but intentionally suppressed,
  and never warn merely because internal rationales remain excluded.

## Impact

- Affected specs: `docx-markdoc`.
- Affected code: Markdoc schema/parser/IR, compiler option resolution,
  verification certificate, CLI, filename policy, README, and package tests.
- Compatibility: deliberate clean break for rationale visibility. Existing
  private drafts must add `visibility="internal"`; external drafts must use
  `visibility="external-facing"`. Users needing legacy syntax can pin an older
  package version.
- Security: external materialization remains fail-closed; internal materialization
  requires an alarming runtime capability that document content cannot grant.
- Related issues: #882 and #883. Structured evidence sources remain #884 and are
  outside this change.
