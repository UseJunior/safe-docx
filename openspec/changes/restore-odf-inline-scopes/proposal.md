# Change: Restore ODF inline formatting scopes

## Why
Closing an inner repeated TOON formatting tag currently clears its outer formatting.
Nested anchors also lose the outer link boundary. This silently changes converted text.

## What Changes
- Use small per-tag formatting frames in the inline emitter, including inherited font attributes.
- Flatten nested hyperlinks into the outer scope, report `nested-hyperlink`, and sanitize every URL.
- Keep tolerant crossing tags, extra closing tags, paragraph-local state, and the inline API.

## Approval
Implementation follows the user-approved state-machine remediation plan, epic #1295,
planning item P (#1311), and the explicit instruction to implement that plan.

## Impact
- Affected capability: odf-core conversion.
- Affected production code: `packages/odf-core/src/convert/inline.ts` only.
- No public API, shared tokenizer, URL sanitizer, or caller changes.

## Contributor reconciliation
PR #1328 by @cocvn157 independently proposes per-format stacks and font inheritance.
Those ideas informed this implementation; credit belongs to that contribution.
Its anchor depth resets to one when a safe inner link follows an unsafe outer link,
and nested unsafe URLs do not receive `nested-hyperlink` lossiness. This implementation
counts every anchor opening, activates only a safe outermost URL, and reports both
lossiness classes when applicable. Focused tests verify three levels, following siblings,
all safe/unsafe outer/inner combinations, malformed closes, and paragraph isolation.
The contributor's DOCX font-run test uses adjacent runs; it is useful conversion coverage
but does not exercise repeated nested TOON tags. Direct emitter tests cover that defect.

The same 21 focused regressions were executed against the original inline emitter from
main `16b0026b` (16 failures), contributor head `d5bb3854` (8 failures), and this
implementation (21 passes). The contributor failures include safe inner URLs becoming
active under rejected outer URLs and missing nested-link lossiness for unsafe inner URLs.
These are independently observed results, not the contributor's reported suite counts.
