# Design: Centralize the LLM quality gate behind a GitHub App

## Context

The current LLM quality gate is a GitHub Actions workflow plus composite action
copied across four consumers. In safe-docx, the workflow is 747 lines and the
action is 426 lines, with policy under `.github/llm-based-quality-gate/`.
Because the implementation is copied, every security, reliability, provider, or
review-output fix has to be re-landed in each repo.

The desired sharing mechanism must work across both private repos and a public
repo in a different organization. Private reusable workflows and composite
actions cannot cover that shape uniformly, and opening the engine source is not
a goal. The viable common mechanism is a dedicated GitHub App plus a central
runner: the consumer emits a normalized request, the master repo evaluates the
trusted base policy and untrusted PR diff, then the App posts a Check Run and PR
comment back to the consumer.

Branch protection is the highest-stakes migration constraint. Verified on
2026-07-08 via `gh api repos/<owner>/<repo>/branches/main/protection/required_status_checks`:

| Repo | Current `Aggregate and post review` protection |
| --- | --- |
| `UseJunior/safe-docx` | Required, source-pinned to app id `15368` (GitHub Actions) |
| `open-agreements/open-agreements` | Required, source-pinned to app id `15368` (GitHub Actions) |
| `UseJunior/tests-renderer` | Required, source-pinned to app id `15368` (GitHub Actions) |
| `UseJunior/legal-explainer` | Not currently required |

A Check Run with the same name from the new LLM-Gate App will not satisfy a
source-pinned requirement until branch protection is re-pointed to that App (or
to any source). Re-pointing must happen only after the new App has posted a live
check on that repo, or merges can be wedged.

## Goals / Non-Goals

**Goals**
- Make `UseJunior/llm-gate` the single source of gate implementation logic.
- Keep repo-specific review policy in each consumer repo and read it only from
  the trusted base ref.
- Preserve current gate behavior before enforcing the new source.
- Cut over all four consumers through shadow/advisory operation before
  removing the copied engine.
- Support both GitHub-hosted execution now and a webhook/local-model transport
  later without changing the engine.
- Support Gemini now and an OpenAI-compatible local provider later without
  changing the engine core.

**Non-Goals**
- This proposal does not create the private master repo, register the GitHub
  App, edit branch protection, or add secrets.
- This proposal does not implement the engine CLI, router, webhook receiver, or
  consumer dispatch workflows.
- This proposal does not make the LLM gate blocking by default.
- This proposal does not expose the gate engine as a public reusable workflow or
  public composite action.

## Decisions

### Four independently maintainable layers

| Layer | Lives in | Changes when |
| --- | --- | --- |
| Policy | Each consumer repo: `checklist.md`, current `system-prompt.md` or future overlay, `LLM_GATE_BLOCKING` | That repo's review criteria change |
| Transport | Master router workflow in v1, webhook stub in v2 | A repo switches between GitHub-hosted and local/webhook execution |
| Engine | `UseJunior/llm-gate` TypeScript CLI | Gate logic, security, output, provider, or reliability behavior changes |
| Identity | Dedicated LLM-Gate GitHub App plus central secrets | App permissions, installations, or shared provider credentials change |

This layering is the de-duplication boundary: policy can vary per repo, but the
gate algorithm and security hardening are implemented once.

### Master repo and identity

Create a new private `UseJunior/llm-gate` repo containing:

- `src/` for the TypeScript CLI.
- `.github/workflows/router.yml` for the central router.
- `config/routes.yml` for the consumer allowlist and transport selection.
- `prompts/system-prompt.base.md` for the shared system prompt.
- Secrets `LLM_GATE_APP_ID`, `LLM_GATE_APP_PRIVATE_KEY`, and `GEMINI_API_KEY`.

The master repo must have branch protection and required review on `main`.

Create a dedicated LLM-Gate GitHub App with minimal permissions:
`Checks: write`, `Contents: read`, `Pull requests: read`, and `Metadata: read`.
Install it on all four consumers and the master repo. Store its id/private key
only in the master repo. The router mints per-run installation tokens scoped to
the single target consumer, using the same general GitHub App token pattern
already used by safe-docx release automation for RELEASE_BOT.

### Engine CLI

The current bash and workflow logic is extracted into a transport-agnostic
TypeScript CLI:

```text
llm-gate gate --request request.json --out result.json
```

The CLI parses a normalized request, reads the consumer policy from the trusted
base ref, evaluates each checklist item against the untrusted PR diff, and
emits a normalized result. The row contract must remain byte-for-byte compatible
for the cutover golden test:

