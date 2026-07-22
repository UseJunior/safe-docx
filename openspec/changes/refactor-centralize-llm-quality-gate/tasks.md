## 1. Master repo and identity
- [ ] 1.1 Create private repo `UseJunior/llm-gate` with protected `main` and required review.
- [ ] 1.2 Add initial layout: `src/`, `.github/workflows/router.yml`, `config/routes.yml`, `prompts/system-prompt.base.md`, and test fixtures.
- [ ] 1.3 Register the dedicated LLM-Gate GitHub App with `Checks: write`, `Contents: read`, `Pull requests: read`, and `Metadata: read`.
- [ ] 1.4 Install the App on `UseJunior/llm-gate`, `UseJunior/safe-docx`, `open-agreements/open-agreements`, `UseJunior/legal-explainer`, and `UseJunior/tests-renderer`.
- [ ] 1.5 Add master-repo secrets `LLM_GATE_APP_ID`, `LLM_GATE_APP_PRIVATE_KEY`, and `GEMINI_API_KEY`; do not copy provider credentials to consumers.

## 2. Engine CLI
- [ ] 2.1 Implement `llm-gate gate --request request.json --out result.json`.
- [ ] 2.2 Parse `checklist.md` items from `- [ ] ...` rows, including optional `<!-- paths: ... -->` globs.
- [ ] 2.3 Compose prompts from `system-prompt.base.md`, optional consumer overlay, the checklist question, and a tilde-fenced untrusted diff.
- [ ] 2.4 Add `GateProvider.evaluate(prompt) -> { status, justification, usage }`.
- [ ] 2.5 Implement `GeminiProvider` around the pinned Gemini CLI for first-cut parity.
- [ ] 2.6 Emit per-row JSON fields `id`, `question`, `status`, `justification`, `attempts`, `estimated_input_tokens`, `estimated_output_tokens`, `estimated_usd`, and `model`.
- [ ] 2.7 Aggregate `PASS | WARN | SKIPPED` rows into overall `PASS | WARN`, treating `SKIPPED` as pass-like.
- [ ] 2.8 Render the existing comment table, overall verdict, and Check Run conclusion.
- [ ] 2.9 Add golden-output tests that reproduce current per-row result JSON byte-for-byte before cutover.
- [ ] 2.10 Wrap each checklist item in try/catch with a determinate WARN fallback row.
- [ ] 2.11 Enforce a per-item timeout.
- [ ] 2.12 Bound internal concurrency with `LLM_GATE_MAX_PARALLEL`, default `2`, and add rate-limit/backoff tests.

## 3. Parity behavior inventory
- [ ] 3.1 Trusted base-ref read of checklist and system prompt.
- [ ] 3.2 Same-repo/fork guard.
- [ ] 3.3 `package-lock.json`-only skip.
- [ ] 3.4 `synchronize` stamp mode for follow-up pushes that only touch `package-lock.json`.
- [ ] 3.5 Per-item `paths` filters.
- [ ] 3.6 Path-scoped diffs.
- [ ] 3.7 `SKIPPED` rows for untouched path-filtered items.
- [ ] 3.8 `max-diff-bytes` truncation with the exact marker.
- [ ] 3.9 Closed tilde fence after diff truncation.
- [ ] 3.10 Gemini CLI pin.
- [ ] 3.11 `.npmrc` poisoning hardening: install from `$RUNNER_TEMP` with forced-empty `NPM_CONFIG_*`, then unset before provider execution.
- [ ] 3.12 `.gemini` symlink removal.
- [ ] 3.13 `GITHUB_TOKEN: ''` in the provider environment.
- [ ] 3.14 `tools.core` allowlist.
- [ ] 3.15 Staggered starts and escalating backoff.
- [ ] 3.16 At most three retries for malformed JSON.
- [ ] 3.17 `always()`-equivalent WARN fallback row.
- [ ] 3.18 Literal-key redaction.
- [ ] 3.19 `AIza[0-9A-Za-z_-]{35}` redaction.
- [ ] 3.20 Cost estimate fields.
- [ ] 3.21 `LLM_GATE_BLOCKING` policy.
- [ ] 3.22 `llm-gate/override` label policy.
- [ ] 3.23 PR-comment upsert: update on dispatch, append on PR event.
- [ ] 3.24 Fail-closed no-result behavior when a non-skipped blocking run emits zero rows.

