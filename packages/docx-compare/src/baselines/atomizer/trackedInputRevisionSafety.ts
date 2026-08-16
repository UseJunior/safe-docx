import {
  DocxZip,
  OOXML,
  enumerateRevisionStoryPartPaths,
  parseXml,
} from '@usejunior/docx-core';

/**
 * Revision-markup local names (WordprocessingML namespace) whose presence in a
 * comparison input means the document already carries tracked changes: the
 * four content markers, the six property-change records, the three
 * cell-topology records, and the legacy numbering-change record. Row-level
 * markers (`w:trPr > w:ins|w:del`) share the same local names and are
 * detected by the same scan. The cell and numbering records were
 * execution-proven (peer review of #742) to otherwise pass through the
 * comparison with their original author intact.
 *
 * Deliberately NOT detection triggers: the range-boundary markers
 * (`w:moveFromRangeStart`/`End`, `w:moveToRangeStart`/`End`) and the
 * `w:customXml*Range*` markers. They carry no run content or author-bearing
 * wrapper of their own; content-bearing moves are caught via `w:moveFrom` /
 * `w:moveTo`, and an isolated range pair was execution-observed to be dropped
 * by the comparison rather than passed through as another author's markup.
 */
const TRACKED_REVISION_LOCAL_NAMES = [
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'cellIns',
  'cellDel',
  'cellMerge',
  'numberingChange',
] as const;

/** Which comparison operand a tracked-input detection refers to. */
export type ComparisonOperandName = 'original' | 'revised';

/** One fail-closed detection produced by the tracked-input scan. */
export interface TrackedInputRevisionDetection {
  /** The comparison operand the finding is about. */
  operand: ComparisonOperandName;
  /** The package part in which revision markup was found. */
  partPath: string;
  /** The revision element names present in the part (e.g. `w:ins`, `w:del`). */
  markers: string[];
}

/**
 * Typed recoverable refusal raised when a comparison input already contains
 * tracked-changes markup. Comparing such an input silently merges two
 * authors' revision trees into one document — an output Microsoft Word
 * refuses to open — so the comparison boundary fails closed instead. Accept
 * or reject the input's existing revisions, then retry the comparison.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/742
 */
export class TrackedInputRevisionError extends Error {
  readonly operand: ComparisonOperandName;
  readonly partPath: string;
  readonly markers: string[];

  constructor(detection: TrackedInputRevisionDetection) {
    const { operand, partPath, markers } = detection;
    super(
      `The ${operand} document already contains tracked changes ` +
        `(${markers.join(', ')} in ${partPath}). Comparing it would merge ` +
        `two authors' revision markup into one output, which Microsoft Word ` +
        `refuses to open. Accept or reject the ${operand} document's ` +
        `tracked changes, then retry the comparison.`,
    );
    this.name = 'TrackedInputRevisionError';
    this.operand = operand;
    this.partPath = partPath;
    this.markers = markers;
  }
}

function trackedRevisionMarkers(xml: string): string[] {
  const document = parseXml(xml);
  return TRACKED_REVISION_LOCAL_NAMES.filter(
    (localName) =>
      document.getElementsByTagNameNS(OOXML.W_NS, localName).length > 0,
  ).map((localName) => `w:${localName}`);
}

async function findTrackedRevisionMarkup(
  buffer: Buffer,
  operand: ComparisonOperandName,
): Promise<TrackedInputRevisionDetection | undefined> {
  const zip = await DocxZip.load(buffer);
  const partPaths = new Set<string>([
    'word/document.xml',
    ...enumerateRevisionStoryPartPaths(zip),
  ]);
  for (const partPath of [...partPaths].sort()) {
    const xml = await zip.readTextOrNull(partPath);
    if (xml === null) continue;
    let markers: string[];
    try {
      markers = trackedRevisionMarkers(xml);
    } catch {
      // A part this scan cannot parse is not claimed by this guard: the
      // package-level ancillary safety boundary owns malformed-part failures
      // and reports them with precise typed diagnostics (for example
      // AncillaryStorySafetyError / NOTE_PART_XML_INVALID for a truncated
      // notes part). Pre-empting those here would replace a stable, specific
      // error with a vaguer one — the same rule textBoxRevisionSafety applies
      // to its preparatory scan.
      continue;
    }
    if (markers.length > 0) return { operand, partPath, markers };
  }
  return undefined;
}

/**
 * Fail closed when either comparison input already contains tracked-changes
 * markup. The comparison engine passes pre-existing revisions through rather
 * than accepting them before diffing, so a tracked input yields an output with
 * two revision authors and (edit-density permitting) directly nested revision
 * elements — a package Microsoft Word rejects as unreadable while the compare
 * still exits 0 with normal stats.
 *
 * The scan covers `word/document.xml` plus every revision story part the
 * package holds — footnotes, endnotes, comments, the glossary document, and
 * each numbered header/footer part — and detects the four content markers
 * (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`), the six property-change
 * records (`w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`,
 * `w:trPrChange`, `w:tcPrChange`), the cell-topology records (`w:cellIns`,
 * `w:cellDel`, `w:cellMerge`), and `w:numberingChange`; see
 * {@link TRACKED_REVISION_LOCAL_NAMES} for the range-marker records that are
 * deliberately not triggers. Missing parts are skipped. Parts that fail
 * to parse are also skipped by this guard: malformed-part failures belong to
 * the package-level ancillary safety boundary, whose typed diagnostics this
 * preparatory scan must not pre-empt. The original operand is scanned first,
 * so when both inputs are tracked the error names the original.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/742
 */
export async function assertComparisonInputsUntracked(
  original: Buffer,
  revised: Buffer,
): Promise<void> {
  const detection =
    (await findTrackedRevisionMarkup(original, 'original')) ??
    (await findTrackedRevisionMarkup(revised, 'revised'));
  if (detection) throw new TrackedInputRevisionError(detection);
}
