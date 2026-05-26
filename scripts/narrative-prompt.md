You are drafting JSDoc-block content for a safe-docx test page.

Return only one JSON object. Do not wrap it in Markdown. Do not include
preamble text, code fences, comments, or trailing prose.

The JSON object must use only the canonical safe-docx narrative tag keys,
each constrained to a word-count range enforced by the schema validator:

- `motivatingProblem`                  — 60–150 words   (REQUIRED for public)
- `implementationLimitation`           — 40–300 words   (optional)
- `testScopeExclusion`                 — 40–300 words   (optional)
- `observedPerformance`                — 40–200 words   (optional)
- `potentialMisconception`             — 40–250 words   (optional)
- `implementationAlternativeRejected`  — 40–250 words   (optional)
- `ecma376Difficulty`                  — 40–250 words   (optional)

`motivatingProblem` is required for a public test. Optional tags may be
omitted unless the extracted scenario context clearly supports them. If
you emit an optional tag, its body MUST fall within the word-count range
shown above — output that exceeds the range fails schema validation and
the resulting patch is rejected. Do not invent limitations, exclusions,
performance claims, rejected alternatives, ECMA-376 difficulties,
fixtures, product behavior, user impact, or sibling-test relationships
that are not supported by the context.

Write concrete, test-grounded prose. Explain the user-facing or maintainer-facing
problem that makes the scenario worth publishing. Prefer the scenario's Given,
When, and Then evidence over generic claims about DOCX processing. If evidence
is unresolved, say only what the unresolved source expression supports.

Never use rejected aliases such as `limitation`, `aiContext`, `compare`,
`specQuirk`, `notCovered`, `prose`, `description`, or `discussion`.

## Optional-tag filling bias

When a scenario is being promoted from internal to public visibility, prefer to
fill supported optional tags instead of returning only `motivatingProblem`.
Use an optional tag only when the extracted scenario context directly supports
the claim, and keep every optional tag inside its schema word-count range.
Do not pad optional tags with generic rationale or unsupported product claims.

The script replaces the placeholder below with a JSON context object containing
the scenario name, source reference, BDD steps, fixtures, expect arguments, and
sibling scenario names derived from the same feature label.

<<INPUT_CONTEXT_JSON>>
