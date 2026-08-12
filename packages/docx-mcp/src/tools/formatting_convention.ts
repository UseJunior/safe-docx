import {
  DocxDocument,
  OOXML,
  W,
  extractEffectiveRunFormatting,
  getFirstChild,
  getParagraphRuns,
  type StylesModel,
} from '@usejunior/docx-core';

/**
 * Formatting-convention check for inserted runs (issue #687).
 *
 * A well-formed edit can still be visibly wrong: an inserted inline defined
 * term rendered in plain runs inside an agreement that sets every other
 * parenthetical definition in bold italic round-trips, extracts byte-identical
 * text, and passes every structural validator. Nothing compares the inserted
 * run against the document's own distribution of the same construct, so the
 * defect is invisible to `validate_document` (well-formedness) and to
 * `validate_ai_revisions` (revision-markup legality) alike.
 *
 * This module compares an inserted construct's *resolved* run formatting
 * against the modal formatting of the same construct class elsewhere in the
 * document. Four properties are load-bearing:
 *
 * 1. **Structural, never textual.** Divergence is decided on the
 *    `(bold, italic, underline)` tuple. Text is used only to *locate*
 *    instances, never to judge them.
 * 2. **Effective, not declared, formatting.** Resolution goes through
 *    {@link extractEffectiveRunFormatting}, so a run that inherits bold italic
 *    from a character or paragraph style is not reported as divergent. That is
 *    the entire reason #684 was a prerequisite of #687.
 * 3. **This mutation's insertions, not the session's.** "Inserted" is decided
 *    by differencing the pre-mutation document against the preview, the same
 *    multiset-consumption technique `splitIntroducedDiagnostics` uses in
 *    `ai_revision_guard.ts`. A `w:ins` an earlier edit in the same session left
 *    behind is part of the document now, not part of this edit.
 * 4. **Advisory only.** The result is a list of warnings on the channel
 *    #686/#701 built. Nothing here can block an edit, and a document with no
 *    established convention produces silence rather than a guess.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/687
 */

/** `w:ins` is not in the shared `W` vocabulary; `w:del` is (`W.del`). */
const W_INS = 'ins';

/** Construct classes whose formatting a document may establish a convention for. */
export type ConventionConstruct = 'inline_defined_term' | 'proviso_keyword';

const CONSTRUCT_LABELS: Record<ConventionConstruct, string> = {
  inline_defined_term: 'inline defined term',
  proviso_keyword: 'proviso keyword',
};

/**
 * The comparison tuple. Deliberately the three properties a drafter actually
 * uses to mark these constructs; font, size and colour vary for reasons that
 * have nothing to do with the construct (headings, tables, footers) and would
 * make the mode meaningless.
 */
export type ConventionTuple = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

/** One occurrence of a construct in a document, with its resolved formatting. */
type ConventionInstance = {
  /** Case-folded construct text, used only to match an insertion to its occurrence. */
  key: string;
  /** Construct text as it appears, for the warning message. */
  label: string;
  /** Resolved tuple of every text-bearing run overlapping the construct. */
  runTuples: ConventionTuple[];
  /**
   * True when every overlapping run resolves to the same tuple. A construct
   * split across runs that disagree carries no single formatting, so it is
   * evidence of nothing and must not vote on the convention.
   */
  homogeneous: boolean;
  /** The shared tuple; meaningful only when `homogeneous`. */
  tuple: ConventionTuple;
  /** Tuples of the overlapping runs that sit inside an AI-authored `w:ins`. */
  insertedRunTuples: ConventionTuple[];
};

/** A character range inside a paragraph's visible text. */
type ConstructSpan = { start: number; end: number; key: string; label: string };

/** One divergence, structured so callers can attribute it to a step or render it. */
export type ConventionWarning = {
  construct: ConventionConstruct;
  /** The construct's own text — the defined term, or the proviso keyword. */
  term: string;
  /** Human-readable rendering, matching the `warnings` channel's string shape. */
  message: string;
};

export type FormattingConventionOptions = {
  /**
   * The text this mutation inserts. The check is gated on this: it runs only
   * when the inserted text itself contains a construct, and is skipped
   * entirely otherwise. Settled on #687 (2026-07-29) — cost does not constrain
   * the check, so the trigger is chosen for precision.
   */
  insertedText: string;
  /** `w:ins/@w:author` value identifying runs this session inserted. */
  aiAuthor: string;
  /**
   * The document as it stood *before* this mutation. It supplies the
   * convention — the standard an edit is judged against is the document the
   * edit arrived at, never one this edit helped write — and it is differenced
   * against the preview to tell this mutation's insertions apart from earlier
   * ones by the same author.
   */
  baselineDoc: DocxDocument;
  /**
   * Minimum comparable instances before a document is treated as having a
   * convention at all. Below this, stay silent.
   */
  minInstances?: number;
  /** Share of instances the modal tuple must hold to count as a convention. */
  dominanceThreshold?: number;
};

