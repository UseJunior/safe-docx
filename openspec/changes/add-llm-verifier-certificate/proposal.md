# Change: Add an LLM-optimized verifier certificate projection

## Why

The canonical public document-integrity certificate is evidence-complete but
expensive for an LLM to consume. It repeats the same prose claim for every
story, mixes public and internal protocol versions without an explicit schema
layer, and requires a model to normalize uniform successes before it can reason
about failures or scope exclusions.

## What Changes

- Add an opt-in `llm` certificate format to `safe-docx compare` while retaining
  the existing full public v1 certificate as the default.
- Define a deterministic, versioned LLM certificate projection with stable
  invariant IDs, shared definitions, grouped result sets, explicit scope
  counts, exclusions, anomalies, and cryptographic evidence.
- Make `--certificate-format llm` affect both CLI JSON and any requested
  certificate artifact so an LLM does not receive the full redundant value on
  stdout.
- Document and test the projection without changing the Lean checker protocol
  or canonical public certificate.

## Impact

- Affected specs: `mcp-server`
- Affected code: Safe DOCX CLI certificate projection, flag parsing, help,
  command tests, and documentation
- Tracking: GitHub issue #780
- Compatibility: omitted or explicit `full` format preserves the existing CLI
  result and artifact shape
