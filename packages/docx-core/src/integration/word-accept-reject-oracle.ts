/**
 * Microsoft Word Accept All / Reject All oracle: the Word-free half.
 *
 * The opt-in runner in `scripts/oracle/word/accept-reject/` drives Word 16 for Mac through
 * AppleScript and hands the saved packages to this module, which decides whether our accept and
 * reject agree with Word. Everything here is pure (or touches only a lockfile), so it is unit
 * tested in the normal suite without Word.
 *
 * The comparison is a projection, not a byte diff. Word rewrites every part it saves (rsids,
 * relationship ids, part names, compatibility settings), so the oracle compares what a reader
 * sees:
 * - the number of live sections (a `w:sectPr` inside `w:sectPrChange` is a snapshot, not a section);
 * - each section's page setup (`w:pgSz`, `w:pgMar`) and `w:titlePg`;
 * - each section's header and footer bindings for the default, first and even types, resolved
 *   through the relationships to the bound part's text, with linked-to-previous inheritance
 *   applied (ECMA-376 Part 1 § 17.10.5);
 * - the text of every body paragraph in document order;
 * - how many tracked revisions are left (both sides should have none after Accept/Reject All).
 *
 * Word fills in page setup on save when a section has none. A page-size or margin block missing on
 * one side is therefore a note when the other side holds a value Word writes by default (Letter or
 * A4, portrait, with Word's default margins), and a mismatch otherwise. Accept All and Reject All
 * must leave no tracked revision, in Word's output or in ours.
 *
 * Deliberately NOT part of the package's public API: the runner imports it from
 * `dist/integration/`.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/1144
 */
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseXml } from '../primitives/xml.js';
import { acquireSofficeLock } from './soffice-lock.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

export type OracleMode = 'accept' | 'reject';
export const ORACLE_MODES: readonly OracleMode[] = ['accept', 'reject'];

export const BINDING_KEYS = [
  'header.default', 'header.first', 'header.even',
  'footer.default', 'footer.first', 'footer.even',
] as const;
export type BindingKey = typeof BINDING_KEYS[number];

export interface PageSize { w: number | null; h: number | null; orient: 'portrait' | 'landscape' }
export interface PageMargins {
  top: number | null; right: number | null; bottom: number | null; left: number | null;
  header: number | null; footer: number | null; gutter: number | null;
}

export interface SectionProjection {
  pageSize: PageSize | null;
  pageMargins: PageMargins | null;
  titlePage: boolean;
  /** Resolved story text per binding; null when no section so far binds that type. */
  bindings: Record<BindingKey, string | null>;
}

export interface DocumentProjection {
  sections: SectionProjection[];
  paragraphs: string[];
  /** Tracked-revision elements left in the body, headers, footers and notes. */
  revisionsRemaining: number;
}

/** Elements that record a tracked revision (ECMA-376 Part 1 § 17.13.5). */
const REVISION_ELEMENTS = new Set([
  'ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange',
  'tblPrExChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'numberingChange', 'cellIns', 'cellDel',
  'cellMerge',
]);

const STORY_PART = /^word\/(header|footer)\d*\.xml$|^word\/(footnotes|endnotes)\.xml$/;

function wChildren(element: Element): Element[] {
  const out: Element[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W_NS) out.push(node as Element);
  }
  return out;
}

function wAttr(element: Element, name: string): string | null {
  return element.getAttributeNS(W_NS, name) || element.getAttribute(`w:${name}`) || null;
}

function intAttr(element: Element | undefined, name: string): number | null {
  if (!element) return null;
  const raw = wAttr(element, name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** ST_OnOff: absent `w:val` or a true value is on (ECMA-376 Part 1 § 17.17.4). */
function onOff(element: Element | undefined): boolean {
  if (!element) return false;
  const value = wAttr(element, 'val');
  return value === null || ['1', 'true', 'on'].includes(value);
}

function hasAncestor(element: Element, localNames: ReadonlySet<string>, stopAt: Element): boolean {
  for (let node = element.parentNode as Element | null; node && node !== stopAt; node = node.parentNode as Element | null) {
    if (node.nodeType === 1 && localNames.has(node.localName)) return true;
  }
  return false;
}

/** Paragraphs that belong to a nested story (text boxes) or an alternate-content fallback copy. */
const NESTED_STORY = new Set(['txbxContent', 'Fallback']);

/** The visible text of one paragraph: `w:t`, tabs and breaks. Deleted and field-code text is excluded. */
export function paragraphText(paragraph: Element): string {
  let text = '';
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (NESTED_STORY.has(element.localName) || (element.namespaceURI === W_NS && element.localName === 'p')) continue;
      if (element.namespaceURI === W_NS) {
        if (element.localName === 't') { text += element.textContent ?? ''; continue; }
        if (element.localName === 'tab') { text += '\t'; continue; }
        if (element.localName === 'br' || element.localName === 'cr') { text += '\n'; continue; }
        if (element.localName === 'noBreakHyphen') { text += '-'; continue; }
      }
      walk(element);
    }
  };
  walk(paragraph);
  return text;
}