```text
id, question, status, justification, attempts,
estimated_input_tokens, estimated_output_tokens, estimated_usd, model
```

`status` is `PASS | WARN | SKIPPED`. `SKIPPED` is pass-like during aggregation.
For evaluated runs with at least one row, the overall verdict is
`PASS | WARN`. The CLI must also preserve the current operational guards for
skipped/no-result runs: a legitimate package-lock-only skip stays non-blocking,
but a non-skipped run that produces zero rows fails closed when
`LLM_GATE_BLOCKING=1`.

The CLI must retain per-item failure isolation even though the current workflow
uses separate matrix jobs. Each item is wrapped in try/catch, has its own
timeout, and falls back to a determinate WARN row on failure. Internal
concurrency is bounded and backed off with `LLM_GATE_MAX_PARALLEL`, default `2`.
Timeout and rate-limit behavior must have tests.

### Provider seam

The engine calls a provider interface:

```text
GateProvider.evaluate(prompt) -> { status, justification, usage }
```

v1 ships `GeminiProvider`, wrapping the pinned Gemini CLI for behavior parity.
The future local-model path adds an `OpenAICompatProvider` that points at a
local GLM endpoint and is selected by `routes.yml`. The engine orchestration,
result aggregation, Check Run logic, and comment rendering do not change when
the provider changes.

### Transport seam

The normalized gate request is identical for workflow dispatch and webhook
execution:

```json
{
  "consumer_repo": "owner/name",
  "installation_id": 123,
  "pr_number": 123,
  "base_ref": "main",
  "base_sha": "base",
  "head_sha": "head",
  "event": "opened",
  "labels": ["label"]
}
```

The normalized gate result is also transport-independent:

```json
{
  "overall": "PASS",
  "rows": [],
  "check_run": {
    "name": "Aggregate and post review",
    "conclusion": "success",
    "summary": "..."
  },
  "comment_markdown": "..."
}
```

v1 uses a `workflow_dispatch` router in the master repo. This requires a
cross-repo credential in each consumer with `Actions: write` on the master repo.
That is narrower than `repository_dispatch`, which requires `Contents: write`
on the master and would let a compromised consumer credential push code to the
master. `workflow_dispatch` is therefore the recommended v1 trigger, provided
the master keeps the router as the only manually dispatchable workflow.

The router also supports `repository_dispatch` for compatibility, but it is not
the recommended trigger because of the `Contents: write` over-grant. v2 adds a
documented webhook transport branch that POSTs the same normalized request to a
configured URL and exits. A local receiver then runs the same CLI and posts the
same Check Run through the App.

### Router behavior

The router runs only from the master default branch. It validates the payload
against `config/routes.yml`, refuses unknown consumer repos, and never checks
out an untrusted ref. For `github-hosted` routes it:

1. Mints a GitHub App installation token scoped to the target consumer.
2. Shallow-clones or fetches the consumer at `base_sha` for policy.
3. Computes the trusted `base...head` diff using the consumer token.
4. Runs `llm-gate gate`.
5. Posts a Check Run to the consumer `head_sha`.
6. Upserts the PR comment.

The v2 `webhook` route is a stub and contract only in the first implementation.
It sends the normalized request to the route's webhook URL and does not run the
engine locally.

### Consumer workflow

Each consumer keeps:

- `.github/llm-based-quality-gate/checklist.md`.
- Today's `.github/llm-based-quality-gate/system-prompt.md`, or an optional
  `.github/llm-based-quality-gate/system-prompt.overlay.md` after the base
  prompt split is introduced.
- `LLM_GATE_BLOCKING`.
- A thin `.github/workflows/llm-gate-dispatch.yml`.

The dispatch workflow runs on `pull_request` events
`opened`, `ready_for_review`, `synchronize`, `labeled`, and `unlabeled`. It
short-circuits when the dispatch credential is unavailable and keeps an explicit
`head.repo.full_name == github.repository` guard.

The workflow must not use `pull_request_target`. GitHub does not pass consumer
repo or org secrets to fork-triggered `pull_request` workflows, so fork PRs do
not receive the cross-repo dispatch credential and cannot reach the central
engine or provider key.

Manual recovery must remain available after cutover. Maintainers can re-run the
gate by manually dispatching the master router with the normalized request for a
specific PR, and the router updates the existing PR comment on dispatch. A
consumer-local `workflow_dispatch` wrapper may also be kept if it only forwards
the normalized request and does not reintroduce engine logic.

