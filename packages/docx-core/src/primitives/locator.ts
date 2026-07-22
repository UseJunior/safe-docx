import type { DocumentViewNode } from './document_view-types.js';
import { buildCleanToRawOffsetMap } from './document_view.js';
import { computeContentFingerprint } from './content_fingerprint.js';

/**
 * Deterministic locator primitive over a `DocumentView`.
 *
 * A locator resolves a SINGLE span (raw-text offsets within one node) and never
 * heals, scores, or guesses. Ambiguity — zero matches or more than one — is a
 * drift signal reported as `unresolved`, so a caller updates the selector rather
 * than silently filling the wrong place. Redundant `assertions` corroborate the
 * `primary` match the moment an upstream change makes them disagree.
 *
 * Patterns are authored against the stable, normalized `clean_text`; resolved
 * spans are returned as RAW offsets (`getParagraphText` / `replaceTextAtRange`
 * coordinates) via {@link buildCleanToRawOffsetMap}.
 */
export type LocatorStep =
  | {
      kind: 'section';
      /** Exact match against the node's derived heading text. */
      headingText?: string;
      /** Regex (un-anchored) tested against the node's derived heading text. */
      headingRegex?: string;
      /** Exact match against the paragraph's Word style id. */
      headingStyleId?: string;
      /**
       * Outline level at which the region ends: the region runs from the matched
       * heading until the next heading whose level is `<= untilLevel`. Defaults
       * to the matched heading's own level (so the region ends at the next
       * sibling-or-higher heading); when the matched heading has no level and no
       * `untilLevel` is given, the region runs to the end of the current scope.
       */
      untilLevel?: number;
    }
  | { kind: 'regex'; pattern: string; flags?: string; group?: number }
  | { kind: 'contextual'; contextPattern: string; targetPattern: string; rowLabelPattern?: string }
  | { kind: 'fingerprint'; contentFingerprint: string };

export interface Locator {
  /** Ordered `section` steps narrowing to a region (Scrapy-style nesting). */
  scope?: LocatorStep[];
  /** The deterministic single-span resolver. Must be regex | contextual | fingerprint. */
  primary: LocatorStep;
  /** Corroborators that never select. Must be regex | contextual | fingerprint. */
  assertions?: LocatorStep[];
}

export interface LocatorAssertionResult {
  ok: boolean;
  kind: string;
  detail?: string;
}

export interface LocatorResolution {
  /** RAW-offset span, or null when the primary did not resolve to exactly one span. */
  match: { nodeId: string; start: number; end: number } | null;
  /** True when the primary matched zero or more than one span (a drift signal). */
  unresolved: boolean;
  /** Per-assertion corroboration results (empty when `unresolved`). */
  assertionResults: LocatorAssertionResult[];
}

const SPAN_KINDS = new Set(['regex', 'contextual', 'fingerprint']);

/** Raw visible text of a node — the fingerprint basis and offset coordinate space. */
function rawTextOf(node: DocumentViewNode): string {
  return node.raw_text ?? node.text;
}

function dedupeFlags(flags: string): string {
  return Array.from(new Set(flags.split(''))).join('');
}

type CleanSpan = { node: DocumentViewNode; nodeId: string; cleanStart: number; cleanEnd: number };