function storyParagraphs(root: Element): string[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, 'p'))
    .filter((p) => !hasAncestor(p, NESTED_STORY, root))
    .map(paragraphText);
}

function countRevisions(root: Element): number {
  let count = 0;
  for (const element of Array.from(root.getElementsByTagNameNS(W_NS, '*'))) {
    if (REVISION_ELEMENTS.has(element.localName)) count += 1;
  }
  return count;
}

async function readPart(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async('string') : null;
}

/** Resolve a relationship target against `word/` (relative) or the package root (absolute). */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join('word', target));
}

function isLiveSection(sectPr: Element): boolean {
  const parent = sectPr.parentNode as Element | null;
  if (!parent) return false;
  if (parent.localName === 'body') return true;
  return parent.localName === 'pPr' && (parent.parentNode as Element | null)?.localName === 'p';
}

function projectPageSize(sectPr: Element): PageSize | null {
  const pgSz = wChildren(sectPr).find((c) => c.localName === 'pgSz');
  if (!pgSz) return null;
  return { w: intAttr(pgSz, 'w'), h: intAttr(pgSz, 'h'), orient: wAttr(pgSz, 'orient') === 'landscape' ? 'landscape' : 'portrait' };
}

function projectPageMargins(sectPr: Element): PageMargins | null {
  const pgMar = wChildren(sectPr).find((c) => c.localName === 'pgMar');
  if (!pgMar) return null;
  return {
    top: intAttr(pgMar, 'top'), right: intAttr(pgMar, 'right'), bottom: intAttr(pgMar, 'bottom'),
    left: intAttr(pgMar, 'left'), header: intAttr(pgMar, 'header'), footer: intAttr(pgMar, 'footer'),
    gutter: intAttr(pgMar, 'gutter'),
  };
}

function emptyBindings(): Record<BindingKey, string | null> {
  return Object.fromEntries(BINDING_KEYS.map((key) => [key, null])) as Record<BindingKey, string | null>;
}

/** Project a .docx package to the reader-visible shape the oracle compares. */
export async function projectDocx(bytes: Uint8Array): Promise<DocumentProjection> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await readPart(zip, 'word/document.xml');
  if (documentXml === null) throw new Error('package has no word/document.xml');
  const document = parseXml(documentXml);
  const body = document.getElementsByTagNameNS(W_NS, 'body').item(0);
  if (!body) throw new Error('word/document.xml has no w:body');

  const targets = new Map<string, string>();
  const relsXml = await readPart(zip, 'word/_rels/document.xml.rels');
  if (relsXml !== null) {
    for (const rel of Array.from(parseXml(relsXml).getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target && rel.getAttribute('TargetMode') !== 'External') targets.set(id, resolveTarget(target));
    }
  }

  const storyText = new Map<string, string>();
  const resolveStory = async (relId: string): Promise<string> => {
    const part = targets.get(relId);
    if (!part) return `<missing relationship ${relId}>`;
    const cached = storyText.get(part);
    if (cached !== undefined) return cached;
    const xml = await readPart(zip, part);
    const text = xml === null ? `<missing part ${part}>` : storyParagraphs(parseXml(xml).documentElement as unknown as Element).join('\n');
    storyText.set(part, text);
    return text;
  };

  const sections: SectionProjection[] = [];
  let inherited = emptyBindings();
  for (const sectPr of Array.from(body.getElementsByTagNameNS(W_NS, 'sectPr'))) {
    if (!isLiveSection(sectPr)) continue;
    const bindings = { ...inherited };
    for (const child of wChildren(sectPr)) {
      if (child.localName !== 'headerReference' && child.localName !== 'footerReference') continue;
      const kind = child.localName === 'headerReference' ? 'header' : 'footer';
      const type = wAttr(child, 'type') ?? 'default';
      const key = `${kind}.${type}` as BindingKey;
      if (!BINDING_KEYS.includes(key)) continue;
      const relId = child.getAttributeNS(R_NS, 'id') || child.getAttribute('r:id') || '';
      bindings[key] = await resolveStory(relId);
    }
    inherited = bindings;
    sections.push({
      pageSize: projectPageSize(sectPr),
      pageMargins: projectPageMargins(sectPr),
      titlePage: onOff(wChildren(sectPr).find((c) => c.localName === 'titlePg')),
      bindings,
    });
  }

  const paragraphs = storyParagraphs(body as unknown as Element);

  let revisionsRemaining = countRevisions(body as unknown as Element);
  for (const name of Object.keys(zip.files).filter((n) => STORY_PART.test(n)).sort()) {
    const xml = await readPart(zip, name);
    if (xml !== null) revisionsRemaining += countRevisions(parseXml(xml).documentElement as unknown as Element);
  }

  return { sections, paragraphs, revisionsRemaining };
}

