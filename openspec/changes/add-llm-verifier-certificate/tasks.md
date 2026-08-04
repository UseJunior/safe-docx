## 1. Specification

- [x] 1.1 Validate the LLM projection, compatibility, and failure-retention requirements

## 2. Projection

- [x] 2.1 Define the versioned LLM certificate TypeScript contract
- [x] 2.2 Normalize canonical checks into stable invariant definitions and grouped result sets
- [x] 2.3 Preserve hashes, scopes, exclusions, story evidence, reasons, and all anomaly arrays

## 3. CLI

- [x] 3.1 Parse and validate `--certificate-format full|llm`
- [x] 3.2 Emit the selected format consistently in CLI JSON and certificate files
- [x] 3.3 Preserve omitted/full behavior and fail-closed atomic publication
- [x] 3.4 Document the new flag and schema semantics

## 4. Evidence

- [x] 4.1 Test deterministic normalization, claim deduplication, grouping, and failure retention
- [x] 4.2 Test CLI parsing, full compatibility, and LLM artifact/result parity
- [x] 4.3 Run focused, OpenSpec, and mandatory pre-submit checks