## 4. Router and transport
- [ ] 4.1 Implement `workflow_dispatch` router as the recommended v1 trigger using a consumer credential with `Actions: write` on the master repo.
- [ ] 4.2 Keep `repository_dispatch` supported but documented as non-recommended because it requires `Contents: write` on the master repo.
- [ ] 4.3 Validate every payload against the `routes.yml` consumer allowlist.
- [ ] 4.4 Refuse to run outside the master default branch.
- [ ] 4.5 Mint a consumer-scoped GitHub App installation token per run.
- [ ] 4.6 Fetch trusted policy from `base_sha` and compute the `base...head` diff without checking out untrusted code as executable.
- [ ] 4.7 Post a Check Run to the consumer `head_sha`.
- [ ] 4.8 Upsert the PR comment.
- [ ] 4.9 Add the v2 webhook branch as a documented no-op/stub with the same normalized request payload.
- [ ] 4.10 Preserve a manual re-run path by allowing maintainers to dispatch the master router for a specific PR and update the existing PR comment.

## 5. Consumer cutover PRs
- [ ] 5.1 `UseJunior/safe-docx`: add thin dispatch workflow and keep existing gate in shadow until parity is proven.
- [ ] 5.2 `UseJunior/safe-docx`: after branch-protection re-point, remove copied workflow/action engine and delete the per-repo `GEMINI_API_KEY`.
- [ ] 5.3 `open-agreements/open-agreements`: add thin dispatch workflow and keep existing gate in shadow until parity is proven.
- [ ] 5.4 `open-agreements/open-agreements`: after branch-protection re-point, remove copied workflow/action engine and delete the per-repo `GEMINI_API_KEY`.
- [ ] 5.5 `UseJunior/legal-explainer`: add thin dispatch workflow and keep existing gate in shadow until parity is proven.
- [ ] 5.6 `UseJunior/legal-explainer`: remove copied workflow/action engine and delete the per-repo `GEMINI_API_KEY`; add the check as required only if desired.
- [ ] 5.7 `UseJunior/tests-renderer`: add thin dispatch workflow and keep existing gate in shadow until parity is proven.
- [ ] 5.8 `UseJunior/tests-renderer`: after branch-protection re-point, remove copied workflow/action engine and delete the per-repo `GEMINI_API_KEY`.

## 6. Branch protection and verification
- [ ] 6.1 Verify the new LLM-Gate App has posted at least one live `Aggregate and post review` Check Run on `UseJunior/safe-docx`.
- [ ] 6.2 Re-point `UseJunior/safe-docx` required-check source from app id `15368` to the LLM-Gate App or any source; verify with `gh api` and `gh pr view --json statusCheckRollup`.
- [ ] 6.3 Verify the new LLM-Gate App has posted at least one live `Aggregate and post review` Check Run on `open-agreements/open-agreements`.
- [ ] 6.4 Re-point `open-agreements/open-agreements` required-check source from app id `15368` to the LLM-Gate App or any source; verify with `gh api` and `gh pr view --json statusCheckRollup`.
- [ ] 6.5 Verify the new LLM-Gate App has posted at least one live `Aggregate and post review` Check Run on `UseJunior/tests-renderer`.
- [ ] 6.6 Re-point `UseJunior/tests-renderer` required-check source from app id `15368` to the LLM-Gate App or any source; verify with `gh api` and `gh pr view --json statusCheckRollup`.
- [ ] 6.7 For `UseJunior/legal-explainer`, decide whether to add `Aggregate and post review` as required; if yes, source-pin it only after the LLM-Gate App has posted a live check.

## 7. OpenSpec
- [ ] 7.1 Validate this change with `openspec validate refactor-centralize-llm-quality-gate --strict`.
- [ ] 7.2 Keep implementation work out of this proposal PR until the OpenSpec change is reviewed and approved.
