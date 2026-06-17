# Design: Deterministic Locator Primitive

## Context
open-agreements is replacing brittle global find/replace recipe logic with **selector contracts** resolved against a DOCX. It needs a reusable, deterministic way to locate a span and to learn when an upstream form change has broken a locator. Rather than hand-roll this in open-agreements, we land it in `@usejunior/docx-core` so it is tested once and dogfooded across consumers.

## Goals / Non-goals
- **Goal:** a pure, deterministic `resolveLocator(view, locator)` over the existing `DocumentView`.
- **Goal:** make locator results safe to mutate by returning raw-text offsets (retire the #1 offset hazard with a tested map).
- **Goal:** fix the empty free `buildDocumentView` stub so consumers can't trip on it.
- **Non-goal:** fuzzy matching, scoring, ranking, or auto-repair. Drift is *reported*, not healed.
- **Non-goal:** any MCP tool, mutation API, or schema change. The locator only locates; mutation stays on the existing `replaceParagraphTextRange`/`replaceTextAtRange`.

## Types
```ts
type LocatorStep =
  | { kind: 'section'; headingText?: string; headingRegex?: string; headingStyleId?: string; untilLevel?: number }
  | { kind: 'regex'; pattern: string; flags?: string; group?: number }   // matched on clean_text
  | { kind: 'contextual'; contextPattern: string; targetPattern: string; rowLabelPattern?: string }
  | { kind: 'fingerprint'; contentFingerprint: string };                 // whole-node anchor

interface Locator { scope?: LocatorStep[]; primary: LocatorStep; assertions?: LocatorStep[]; }

interface LocatorResolution {
  match: { nodeId: string; start: number; end: number } | null;  // RAW offsets (clean_text match → raw via map)
  unresolved: boolean;                                           // primary != exactly one match
  assertionResults: Array<{ ok: boolean; kind: string; detail?: string }>;
}

function resolveLocator(view: DocumentViewNode[], locator: Locator): LocatorResolution;
```

**Step-kind constraints (validated at runtime / via schema):** `section` may appear ONLY in `scope` (it denotes a region, not a span). `primary` and every `assertions` entry MUST be `regex` | `contextual` | `fingerprint`. A `regex`/`contextual` pattern that can match zero-length is invalid (→ `unresolved`). `fingerprint` matches node identity and is computed from the node's raw visible text (`node.text`) via `computeContentFingerprint` — consistent with that function's existing "raw visible text" basis (it NFKC-normalizes/strips/collapses internally).

## Determinism model (primary + assertions)
- `scope` steps run in order; each `section` must match **exactly one** heading in the current region or the locator is `unresolved`. The region runs from the matched heading to the next heading at outline level `≤ untilLevel`.
- `primary` must produce **exactly one** span in scope. Zero or many → `unresolved`. There is no tie-break: ambiguity is a drift signal, deliberately, so callers update the selector rather than silently filling the wrong place.
- `assertions` never select. Span kinds (`regex`/`contextual`) must equal the primary's resolved `{nodeId,start,end}`; `fingerprint` assertions match `nodeId` only. Results are reported; failures are drift.
- Regex iteration is left-to-right; "exactly one" is counted over all matches in scope. No `Set`/`Map` iteration order is relied upon.

## Offset model (the #1 risk)
Patterns are authored against `clean_text` (stable, normalized, human/LLM-readable). But mutation needs **raw** offsets. We build a per-node `clean_text → raw` map covering the transforms `clean_text` actually applies — leading/trailing trim, CR/LF removal, and manual-list-label stripping — and translate the matched span before returning it. `clean_text` does NOT collapse internal whitespace (verified: it is `getParagraphText().replace(/\r|\n/g,'').trim()` + optional `stripListLabel`; internal whitespace collapse lives only in `computeContentFingerprint`), so the map does not handle that case. This centralizes the only correctness-sensitive arithmetic in one tested place, generalizing the scalar `visible_offset_correction`. Where `clean_text === raw`, translation is identity.

## buildDocumentView shared core
The populated per-paragraph logic currently lives only in `DocxDocument.buildDocumentView()`; the free `buildDocumentView(params)` is an empty stub. Extract the per-paragraph builder into a shared pure helper and have both call it, so the free function returns populated nodes. This is an internal refactor: the free function is not re-exported from `index.ts` today and has no non-test callers, so behavior for existing method callers is unchanged. Both paths include only paragraphs carrying a `_bk_*` bookmark id (existing `buildDocumentView` behavior: it drops paragraphs where `getParagraphBookmarkId` is empty) and neither inserts bookmarks — a consumer operating on un-bookmarked source DOCX MUST call `DocxDocument.insertParagraphBookmarks()` first. That is the consuming repo's responsibility, not this primitive's.

## Risks
- **Offset map correctness** is the highest risk; mitigated by per-transform unit tests (trim / CR-LF / list-label / whitespace-collapse) and an identity test.
- **Heading detection ambiguity** for `section`: handled by the exactly-one rule (ambiguity → unresolved), not heuristics.
- **Version coupling:** consumers must pin `^0.12.0`; called out in the proposal and the consuming repo's change.