export interface ProjectionDifference {
  /** Where the projections differ, e.g. `sections[1].bindings.header.first`. */
  path: string;
  /** Word's value (the reference). */
  expected: unknown;
  /** Our value. */
  actual: unknown;
  /** `note` differences are tolerated and reported only for context. */
  severity: 'mismatch' | 'note';
}

const MAX_PARAGRAPH_DIFFERENCES = 5;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Page setup Word writes for a section that has none (US Letter and A4 locales). */
export const WORD_DEFAULT_PAGE_SIZES: readonly PageSize[] = [
  { w: 12240, h: 15840, orient: 'portrait' },
  { w: 11906, h: 16838, orient: 'portrait' },
];
export const WORD_DEFAULT_PAGE_MARGINS: readonly PageMargins[] = [
  { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720, gutter: 0 },
  { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 },
];

function isWordDefault(field: 'pageSize' | 'pageMargins', value: PageSize | PageMargins): boolean {
  const defaults: readonly unknown[] = field === 'pageSize' ? WORD_DEFAULT_PAGE_SIZES : WORD_DEFAULT_PAGE_MARGINS;
  return defaults.some((d) => same(d, value));
}

/**
 * Compare a reference projection (Word, or the expected document) with ours. Returns every
 * difference; callers treat `mismatch` entries as failures and `note` entries as context.
 */
export function diffProjections(expected: DocumentProjection, actual: DocumentProjection): ProjectionDifference[] {
  const out: ProjectionDifference[] = [];
  const mismatch = (p: string, e: unknown, a: unknown): void => { out.push({ path: p, expected: e, actual: a, severity: 'mismatch' }); };

  if (expected.sections.length !== actual.sections.length) {
    mismatch('sections.length', expected.sections.length, actual.sections.length);
  } else {
    expected.sections.forEach((e, i) => {
      const a = actual.sections[i]!;
      const at = `sections[${i}]`;
      for (const field of ['pageSize', 'pageMargins'] as const) {
        if (same(e[field], a[field])) continue;
        const present = e[field] ?? a[field];
        if ((e[field] === null || a[field] === null) && present && isWordDefault(field, present)) {
          out.push({ path: `${at}.${field}`, expected: e[field], actual: a[field], severity: 'note' });
        } else {
          mismatch(`${at}.${field}`, e[field], a[field]);
        }
      }
      if (e.titlePage !== a.titlePage) mismatch(`${at}.titlePage`, e.titlePage, a.titlePage);
      for (const key of BINDING_KEYS) {
        if (e.bindings[key] !== a.bindings[key]) mismatch(`${at}.bindings.${key}`, e.bindings[key], a.bindings[key]);
      }
    });
  }

  if (expected.paragraphs.length !== actual.paragraphs.length) {
    mismatch('paragraphs.length', expected.paragraphs.length, actual.paragraphs.length);
    const first = expected.paragraphs.findIndex((text, i) => actual.paragraphs[i] !== text);
    const index = first === -1 ? expected.paragraphs.length : first;
    mismatch(`paragraphs[${index}]`, expected.paragraphs[index] ?? null, actual.paragraphs[index] ?? null);
  } else {
    let reported = 0;
    expected.paragraphs.forEach((text, i) => {
      if (text !== actual.paragraphs[i] && reported++ < MAX_PARAGRAPH_DIFFERENCES) mismatch(`paragraphs[${i}]`, text, actual.paragraphs[i]);
    });
    if (reported > MAX_PARAGRAPH_DIFFERENCES) {
      mismatch('paragraphs.differing', MAX_PARAGRAPH_DIFFERENCES, reported);
    }
  }

  // Accept All and Reject All resolve every revision; equal leftovers on both sides are not a match.
  if (expected.revisionsRemaining !== 0) mismatch('reference.revisionsRemaining', 0, expected.revisionsRemaining);
  if (actual.revisionsRemaining !== 0) mismatch('revisionsRemaining', 0, actual.revisionsRemaining);
  return out;
}

