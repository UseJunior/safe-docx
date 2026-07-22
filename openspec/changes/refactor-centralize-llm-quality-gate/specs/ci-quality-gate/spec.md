## ADDED Requirements

### Requirement: Centralized Gate Engine

The system SHALL run LLM quality-gate logic from a single private master
implementation rather than copied workflow/action engines in each consumer repo.
Consumer repos SHALL retain only policy, configuration, and a thin dispatch
workflow after cutover.

#### Scenario: Gate logic fix ships once
- **WHEN** a gate parsing, security, provider, or aggregation fix is merged to the master `llm-gate` engine
- **THEN** all configured consumer repos use that fixed engine without re-porting the implementation into each repo

#### Scenario: Consumer keeps repo-specific policy
- **WHEN** a consumer repo changes review criteria in `checklist.md`, today's `system-prompt.md`, or a future prompt overlay
- **THEN** only that repo's policy changes and the shared engine implementation remains unchanged

### Requirement: Trusted Policy Source

The system SHALL read checklist and prompt policy only from the trusted base ref
of the consumer PR. The system MUST treat PR head content and diffs as
untrusted input and MUST NOT execute code from the untrusted head ref.

#### Scenario: Fork changes gate policy in the PR
- **WHEN** a PR modifies `.github/llm-based-quality-gate/checklist.md` on the head branch
- **THEN** the gate evaluates using the checklist from the trusted base ref, not the untrusted head version

#### Scenario: Router handles untrusted diff
- **WHEN** the router evaluates a PR from a consumer repo
- **THEN** it fetches trusted policy from `base_sha`, computes the `base...head` diff as data, and does not run scripts from the PR head

### Requirement: Untrusted Diff Boundary

The system SHALL place the PR diff in a clearly fenced untrusted section of the
provider prompt. If the diff exceeds the configured maximum size, the system
SHALL truncate it with the established marker and still close the tilde fence.

#### Scenario: Oversized diff is truncated safely
- **WHEN** a PR diff exceeds `max-diff-bytes`
- **THEN** the prompt includes the truncation marker and a closed tilde fence before any trusted instructions continue

#### Scenario: Path filter scopes item evidence
- **WHEN** a checklist item declares `paths` globs and the PR touches matching files
- **THEN** the provider prompt for that item includes only the path-scoped relevant diff

### Requirement: Fork PRs Cannot Reach Central Secrets

The system SHALL trigger consumer dispatch from `pull_request`, not
`pull_request_target`, and SHALL short-circuit when the cross-repo dispatch
credential is unavailable. The system MUST keep an explicit same-repository head
guard as defense in depth.

#### Scenario: Fork PR opens against a consumer
- **WHEN** a fork-origin PR opens against a consumer repo
- **THEN** GitHub withholds the consumer dispatch credential, the dispatch workflow does not call the master router, and the central provider key is never reachable

#### Scenario: Same-repo PR opens against a consumer
- **WHEN** a same-repository PR opens against a consumer repo and the dispatch credential is present
- **THEN** the dispatch workflow sends the normalized request to the master router

### Requirement: Normalized Gate Contracts

The system SHALL use a transport-independent gate-request contract containing
`consumer_repo`, `installation_id`, `pr_number`, `base_ref`, `base_sha`,
`head_sha`, `event`, and `labels`. The system SHALL emit a
transport-independent gate-result contract containing the overall verdict, row
results, Check Run payload, and PR comment markdown.

#### Scenario: GitHub-hosted route evaluates a request
- **WHEN** a consumer dispatches a normalized request to the master router
- **THEN** the router can run the engine and post the result without consumer-specific engine code

#### Scenario: Webhook route receives the same request
- **WHEN** a route is configured for webhook execution
- **THEN** the router sends the same normalized request shape that the GitHub-hosted route would evaluate locally

### Requirement: Result Parity and Failure Isolation

The system SHALL preserve the current per-row result schema with statuses
`PASS`, `WARN`, and `SKIPPED`. `SKIPPED` rows SHALL be pass-like during
aggregation, and evaluated runs with at least one row SHALL aggregate to an
overall verdict of either `PASS` or `WARN`. Each checklist item MUST have an
isolated timeout and failure handler that emits a determinate WARN row if
evaluation fails.