/**
 * Thresholds from the #687 design comment: at least 5 comparable instances of
 * the construct, with the modal `(bold, italic, underline)` tuple holding at
 * least 80% of them. Evaluated over the population of *comparable constructs*,
 * never over the document's runs at large — a naive quoted-text match hits a
 * large share of every run in a real agreement, which would compute the mode
 * over a polluted population.
 */
export const DEFAULT_MIN_INSTANCES = 5;
export const DEFAULT_DOMINANCE_THRESHOLD = 0.8;

export const FORMATTING_CONVENTION_WARNING_CODE = 'FORMATTING_CONVENTION_DIVERGENCE';

// ── Construct matchers ─────────────────────────────────────────────────────
//
// Matcher precision, not throughput, decides whether this check is
// trustworthy. Quoted text alone is far too common to serve as the matcher, so
// a defined term must carry the parenthetical enclosure, definitional phrasing
// around every quoted term, and nothing else: `(the "Term")`,
// `(each, a "Term")`, `(collectively, the "Buyer" and the "Seller")`.

/**
 * Double quotes only. Curly single quotes were tried and removed: `’` is also
 * the apostrophe, so `(the ‘Company’s Assets’)` closes at the possessive and
 * the term comes out truncated. Supporting them needs apostrophe-aware
 * scanning, and defined terms in the corpus this targets use double quotes.
 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['“', '”'], // “ ”
  ['"', '"'],
];

/**
 * Words allowed to precede the first quoted term inside the parenthetical.
 * Anything else — `see`, `as defined in`, a citation — means this is not a
 * definition and must not join the population.
 */
const LEAD_IN_RE =
  /^[\s,;]*(?:(?:each|collectively|together|individually|jointly|severally|and|or|being|such|this|these|those|herein|hereinafter|referred\s+to\s+as|known\s+as|called|defined\s+as)[\s,;]*)*(?:the|a|an)?[\s,;]*$/i;

/**
 * Between two quoted terms in one parenthetical, only a conjunction may
 * appear. Without this, `(the "Buyer" shall notify the "Seller")` — ordinary
 * prose — donates two instances to the population and can invent or destroy
 * the mode on its own.
 */
const INTER_QUOTE_RE = /^[\s,;]*(?:and|or)?[\s,;]*(?:the|a|an)?[\s,;]*$/i;

/** After the last quoted term, only closing punctuation may remain. */
const TRAILER_RE = /^[\s,;.]*$/;

/**
 * Top-level, properly closed, non-nesting parentheticals. A regex scan accepts
 * the inner half of `((the "Term")` and calls it an enclosure; a depth-tracking
 * scan does not. Malformed parentheses are real in tracked-change views, so
 * this is population hygiene rather than pedantry.
 */
function findTopLevelParentheticals(text: string): Array<{ start: number; inner: string }> {
  const out: Array<{ start: number; inner: string }> = [];
  const stack: Array<{ start: number; nested: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      if (stack.length > 0) stack[stack.length - 1]!.nested = true;
      stack.push({ start: i, nested: false });
      continue;
    }
    if (ch !== ')') continue;
    const frame = stack.pop();
    if (!frame) continue; // stray closer: no enclosure to report
    if (stack.length > 0) continue; // a nested pair, not a top-level one
    if (frame.nested) continue; // top-level, but it contains a nested pair
    out.push({ start: frame.start + 1, inner: text.slice(frame.start + 1, i) });
  }
  return out;
}

function findQuotedSpans(text: string): Array<{ start: number; end: number; inner: string }> {
  const spans: Array<{ start: number; end: number; inner: string }> = [];
  for (let i = 0; i < text.length; i++) {
    const pair = QUOTE_PAIRS.find(([open]) => text[i] === open);
    if (!pair) continue;
    const close = pair[1];
    // A straight-quote pair opens and closes with the same character, so the
    // search for the closer must start after the opener.
    const closeIdx = text.indexOf(close, i + 1);
    if (closeIdx < 0) continue;
    const inner = text.slice(i + 1, closeIdx);
    if (inner.length === 0) continue;
    spans.push({ start: i, end: closeIdx + 1, inner });
    i = closeIdx;
  }
  return spans;
}