### Security model and behavior parity

The implementation must port all current security and behavior guarantees:

- Trusted base-ref read of checklist and prompt policy.
- Same-repo/fork guard.
- `package-lock.json`-only skip.
- `synchronize` stamp mode that skips re-run when a follow-up push only touches
  `package-lock.json`.
- Per-item `paths` filters and path-scoped diffs, with `SKIPPED` for untouched
  items.
- `max-diff-bytes` truncation with the exact marker and a closed tilde fence.
- Gemini CLI pinning and `.npmrc` poisoning hardening by installing from
  `$RUNNER_TEMP` with forced-empty `NPM_CONFIG_*`, then unsetting those
  variables before running the provider binary.
- `.gemini` symlink removal.
- `GITHUB_TOKEN: ''` passed into the provider.
- `tools.core` allowlist.
- Staggering, escalating backoff, and at most three retries for malformed JSON.
- Per-item WARN fallback that always emits a row.
- Literal-key and `AIza[0-9A-Za-z_-]{35}` redaction.
- Cost estimate fields.
- `LLM_GATE_BLOCKING` plus `llm-gate/override` policy.
- PR-comment upsert behavior: update on dispatch, append on PR event.
- Fail-closed no-result behavior in blocking mode: if a non-skipped run produces
  zero rows and `LLM_GATE_BLOCKING=1`, the Check Run fails instead of passing an
  empty result.

## Risks / Trade-offs

- **Branch protection source pin can wedge merges.** Mitigation: run the new
  App in shadow/advisory mode first, verify a live Check Run exists on the repo,
  then re-point branch protection to the LLM-Gate App or any source. Verify with
  `gh api .../required_status_checks` and `gh pr view --json statusCheckRollup`.
- **A consumer dispatch credential is still sensitive.** Mitigation:
  `workflow_dispatch` with `Actions: write` is the v1 path, the master keeps only
  the router as manually dispatchable, the router is default-branch-only, and the
  v2 webhook path removes the credential entirely. `Actions: write` can also
  cancel or re-run master workflow runs, so run isolation and audit logging must
  treat consumer credentials as capable of operational disruption even though
  they cannot write master repo contents.
- **One CLI process changes the failure domain.** Mitigation: per-item
  try/catch, per-item timeout, WARN fallback, bounded concurrency, and tests for
  timeout/rate-limit paths.
- **Shadow mode temporarily duplicates checks/comments.** Mitigation: use an
  advisory check/comment name or clearly marked body during pilot, then switch
  the required status only after parity is proven.
- **Private master repo concentrates gate power.** Mitigation: branch
  protection, required review, narrow App permissions, route allowlist, no
  untrusted checkout, and central secret storage.

## Migration Plan

1. Create `UseJunior/llm-gate` as a private repo with protected `main`.
2. Register the dedicated LLM-Gate GitHub App, install it on all four consumers
   and the master, and add secrets only to the master repo.
3. Extract the engine CLI with golden-output parity tests against the existing
   safe-docx result JSON and comment/check output.
4. Build the router and run safe-docx in shadow/advisory mode.
5. After the new App has posted a live safe-docx check, re-point safe-docx
   branch protection from GitHub Actions app id `15368` to the LLM-Gate App (or
   any source), then verify status rollup behavior.
6. Cut over `open-agreements/open-agreements` and `UseJunior/tests-renderer`
   with the same shadow, verify, and re-point sequence.
7. Cut over `UseJunior/legal-explainer`; add `Aggregate and post review` as a
   required source-pinned check only if product policy wants it to gate merges.
8. Remove copied workflow/action engine files and per-repo `GEMINI_API_KEY`
   secrets from consumers after each repo is fully cut over.
9. Rollback: restore the old consumer workflow/action files and re-point
   required checks back to GitHub Actions app id `15368` for repos where the old
   source is still present.

## Open Questions

- Should the base prompt be split immediately into
  `system-prompt.base.md` plus per-consumer overlays, or should the first
  cutover preserve each repo's full current prompt and introduce overlays in a
  follow-up?
- Should `synchronize` stamp mode be kept in the first CLI port or deferred if
  golden parity shows it is lower risk to ship after the initial shadow phase?
- Should v1 `GeminiProvider` wrap the pinned Gemini CLI for maximum parity, or
  switch directly to an API call if that simplifies installation hardening?
- During shadow mode, should the central check use the final
  `Aggregate and post review` name with a neutral conclusion, or a temporary
  name to avoid confusing required-check source migration?