/** A fixed ZIP entry date, so re-zipped packages depend only on their content. */
export const FIXED_ZIP_DATE = new Date('2026-01-01T00:00:00Z');

/**
 * Apply an XML-string projection (for example docx-compare's `acceptAllChanges`, which works on
 * one part at a time) to `word/document.xml` and every header, footer and note part that carries
 * a tracked revision, returning the re-zipped package.
 */
export async function applyToStoryParts(bytes: Uint8Array, project: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).sort()) {
    if (name !== 'word/document.xml' && !STORY_PART.test(name)) continue;
    const xml = await zip.file(name)!.async('string');
    if (name !== 'word/document.xml' && countRevisions(parseXml(xml).documentElement as unknown as Element) === 0) continue;
    zip.file(name, project(xml), { date: FIXED_ZIP_DATE });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * sha256 over the sorted entry names and their uncompressed bytes. Two packages with the same
 * parts hash the same however they were zipped (dates, compression, entry order).
 */
export async function packageContentHash(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const hash = createHash('sha256');
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name]!;
    if (entry.dir) continue;
    hash.update(`${name}\0`);
    const content = await entry.async('uint8array');
    hash.update(`${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

export type WordFailureKind = 'PERMISSION' | 'STALL' | 'UNAVAILABLE' | 'NOT_FOUND' | 'UNRESOLVED' | 'OTHER';

export interface WordFailure { kind: WordFailureKind; message: string }

/**
 * Classify a failed `osascript` call against Word into something a developer can act on.
 * `stdout` carries the script's own result (`NOT FOUND` when Word opened nothing at that path).
 */
export function classifyOsascriptFailure(
  { stderr = '', stdout = '', timedOut = false, timeoutSeconds }: { stderr?: string; stdout?: string; timedOut?: boolean; timeoutSeconds?: number },
): WordFailure {
  const text = `${stderr}\n${stdout}`;
  if (/-1743\b|not authori[sz]ed to send apple events/i.test(text)) {
    return {
      kind: 'PERMISSION',
      message: 'This terminal is not allowed to control Microsoft Word (AppleEvent error -1743). Allow it in '
        + 'System Settings > Privacy & Security > Automation, then rerun.',
    };
  }
  if (timedOut || /-1712\b|AppleEvent timed out/i.test(text)) {
    return {
      kind: 'STALL',
      message: `Word did not answer${timeoutSeconds ? ` within ${timeoutSeconds}s` : ''}. It is probably showing a modal `
        + 'dialog (file access, repair, or a save prompt) or is busy with another client; check Word and rerun.',
    };
  }
  if (/-600\b|-609\b|-10810\b|-10827\b|application isn.t running|connection is invalid/i.test(text)) {
    return { kind: 'UNAVAILABLE', message: 'Microsoft Word is not running or quit during the call; start Word and rerun.' };
  }
  if (/NOT FOUND/.test(stdout)) {
    return { kind: 'NOT_FOUND', message: 'Word did not open the staged document (it may have shown a dialog instead).' };
  }
  const detail = stderr.trim() || stdout.trim() || 'no output';
  return { kind: 'OTHER', message: `osascript failed: ${detail}` };
}

/** Thrown by a Word driver when one Accept/Reject call fails. */
export class WordAutomationError extends Error {
  readonly kind: WordFailureKind;
  constructor(failure: WordFailure) {
    super(failure.message);
    this.name = 'WordAutomationError';
    this.kind = failure.kind;
  }
}

/** Word's sandbox container: files under it open without the Grant File Access prompt. */
export function wordContainerDataDir(home = os.homedir()): string {
  return path.join(home, 'Library', 'Containers', 'com.microsoft.Word', 'Data');
}

/** The machine-wide lockfile that serializes this oracle's Word sessions. */
export function wordOracleLockPath(home = os.homedir()): string {
  return path.join(wordContainerDataDir(home), 'safe-docx-word-oracle.lock');
}

/**
 * Run `fn` while holding the Word oracle's cross-process lock: the acquisition protocol from
 * `soffice-lock.ts` on its own lockfile, with two differences from the LibreOffice launchers.
 * A live holder is never treated as stale, however long its run takes (only a dead holder's lock
 * is reclaimed); a lockfile whose holder cannot be read is never reclaimed either (the waiter times
 * out naming it); and a lockfile that cannot be created fails the run instead of running unlocked.
 */
export async function withWordLock<T>(
  fn: () => Promise<T>,
  { lockPath = wordOracleLockPath(), timeoutMs = 30 * 60_000, pollMs }: { lockPath?: string; timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  let release: () => Promise<void>;
  try {
    release = await acquireSofficeLock(lockPath, {
      timeoutMs, pollMs, staleMs: Number.POSITIVE_INFINITY, unreadableGraceMs: Number.POSITIVE_INFINITY,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/Timed out/.test(message)) {
      throw new Error(`Another Word oracle run holds ${lockPath}; gave up after ${Math.round(timeoutMs / 1000)}s. (${message})`);
    }
    throw new Error(`Cannot take the Word oracle lock ${lockPath}: ${message}`);
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

export interface OracleCase {
  suite: string;
  id: string;
  /** The tracked document Word and our implementations resolve. */
  input: () => Promise<Uint8Array>;
  modes: readonly OracleMode[];
  /** Round-trip cases: what each mode must reproduce (Reject All → original, Accept All → revised). */
  expected?: Partial<Record<OracleMode, () => Promise<Uint8Array>>>;
}

export interface OracleImplementation {
  name: string;
  apply: (input: Uint8Array, mode: OracleMode) => Promise<Uint8Array>;
}

export type WordDriver = (job: { suite: string; caseId: string; mode: OracleMode; input: Uint8Array }) =>
  Promise<{ output: Uint8Array; cached: boolean; seconds: number }>;

export interface CheckResult {
  /** `docx-core`, `docx-compare`, or `word-vs-expected`. */
  name: string;
  differences: ProjectionDifference[];
  error?: string;
}

export type UnitStatus = 'MATCH' | 'MISMATCH' | 'XFAIL' | 'XPASS' | 'ERROR';

export interface UnitResult {
  suite: string;
  caseId: string;
  mode: OracleMode;
  status: UnitStatus;
  word: { cached: boolean; seconds: number } | { error: string; kind: WordFailureKind | 'HARNESS' };
  checks: CheckResult[];
  /** Why a known divergence is expected, when one applies. */
  knownDivergence?: string;
}

export interface OracleRunResult { units: UnitResult[]; aborted?: string }

/** `<caseId>:<mode>` → reason. A listed unit that mismatches is XFAIL; one that matches is XPASS. */
export type KnownDivergences = Readonly<Record<string, string>>;

function failed(check: CheckResult): boolean {
  return Boolean(check.error) || check.differences.some((d) => d.severity === 'mismatch');
}

/**
 * Run every case × mode through Word and through each implementation, and compare projections.
 * Word failures of kind PERMISSION or UNAVAILABLE abort the run: every later call would fail the
 * same way.
 */
export async function runAcceptRejectOracle({
  cases, word, implementations, knownDivergences = {}, onUnit,
}: {
  cases: readonly OracleCase[];
  word: WordDriver;
  implementations: readonly OracleImplementation[];
  knownDivergences?: KnownDivergences;
  onUnit?: (unit: UnitResult, index: number, total: number) => void;
}): Promise<OracleRunResult> {
  const total = cases.reduce((n, c) => n + c.modes.length, 0);
  const units: UnitResult[] = [];
  for (const oracleCase of cases) {
    let input: Uint8Array | undefined;
    let inputError: string | undefined;
    try {
      input = await oracleCase.input();
    } catch (err) {
      inputError = `could not build the input: ${(err as Error).message}`;
    }
    for (const mode of oracleCase.modes) {
      const key = `${oracleCase.id}:${mode}`;
      const unit: UnitResult = { suite: oracleCase.suite, caseId: oracleCase.id, mode, status: 'MATCH', word: { cached: false, seconds: 0 }, checks: [] };
      if (knownDivergences[key]) unit.knownDivergence = knownDivergences[key];
      if (!input) {
        unit.status = 'ERROR';
        unit.word = { error: inputError!, kind: 'HARNESS' };
      } else {
        let wordProjection: DocumentProjection | undefined;
        try {
          const run = await word({ suite: oracleCase.suite, caseId: oracleCase.id, mode, input });
          unit.word = { cached: run.cached, seconds: run.seconds };
          wordProjection = await projectDocx(run.output);
          if (wordProjection.revisionsRemaining > 0) {
            throw new WordAutomationError({
              kind: 'UNRESOLVED',
              message: `Word's ${mode === 'accept' ? 'Accept' : 'Reject'} All left ${wordProjection.revisionsRemaining} tracked revision(s); its output is not a valid reference.`,
            });
          }
        } catch (err) {
          wordProjection = undefined;
          const kind = err instanceof WordAutomationError ? err.kind : 'HARNESS';
          unit.status = 'ERROR';
          unit.word = { error: (err as Error).message, kind };
        }
        if (wordProjection) {
          const expectedSide = oracleCase.expected?.[mode];
          if (expectedSide) unit.checks.push(await check('word-vs-expected', async () => diffProjections(await projectDocx(await expectedSide()), wordProjection!)));
          for (const impl of implementations) {
            unit.checks.push(await check(impl.name, async () => diffProjections(wordProjection!, await projectDocx(await impl.apply(input!, mode)))));
          }
          const anyFailed = unit.checks.some(failed);
          if (unit.knownDivergence) unit.status = anyFailed ? 'XFAIL' : 'XPASS';
          else unit.status = anyFailed ? 'MISMATCH' : 'MATCH';
        }
      }
      units.push(unit);
      onUnit?.(unit, units.length, total);
      if ('error' in unit.word && (unit.word.kind === 'PERMISSION' || unit.word.kind === 'UNAVAILABLE')) {
        return { units, aborted: unit.word.error };
      }
    }
  }
  return { units };
}