/**
 * Inline defined terms: quoted terms inside a parenthetical where every
 * segment around them is definitional.
 *
 * The reported span covers the term text *between* the quote marks and not the
 * marks themselves. That is not cosmetic. Measured across the two corpus
 * agreements in `tests/test_documents`, the opening and closing quotes almost
 * always sit in the surrounding runs — `[" (the “", plain]["Fund", bold]["”) is
 * made on", plain]` is the typical shape — so a span including the marks reads
 * as three disagreeing runs and the instance is discarded as incomparable.
 * Narrowed to the term, the same instance resolves cleanly to the formatting a
 * reader actually sees on the defined term.
 */
export function findInlineDefinedTermSpans(text: string): ConstructSpan[] {
  const out: ConstructSpan[] = [];
  for (const { start: innerStart, inner } of findTopLevelParentheticals(text)) {
    const quoted = findQuotedSpans(inner);
    if (quoted.length === 0) continue;
    if (!LEAD_IN_RE.test(inner.slice(0, quoted[0]!.start))) continue;
    if (!TRAILER_RE.test(inner.slice(quoted[quoted.length - 1]!.end))) continue;

    let connected = true;
    for (let i = 1; i < quoted.length; i++) {
      if (!INTER_QUOTE_RE.test(inner.slice(quoted[i - 1]!.end, quoted[i]!.start))) {
        connected = false;
        break;
      }
    }
    if (!connected) continue;

    for (const q of quoted) {
      out.push({
        start: innerStart + q.start + 1, // skip the opening quote mark
        end: innerStart + q.end - 1, // stop before the closing quote mark
        key: normalizeKey(q.inner),
        label: q.inner,
      });
    }
  }
  return out;
}

/**
 * Proviso keywords: `provided` or `however` introduced by a semicolon. The
 * span covers the keyword itself, which is what agreements underline or
 * italicise.
 */
const PROVISO_RE = /;\s*(provided|however)\b/gi;

export function findProvisoKeywordSpans(text: string): ConstructSpan[] {
  const out: ConstructSpan[] = [];
  PROVISO_RE.lastIndex = 0;
  let match = PROVISO_RE.exec(text);
  while (match) {
    const keyword = match[1]!;
    const start = match.index + match[0].length - keyword.length;
    out.push({
      start,
      end: start + keyword.length,
      key: normalizeKey(keyword),
      label: keyword,
    });
    match = PROVISO_RE.exec(text);
  }
  return out;
}

const MATCHERS: Record<ConventionConstruct, (text: string) => ConstructSpan[]> = {
  inline_defined_term: findInlineDefinedTermSpans,
  proviso_keyword: findProvisoKeywordSpans,
};

export const CONVENTION_CONSTRUCTS = Object.keys(MATCHERS) as ConventionConstruct[];

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ── Document scan ──────────────────────────────────────────────────────────

function paragraphStyleId(pPr: Element | null): string | null {
  if (!pPr) return null;
  const pStyle = getFirstChild(pPr, OOXML.W_NS, W.pStyle);
  if (!pStyle) return null;
  return (
    pStyle.getAttributeNS(OOXML.W_NS, 'val') ??
    pStyle.getAttribute('w:val') ??
    pStyle.getAttribute('val')
  );
}

/**
 * True when `run` sits inside a `w:ins` attributed to `author`, anywhere below
 * `paragraph`. Structural: the revision wrapper and its author attribute are
 * what identify an insertion, not the text it carries.
 */
function isInsertedByAuthor(run: Element, paragraph: Element, author: string): boolean {
  let cur = run.parentNode as Element | null;
  while (cur && cur !== paragraph) {
    if (cur.namespaceURI === OOXML.W_NS && cur.localName === W_INS) {
      const attr =
        cur.getAttributeNS(OOXML.W_NS, 'author') ??
        cur.getAttribute('w:author') ??
        cur.getAttribute('author');
      if (attr === author) return true;
    }
    cur = cur.parentNode as Element | null;
  }
  return false;
}

/** True when `run` sits inside a tracked deletion or move-from wrapper. */
function isRemoved(run: Element, paragraph: Element): boolean {
  let cur = run.parentNode as Element | null;
  while (cur && cur !== paragraph) {
    if (
      cur.namespaceURI === OOXML.W_NS &&
      (cur.localName === W.del || cur.localName === W.moveFrom)
    ) {
      return true;
    }
    cur = cur.parentNode as Element | null;
  }
  return false;
}

/**
 * Every text-bearing run overlapping `[start, end)`, in document order. A
 * construct is routinely split — the quote marks in one run and the term in
 * another — and judging only the largest fragment lets a divergent fragment
 * through unreported.
 */