#### Scenario: Untouched path-filtered item
- **WHEN** a checklist item's `paths` globs do not match any changed file
- **THEN** the row status is `SKIPPED` and the aggregate verdict treats it as pass-like

#### Scenario: One provider call fails
- **WHEN** the provider crashes, times out, or returns malformed JSON for one checklist item
- **THEN** that item emits a WARN fallback row and other checklist items still complete independently

#### Scenario: Blocking run produces no rows
- **WHEN** a non-skipped gate run emits zero result rows and `LLM_GATE_BLOCKING=1`
- **THEN** the Check Run fails closed instead of passing an empty result

### Requirement: Blocking and Override Policy

The system SHALL be advisory by default. A WARN verdict SHALL block merges only
when `LLM_GATE_BLOCKING=1` for the consumer repo and the PR does not have the
`llm-gate/override` label.

#### Scenario: Advisory default
- **WHEN** a consumer repo does not set `LLM_GATE_BLOCKING=1` and the gate finds WARN rows
- **THEN** the Check Run conclusion does not block the PR solely because of those WARN rows

#### Scenario: Blocking without override
- **WHEN** `LLM_GATE_BLOCKING=1`, the gate finds WARN rows, and the PR lacks `llm-gate/override`
- **THEN** the Check Run conclusion is failure

#### Scenario: Override label is present
- **WHEN** `LLM_GATE_BLOCKING=1`, the gate finds WARN rows, and the PR has `llm-gate/override`
- **THEN** the Check Run conclusion is success or neutral according to the override policy and the comment records the override

### Requirement: Branch Protection Source Migration

The system SHALL NOT rely on a new App-posted Check Run to satisfy a
source-pinned required status until branch protection has been re-pointed to
the LLM-Gate App or to any source. For each source-pinned consumer, the system
MUST first verify that the LLM-Gate App has posted a live Check Run on that repo.

#### Scenario: New App posts same check name before re-point
- **WHEN** branch protection requires `Aggregate and post review` from GitHub Actions app id `15368` and the LLM-Gate App posts a Check Run with the same name
- **THEN** the new Check Run does not satisfy the source-pinned requirement until branch protection is updated

#### Scenario: Re-point happens after live App check
- **WHEN** the LLM-Gate App has posted a live `Aggregate and post review` Check Run on a consumer repo
- **THEN** maintainers may re-point the required-check source and verify the status rollup before removing the old gate

### Requirement: Workflow Dispatch Transport

The system SHALL prefer `workflow_dispatch` for v1 consumer-to-master routing
because it requires `Actions: write` on the master repo rather than
`Contents: write`. The master repo MUST keep the router default-branch-only and
MUST NOT expose unrelated manually dispatchable workflows to that credential.

#### Scenario: Consumer dispatches v1 request
- **WHEN** a same-repo PR event fires in a consumer with the dispatch credential available
- **THEN** the consumer triggers the master router through `workflow_dispatch` using the normalized request payload

#### Scenario: Maintainer manually re-runs a PR gate
- **WHEN** a maintainer needs to re-run the gate for a specific PR after cutover
- **THEN** the maintainer can manually dispatch the master router with the normalized request and the router updates the existing PR comment

#### Scenario: Repository dispatch is considered
- **WHEN** maintainers compare `repository_dispatch` for v1 routing
- **THEN** they treat its `Contents: write` requirement on the master repo as an over-grant and do not choose it as the recommended v1 trigger

### Requirement: Provider Seam

The system SHALL isolate model execution behind a provider interface so changing
from the pinned Gemini CLI to an OpenAI-compatible local endpoint does not
change gate orchestration, result aggregation, Check Run posting, or comment
rendering.

#### Scenario: Gemini provider evaluates a row
- **WHEN** a route selects the v1 Gemini provider
- **THEN** the engine evaluates checklist items through `GeminiProvider` and emits the standard row schema

#### Scenario: Local provider is added later
- **WHEN** a route later selects an OpenAI-compatible local provider
- **THEN** the engine uses that provider through the same interface and preserves the normalized result contract
