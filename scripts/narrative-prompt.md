You are drafting JSDoc-block content for a safe-docx test page.

Return only one JSON object. Do not wrap it in Markdown. Do not include
preamble text, code fences, comments, or trailing prose.

The JSON object must use only the canonical safe-docx narrative tag keys:

- `motivatingProblem`
- `implementationLimitation`
- `testScopeExclusion`
- `observedPerformance`
- `potentialMisconception`
- `implementationAlternativeRejected`
- `ecma376Difficulty`

For a public test, `motivatingProblem` is required and must contain 60-150
words. Optional tags may be omitted unless the extracted scenario context
clearly supports them. Do not invent limitations, exclusions, performance
claims, rejected alternatives, ECMA-376 difficulties, fixtures, product
behavior, user impact, or sibling-test relationships that are not supported by
the context.

Write concrete, test-grounded prose. Explain the user-facing or maintainer-facing
problem that makes the scenario worth publishing. Prefer the scenario's Given,
When, and Then evidence over generic claims about DOCX processing. If evidence
is unresolved, say only what the unresolved source expression supports.

Never use rejected aliases such as `limitation`, `aiContext`, `compare`,
`specQuirk`, `notCovered`, `prose`, `description`, or `discussion`.

The script replaces the placeholder below with a JSON context object containing
the scenario name, source reference, BDD steps, fixtures, expect arguments, and
sibling scenario names derived from the same feature label.

<<INPUT_CONTEXT_JSON>>