function overlappingRuns(
  runs: ReadonlyArray<{ r: Element; text: string }>,
  start: number,
  end: number,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    if (run.text.length === 0) continue;
    if (Math.min(end, runEnd) - Math.max(start, runStart) <= 0) continue;
    if (seen.has(run.r)) continue;
    seen.add(run.r);
    out.push(run.r);
  }
  return out;
}

function collectInstances(
  doc: DocxDocument,
  styles: StylesModel,
  construct: ConventionConstruct,
  aiAuthor: string,
): ConventionInstance[] {
  const matcher = MATCHERS[construct];
  const instances: ConventionInstance[] = [];

  for (const p of doc.getParagraphs()) {
    const runs = getParagraphRuns(p);
    if (runs.length === 0) continue;
    const text = runs.map((run) => run.text).join('');
    if (text.length === 0) continue;
    const spans = matcher(text);
    if (spans.length === 0) continue;

    const pPr = getFirstChild(p, OOXML.W_NS, W.pPr);
    const styleId = paragraphStyleId(pPr);

    for (const span of spans) {
      const runTuples: ConventionTuple[] = [];
      const insertedRunTuples: ConventionTuple[] = [];
      for (const run of overlappingRuns(runs, span.start, span.end)) {
        if (isRemoved(run, p)) continue;
        // Theme is deliberately omitted: it feeds only font and colour
        // resolution, neither of which is in the comparison tuple.
        const fmt = extractEffectiveRunFormatting({
          run,
          paragraphPPr: pPr,
          paragraphStyleId: styleId,
          styles,
        });
        const tuple = { bold: fmt.bold, italic: fmt.italic, underline: fmt.underline };
        runTuples.push(tuple);
        if (isInsertedByAuthor(run, p, aiAuthor)) insertedRunTuples.push(tuple);
      }
      if (runTuples.length === 0) continue;

      const first = runTuples[0]!;
      const homogeneous = runTuples.every((t) => tupleKey(t) === tupleKey(first));
      instances.push({
        key: span.key,
        label: span.label,
        runTuples,
        homogeneous,
        tuple: first,
        insertedRunTuples,
      });
    }
  }

  return instances;
}

// ── Convention resolution ──────────────────────────────────────────────────

function tupleKey(tuple: ConventionTuple): string {
  return `${tuple.bold ? 1 : 0}${tuple.italic ? 1 : 0}${tuple.underline ? 1 : 0}`;
}

function describeTuple(tuple: ConventionTuple): string {
  return `bold=${tuple.bold}, italic=${tuple.italic}, underline=${tuple.underline}`;
}

/** Identity of one instance for multiset differencing: text plus every tuple. */
function instanceFingerprint(instance: ConventionInstance): string {
  return `${instance.key}|${instance.runTuples.map(tupleKey).join(',')}`;
}

export type ConventionSummary = {
  /** Comparable instances the mode was computed over. */
  total: number;
  /** How many of them carry the modal tuple. */
  modeCount: number;
  tuple: ConventionTuple;
};

/**
 * The dominant tuple, or null when the population is too small or too split to
 * call a convention. A tie can never pass: two distinct tuples cannot each
 * hold 80% of one population.
 */
function resolveConvention(
  instances: ReadonlyArray<ConventionInstance>,
  minInstances: number,
  dominanceThreshold: number,
): ConventionSummary | null {
  if (instances.length < minInstances) return null;

  const counts = new Map<string, { count: number; tuple: ConventionTuple }>();
  for (const instance of instances) {
    const key = tupleKey(instance.tuple);
    const entry = counts.get(key) ?? { count: 0, tuple: instance.tuple };
    entry.count += 1;
    counts.set(key, entry);
  }

  let best: { count: number; tuple: ConventionTuple } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return null;
  if (best.count / instances.length < dominanceThreshold) return null;

  return { total: instances.length, modeCount: best.count, tuple: best.tuple };
}

/**
 * The convention a document establishes for one construct class, or null when
 * it establishes none. Exposed so a caller — or a test working against a real
 * corpus document — can ask what a document's own standard is without running
 * an edit through it.
 */
