## 1. Comparison module (docx-core, Word-free)

- [x] 1.1 Add `src/integration/word-accept-reject-oracle.ts`: `projectDocx`, `diffProjections` (page setup
      missing on one side is a note), `applyToStoryParts`, `packageContentHash`,
      `classifyOsascriptFailure`, `withWordLock` (soffice-lock protocol, custom lockfile),
      `runAcceptRejectOracle`, `oracleExitCode`, `formatUnitLine`, `formatOracleReport`.
- [x] 1.2 Unit-test it without Word: binding inheritance, snapshot exclusion, revision counting in story
      parts, paragraph text rules, every diff field, hash stability, failure classification, lock
      acquire/release/timeout, and MATCH/MISMATCH/XFAIL/XPASS/ERROR/abort orchestration with a fake Word.

## 2. Runner (`scripts/oracle/word/accept-reject/`)

- [x] 2.1 AppleScript driver: stage in Word's container, bounded `with timeout` plus child timeout, one retry,
      close only this run's documents, never quit Word; permission probe before the run.
- [x] 2.2 Fixture generators for the #1188 matrix (30) and the #1144 part A pairs (9); node tests for shape
      and determinism, added to `oracle:word:test`.
- [x] 2.3 CLI `npm run oracle:word:accept-reject` with `--suite`, `--fixture`, `--pair`, `--only`,
      `--refresh`, `--timeout`, `--keep`, `--json`, `--strict`; clean skip in CI, off macOS, and without Word
      or Automation permission; content-addressed cache; known-divergence list.
- [x] 2.4 Document setup, permissions, staging, cache and exit codes in `scripts/oracle/word/README.md`.

## 3. Verification

- [x] 3.1 Full run against Word 16.114 on origin/main: matrix 60/60, round-trip 18/18.
- [x] 3.2 Cross-check: the fresh Word outputs project identically to the #1188 Word outputs (30/30).
- [x] 3.3 Negative control: docx-compare with the #1188 carry disabled mismatches Word on 10 of the 30
      primary-mode units, so the oracle detects that regression.