async function check(name: string, run: () => Promise<ProjectionDifference[]>): Promise<CheckResult> {
  try {
    return { name, differences: await run() };
  } catch (err) {
    return { name, differences: [], error: (err as Error).message };
  }
}

/** 0 = everything matched (or failed as listed), 1 = a mismatch or stale XFAIL, 2 = Word/harness error. */
export function oracleExitCode(result: OracleRunResult): 0 | 1 | 2 {
  if (result.aborted || result.units.some((u) => u.status === 'ERROR')) return 2;
  if (result.units.some((u) => u.status === 'MISMATCH' || u.status === 'XPASS')) return 1;
  return 0;
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'undefined';
}

/** One progress line per unit. */
export function formatUnitLine(unit: UnitResult, index: number, total: number): string {
  const word = 'error' in unit.word
    ? `word ${unit.word.kind}`
    : `word ${unit.word.cached ? 'cached' : `ran ${unit.word.seconds.toFixed(1)}s`}`;
  const checks = unit.checks.map((c) => `${c.name} ${c.error ? 'ERROR' : failed(c) ? 'MISMATCH' : 'MATCH'}`);
  return `[${index}/${total}] ${unit.suite} ${unit.caseId} ${unit.mode}: ${[word, ...checks].join(' | ')} => ${unit.status}`;
}

