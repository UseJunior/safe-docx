# Change: Centralize the LLM quality gate behind a GitHub App

## Why

The LLM-based quality gate is copied near-verbatim across four repositories:
`UseJunior/safe-docx`, `open-agreements/open-agreements`,
`UseJunior/legal-explainer`, and `UseJunior/tests-renderer`. Infrastructure
fixes therefore have to be ported four times, and the copies drift. The issue
#272 flakiness fix followed that path through safe-docx #533, open-agreements
#594, legal-explainer #1647, and tests-renderer #88.

Reusable workflows and composite actions do not solve this uniformly because
private `uses:` sharing is limited to the same organization or enterprise.
`open-agreements/open-agreements` lives in a different organization, and the
gate engine should remain private. A GitHub App plus a central runner can read a
consumer PR, evaluate it with one private implementation, and post the resulting
Check Run back to the consumer repo without copying the engine.

## What Changes

- Add a new `ci-quality-gate` capability describing a centralized LLM gate
  architecture.
- Stand up a new private master repository, `UseJunior/llm-gate`, containing the
  transport-agnostic TypeScript `llm-gate` CLI, router workflow, routes
  allowlist, and shared base prompt.
- Create a dedicated LLM-Gate GitHub App with minimal read/check permissions and
  a single centralized `GEMINI_API_KEY` held only by the master repo.
- Keep policy in each consumer repo: `checklist.md`, today's
  `system-prompt.md` or a future `system-prompt.overlay.md`, and
  `LLM_GATE_BLOCKING`.
- Replace each consumer's copied workflow/action implementation with a thin
  dispatch workflow after a shadow/advisory phase.
- Preserve the current result contract: per-row status
  `PASS | WARN | SKIPPED`, overall verdict `PASS | WARN`, advisory by default,
  and blocking only when `LLM_GATE_BLOCKING=1` and `llm-gate/override` is absent.
- **BREAKING**: remove the per-repo gate engine copies and per-repo
  `GEMINI_API_KEY` secrets after cutover.
- **BREAKING**: required branch-protection status checks that are source-pinned
  to the GitHub Actions App must be re-pointed after the new LLM-Gate App has
  posted at least one live Check Run for the repo.

## Impact

- Affected specs: new `ci-quality-gate` capability.
- Affected code:
  - New private repo: `UseJunior/llm-gate`.
  - Consumer policy and dispatch paths:
    - `UseJunior/safe-docx`: `.github/llm-based-quality-gate/`,
      `.github/workflows/llm-gate-dispatch.yml`.
    - `open-agreements/open-agreements`: `.github/llm-based-quality-gate/`,
      `.github/workflows/llm-gate-dispatch.yml`.
    - `UseJunior/legal-explainer`: `.github/llm-based-quality-gate/`,
      `.github/workflows/llm-gate-dispatch.yml`.
    - `UseJunior/tests-renderer`: `.github/llm-based-quality-gate/`,
      `.github/workflows/llm-gate-dispatch.yml`.
  - Old copied implementations removed from the consumer repos:
    `.github/workflows/llm-based-quality-gate.yml` and
    `.github/actions/llm-gate-check/action.yml` where present.
- Existing safe-docx source size to port: 747-line workflow and 426-line
  composite action, plus policy files in `.github/llm-based-quality-gate/`.
- Ref: #553.