export function summarizeDocumentConvention(
  doc: DocxDocument,
  construct: ConventionConstruct,
  opts?: { minInstances?: number; dominanceThreshold?: number },
): ConventionSummary | null {
  // No author can match the empty string, so nothing is classified as inserted.
  const instances = collectInstances(doc, doc.getStylesModel(), construct, '');
  return resolveConvention(
    instances.filter((instance) => instance.homogeneous),
    opts?.minInstances ?? DEFAULT_MIN_INSTANCES,
    opts?.dominanceThreshold ?? DEFAULT_DOMINANCE_THRESHOLD,
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Compare the constructs this mutation inserted against the document's own
 * convention for the same construct class, and describe every divergence.
 *
 * An empty result means either "nothing inserted that this checks" or "no
 * established convention" — the two are deliberately indistinguishable to the
 * caller, because both mean the same thing operationally: say nothing.
 *
 * Never throws: a convention warning that could fail an edit would violate the
 * advisory contract, so an unexpected document shape degrades to silence.
 *
 * @param previewDoc the document as it will be once the mutation is applied
 */
export function checkFormattingConvention(
  previewDoc: DocxDocument,
  options: FormattingConventionOptions,
): ConventionWarning[] {
  const {
    insertedText,
    aiAuthor,
    baselineDoc,
    minInstances = DEFAULT_MIN_INSTANCES,
    dominanceThreshold = DEFAULT_DOMINANCE_THRESHOLD,
  } = options;

  if (!insertedText || !aiAuthor || !baselineDoc) return [];

  try {
    let previewStyles: StylesModel | null = null;
    let baselineStyles: StylesModel | null = null;
    const warnings: ConventionWarning[] = [];

    for (const construct of CONVENTION_CONSTRUCTS) {
      // Gate: only run when the inserted text itself carries this construct.
      const insertedSpans = MATCHERS[construct](insertedText);
      if (insertedSpans.length === 0) continue;
      const insertedKeys = new Set(insertedSpans.map((span) => span.key));

      baselineStyles ??= baselineDoc.getStylesModel();
      const baseline = collectInstances(baselineDoc, baselineStyles, construct, aiAuthor);

      // The convention is the document as this edit found it. Insertions an
      // earlier edit in the same session left behind are part of that document
      // and keep their vote.
      const convention = resolveConvention(
        baseline.filter((instance) => instance.homogeneous),
        minInstances,
        dominanceThreshold,
      );
      if (!convention) continue;

      previewStyles ??= previewDoc.getStylesModel();
      const preview = collectInstances(previewDoc, previewStyles, construct, aiAuthor);

      // Which insertions are *this* mutation's: consume the pre-existing
      // AI-authored instances by fingerprint, exactly as
      // splitIntroducedDiagnostics consumes pre-existing diagnostics. What is
      // left over did not exist before this mutation ran.
      const remaining = new Map<string, number>();
      for (const instance of baseline) {
        if (instance.insertedRunTuples.length === 0) continue;
        const fp = instanceFingerprint(instance);
        remaining.set(fp, (remaining.get(fp) ?? 0) + 1);
      }

      const expected = tupleKey(convention.tuple);
      const share = Math.round((convention.modeCount / convention.total) * 100);
      const reported = new Set<string>();

      for (const instance of preview) {
        if (instance.insertedRunTuples.length === 0) continue;
        if (!insertedKeys.has(instance.key)) continue;
        const fp = instanceFingerprint(instance);
        const count = remaining.get(fp) ?? 0;
        if (count > 0) {
          remaining.set(fp, count - 1); // pre-existing; not this mutation's doing
          continue;
        }

        for (const tuple of instance.insertedRunTuples) {
          const actual = tupleKey(tuple);
          if (actual === expected) continue;
          const dedupeKey = `${instance.key}|${actual}`;
          if (reported.has(dedupeKey)) continue;
          reported.add(dedupeKey);

          warnings.push({
            construct,
            term: instance.label,
            message:
              `${FORMATTING_CONVENTION_WARNING_CODE}: inserted ${CONSTRUCT_LABELS[construct]} ` +
              `"${instance.label}" is ${describeTuple(tuple)}, but ` +
              `${convention.modeCount} of ${convention.total} (${share}%) of this document's ` +
              `${CONSTRUCT_LABELS[construct]}s are ${describeTuple(convention.tuple)} ` +
              `(construct=${construct})`,
          });
        }
      }
    }

    return warnings;
  } catch {
    // Advisory check: never let a scan failure surface as an edit failure.
    return [];
  }
}

/**
 * The construct keys present in `text`, for callers that must attribute a
 * warning back to the step that produced it (batch_edit preflights the whole
 * sequence at once, so the step is not otherwise recoverable).
 */
export function insertedConstructKeys(text: string): Map<ConventionConstruct, Set<string>> {
  const out = new Map<ConventionConstruct, Set<string>>();
  for (const construct of CONVENTION_CONSTRUCTS) {
    const keys = new Set(MATCHERS[construct](text).map((span) => span.key));
    if (keys.size > 0) out.set(construct, keys);
  }
  return out;
}