/** The end-of-run report: per-suite tallies, then the details of every unit that did not match. */
export function formatOracleReport(result: OracleRunResult, { wordVersion }: { wordVersion?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`Word Accept/Reject oracle${wordVersion ? ` (Microsoft Word ${wordVersion})` : ''}`);
  const suites = [...new Set(result.units.map((u) => u.suite))];
  for (const suite of suites) {
    const units = result.units.filter((u) => u.suite === suite);
    const tally = (status: UnitStatus): number => units.filter((u) => u.status === status).length;
    const extra = (['XFAIL', 'XPASS', 'MISMATCH', 'ERROR'] as const)
      .filter((s) => tally(s) > 0).map((s) => `${tally(s)} ${s}`);
    lines.push(`  ${suite}: ${tally('MATCH')}/${units.length} match${extra.length ? ` (${extra.join(', ')})` : ''}`);
  }
  if (result.aborted) lines.push(`  ABORTED: ${result.aborted}`);
  for (const unit of result.units.filter((u) => u.status !== 'MATCH')) {
    lines.push('');
    lines.push(`${unit.status} ${unit.suite} ${unit.caseId} ${unit.mode}`);
    if (unit.knownDivergence) lines.push(`  known divergence: ${unit.knownDivergence}`);
    if ('error' in unit.word) lines.push(`  word: ${unit.word.kind}: ${unit.word.error}`);
    for (const c of unit.checks) {
      if (c.error) { lines.push(`  ${c.name}: ERROR ${c.error}`); continue; }
      for (const d of c.differences) {
        lines.push(`  ${c.name}: ${d.severity === 'note' ? 'note ' : ''}${d.path}: expected ${show(d.expected)}, got ${show(d.actual)}`);
      }
    }
  }
  return lines.join('\n');
}