function collectRegexSpans(nodes: DocumentViewNode[], pattern: string, flags: string | undefined, group: number): CleanSpan[] {
  const needIndices = group > 0;
  const reFlags = dedupeFlags(`${flags ?? ''}g${needIndices ? 'd' : ''}`);
  const spans: CleanSpan[] = [];
  for (const node of nodes) {
    const re = new RegExp(pattern, reFlags);
    const text = node.clean_text;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      let cs: number;
      let ce: number;
      if (needIndices) {
        const idx = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices?.[group];
        if (!idx) {
          if (m.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        cs = idx[0];
        ce = idx[1];
      } else {
        cs = m.index;
        ce = m.index + m[0].length;
      }
      spans.push({ node, nodeId: node.id, cleanStart: cs, cleanEnd: ce });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return spans;
}

function collectContextualSpans(nodes: DocumentViewNode[], step: Extract<LocatorStep, { kind: 'contextual' }>): CleanSpan[] {
  const ctxRe = new RegExp(step.contextPattern);
  const rowRe = step.rowLabelPattern ? new RegExp(step.rowLabelPattern) : null;
  const spans: CleanSpan[] = [];
  for (const node of nodes) {
    if (!ctxRe.test(node.clean_text)) continue;
    if (rowRe && !rowRe.test(node.table_context?.col_header ?? '')) continue;
    const tre = new RegExp(step.targetPattern, 'g');
    const text = node.clean_text;
    let m: RegExpExecArray | null;
    while ((m = tre.exec(text)) !== null) {
      spans.push({ node, nodeId: node.id, cleanStart: m.index, cleanEnd: m.index + m[0].length });
      if (m.index === tre.lastIndex) tre.lastIndex++;
    }
  }
  return spans;
}

function collectFingerprintNodes(nodes: DocumentViewNode[], fingerprint: string): DocumentViewNode[] {
  return nodes.filter((n) => computeContentFingerprint(rawTextOf(n)) === fingerprint);
}

function headingMatches(node: DocumentViewNode, step: Extract<LocatorStep, { kind: 'section' }>): boolean {
  let matched = false;
  if (step.headingStyleId !== undefined) {
    if (node.paragraph_style_id !== step.headingStyleId) return false;
    matched = true;
  }
  if (step.headingText !== undefined) {
    if (node.heading?.text !== step.headingText) return false;
    matched = true;
  }
  if (step.headingRegex !== undefined) {
    if (!new RegExp(step.headingRegex).test(node.heading?.text ?? '')) return false;
    matched = true;
  }
  return matched;
}

/**
 * Narrow `nodes` to the region selected by one `section` step. Returns null when
 * the heading does not match EXACTLY one node (zero or many → unresolved).
 */
function narrowToSection(nodes: DocumentViewNode[], step: Extract<LocatorStep, { kind: 'section' }>): DocumentViewNode[] | null {
  const headingIdx: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (headingMatches(nodes[i]!, step)) headingIdx.push(i);
  }
  if (headingIdx.length !== 1) return null;

  const start = headingIdx[0]!;
  const startLevel = nodes[start]!.heading?.level ?? null;
  const untilLevel = step.untilLevel ?? startLevel;

  let end = nodes.length;
  if (untilLevel !== null) {
    for (let j = start + 1; j < nodes.length; j++) {
      const lvl = nodes[j]!.heading?.level;
      if (lvl != null && lvl <= untilLevel) {
        end = j;
        break;
      }
    }
  }
  return nodes.slice(start, end);
}

function narrowScope(view: DocumentViewNode[], scope: LocatorStep[]): DocumentViewNode[] | null {
  let nodes = view;
  for (const step of scope) {
    if (step.kind !== 'section') {
      throw new Error(`Locator scope steps must be 'section'; got '${step.kind}'`);
    }
    const narrowed = narrowToSection(nodes, step);
    if (narrowed === null) return null;
    nodes = narrowed;
  }
  return nodes;
}

function resolvePrimary(nodes: DocumentViewNode[], step: LocatorStep): LocatorResolution['match'] {
  if (step.kind === 'fingerprint') {
    const hits = collectFingerprintNodes(nodes, step.contentFingerprint);
    if (hits.length !== 1) return null;
    const node = hits[0]!;
    return { nodeId: node.id, start: 0, end: rawTextOf(node).length };
  }

  let spans: CleanSpan[];
  if (step.kind === 'regex') {
    spans = collectRegexSpans(nodes, step.pattern, step.flags, step.group ?? 0);
  } else if (step.kind === 'contextual') {
    spans = collectContextualSpans(nodes, step);
  } else {
    // 'section' is rejected by validateLocator before we get here.
    return null;
  }

  if (spans.length !== 1) return null;
  const span = spans[0]!;
  if (span.cleanEnd <= span.cleanStart) return null; // zero-length match is invalid

  const map = buildCleanToRawOffsetMap(span.node);
  return { nodeId: span.nodeId, start: map[span.cleanStart]!, end: map[span.cleanEnd]! };
}

function resolveAssertion(
  nodes: DocumentViewNode[],
  step: LocatorStep,
  primary: NonNullable<LocatorResolution['match']>,
): LocatorAssertionResult {
  if (step.kind === 'fingerprint') {
    const hits = collectFingerprintNodes(nodes, step.contentFingerprint);
    if (hits.length !== 1) {
      return { ok: false, kind: 'fingerprint', detail: `expected exactly 1 node, found ${hits.length}` };
    }
    const ok = hits[0]!.id === primary.nodeId;
    return { ok, kind: 'fingerprint', detail: ok ? undefined : `node ${hits[0]!.id} != primary node ${primary.nodeId}` };
  }

  let spans: CleanSpan[];
  if (step.kind === 'regex') {
    spans = collectRegexSpans(nodes, step.pattern, step.flags, step.group ?? 0);
  } else if (step.kind === 'contextual') {
    spans = collectContextualSpans(nodes, step);
  } else {
    return { ok: false, kind: step.kind, detail: "'section' is not a valid assertion kind" };
  }

  if (spans.length !== 1) {
    return { ok: false, kind: step.kind, detail: `expected exactly 1 span, found ${spans.length}` };
  }
  const span = spans[0]!;
  if (span.cleanEnd <= span.cleanStart) {
    return { ok: false, kind: step.kind, detail: 'zero-length match' };
  }
  const map = buildCleanToRawOffsetMap(span.node);
  const start = map[span.cleanStart]!;
  const end = map[span.cleanEnd]!;
  const ok = span.nodeId === primary.nodeId && start === primary.start && end === primary.end;
  return {
    ok,
    kind: step.kind,
    detail: ok
      ? undefined
      : `span {${span.nodeId},${start},${end}} != primary {${primary.nodeId},${primary.start},${primary.end}}`,
  };
}

function validateLocator(locator: Locator): void {
  if (!SPAN_KINDS.has(locator.primary.kind)) {
    throw new Error(`Locator primary must be regex | contextual | fingerprint; got '${locator.primary.kind}'`);
  }
  for (const a of locator.assertions ?? []) {
    if (!SPAN_KINDS.has(a.kind)) {
      throw new Error(`Locator assertion must be regex | contextual | fingerprint; got '${a.kind}'`);
    }
  }
  for (const s of locator.scope ?? []) {
    if (s.kind !== 'section') {
      throw new Error(`Locator scope steps must be 'section'; got '${s.kind}'`);
    }
  }
}

/**
 * Resolve a {@link Locator} against a document view. Deterministic: the same
 * `(view, locator)` always yields the same result, with no randomness, scoring,
 * or tie-breaking.
 */
export function resolveLocator(view: DocumentViewNode[], locator: Locator): LocatorResolution {
  validateLocator(locator);

  const scoped = locator.scope && locator.scope.length > 0 ? narrowScope(view, locator.scope) : view;
  if (scoped === null) {
    return { match: null, unresolved: true, assertionResults: [] };
  }

  const match = resolvePrimary(scoped, locator.primary);
  if (match === null) {
    return { match: null, unresolved: true, assertionResults: [] };
  }

  const assertionResults = (locator.assertions ?? []).map((a) => resolveAssertion(scoped, a, match));
  return { match, unresolved: false, assertionResults };
}
