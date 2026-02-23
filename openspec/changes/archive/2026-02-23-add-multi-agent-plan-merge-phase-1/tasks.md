## 1. Specification
- [x] 1.1 Add mcp-server deltas for `init_plan` and `merge_plans`.
- [x] 1.2 Define deterministic conflict rules and default conflict-fail behavior.

## 2. Implementation (Phase 1)
- [x] 2.1 Implement `init_plan` tool to emit plan context with base revision metadata.
- [x] 2.2 Implement `merge_plans` tool with deterministic normalization and conflict analysis.
- [x] 2.3 Return auditable merge diagnostics and merged master-plan artifact.
- [x] 2.4 Register new tools in MCP catalog and server dispatcher.

## 3. Validation
- [x] 3.1 Add tests for conflict-free merge.
- [x] 3.2 Add tests for each hard conflict class.
- [x] 3.3 Add tests for `fail_on_conflict=true` and `fail_on_conflict=false` behavior.

## 4. Verification
- [x] 4.1 `npm run build -w @usejunior/safe-docx`
- [x] 4.2 `npm run test:run -w @usejunior/safe-docx -- src/tools/merge_plans.test.ts src/tools/init_plan.test.ts`
- [x] 4.3 `openspec validate add-multi-agent-plan-merge-phase-1 --strict`
