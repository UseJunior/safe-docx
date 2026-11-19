# Change: Version document-view cache validity

## Why
The dirty flag conflates mutation history with whether a view was read. Callers
also reach into private cache fields after direct DOM edits. Issue #1302 in
epic #1295 requires monotonic history and an official notification API.

## What Changes
- Maintain an instance-local, document-wide mutation version and tag cached
  views with their build version and rendering options.
- Expose `markMutated(): void` and `getMutationVersion(): number`; built-in
  body, story, and package edits notify automatically.
- Isolate the synchronous temporary-story cache while preserving mutation
  history across successful callbacks and exceptions.
- Include proofing-marker and rsid removal in normalization bookkeeping.
- Replace MCP private-state writes with typed notification calls.

## Approval
Implementation follows the user-approved remediation plan and explicit
“Implement the plan” authorization. This proposal records the settled design.

## Impact
- Affected specs: docx-primitives.
- Affected code: DocxDocument and three MCP DOM-edit callers.
- MCP names, parameters, responses, numbering/revision policies, and the
  original minimal-reserialization baseline remain unchanged.
- Contributor reconciliation: PR #1331 by @cocvn157 independently implements
  the same central API/cache approach. Its temporary-story version rollback,
  missing direct story notifications, and incomplete normalization accounting
  do not satisfy the full document-wide contract. Its private-field test
  migration is useful and included here; its public dirty compatibility
  accessor is unnecessary because dirty was private. No contributor branch
  or deployment permissions are changed.
