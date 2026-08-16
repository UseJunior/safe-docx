export type Verdict = 'pass' | 'fail' | 'not_run';

export type ToolResult = { code: number; stdout: string; stderr: string };

export type RendererTools = {
  resolve(name: 'soffice' | 'pdftotext' | 'pdftoppm' | 'magick'): string | null;
  run(command: string, args: string[], cwd?: string): Promise<ToolResult>;
};

export type RenderTransform = {
  id: string;
  version: string;
  apply(inputPath: string, renderWorkspace: string): Promise<string>;
};

export type PixelMeasurement = {
  sampledPixels: number;
  bluePixels: number;
  redPixels: number;
};

/**
 * Renderer-created pagination facts used to bound PDF text residue. All values
 * are derived from the rendered artifact and the rendered DOCX package itself,
 * never from the caller's expected markup projection.
 */
export type PaginationProfile = {
  /** Number of rasterized pages in the configured render. */
  pageCount: number;
  /** Per-page reservation quota: rendered token occurrence counts from referenced header and footer stories. */
  headerFooterTokenCounts: ReadonlyMap<string, number>;
  /** Per-page numeric reservation quota: PAGE-family field instructions in referenced header/footer stories. */
  headerFooterPageFieldCount: number;
  /** Whole-document numeric reservation quota: PAGE-family field instructions in body-layer stories. */
  bodyPageFieldCount: number;
  /** Highest integer accepted as a rendered page number (pageCount adjusted by any explicit numbering start). */
  pageNumberUpperBound: number;
};

/**
 * An emitted-OOXML-proven junction where a visible deletion-family revision
 * span (`w:del`/`w:moveFrom`) and a visible insertion-family revision span
 * (`w:ins`/`w:moveTo`) are adjacent with no whitespace between them.
 * LibreOffice and `pdftotext` do not expose a stable whitespace-delimited
 * token boundary at such a junction, so text binding may treat whitespace
 * there — and only there — as optional. The fragments are the maximal
 * non-whitespace character runs meeting at the junction in the story's own
 * character stream, so they can extend into neighbouring ordinary runs (for
 * example trailing punctuation attached to the insertion).
 */
export type AdjacentRevisionBoundary = {
  /** Maximal non-whitespace run ending exactly at the junction. */
  leftToken: string;
  /** Maximal non-whitespace run starting exactly at the junction. */
  rightToken: string;
};

/**
 * Structured outcome of the story-scoped text binding. Token samples are
 * bounded excerpts for diagnosis; `matched` is the binding verdict.
 */
export type TextBindingEvidence = {
  matched: boolean;
  /** Rendered page count the occurrence bounds were computed against. */
  pageCount: number;
  /** Bounded sample of expected tokens missing from the rendered PDF text. */
  missingTokenSample: string[];
  /** Bounded sample of rendered tokens not attributable to markup or pagination. */
  unexplainedTokenSample: string[];
  /**
   * Adjacent deletion/insertion junctions the emitted tracked OOXML declares
   * as eligible for optional-whitespace normalization. Derived from the
   * rendered package's revision markup, independent of pagination reservation.
   */
  declaredRevisionBoundaryCount: number;
  /**
   * Optional-whitespace normalizations actually applied at declared adjacent
   * revision boundaries (at most one per declared junction). Reported
   * separately from pagination reservation so a certificate consumer can
   * distinguish renderer whitespace tolerance from header/footer/page-number
   * accounting.
   */
  revisionBoundaryNormalizationCount: number;
};

export type RenderVerdict = {
  status: Verdict;
  reason?: string;
  trackedSha256: string;
  renderedInputSha256?: string;
  transform?: { id: string; version: string; inputSha256: string; outputSha256: string };
  pdfPath?: string;
  reviewPngs: string[];
  /** True when the story-scoped text binding matched; see `textBinding`. */
  markupTextMatchesPdf?: boolean;
  /** Structured text-binding evidence, reported separately from colour visibility. */
  textBinding?: TextBindingEvidence;
  configured?: PixelMeasurement;
  byAuthorControl?: PixelMeasurement;
  configuredContrastPassed?: boolean;
  revisionVisibility?: 'visible' | 'hidden-deletions' | 'insufficient-contrast';
};

export type RenderRequest = {
  /** Finished tracked DOCX; never modified by this package. */
  trackedDocxPath: string;
  /** Independent caller-owned markup projection, not DOCX-derived by this package. */
  expectedMarkupText: string;
  outputDir: string;
  reviewPages?: number[];
  transform?: RenderTransform;
  /** Per-colour calibrated pixel floor after downsampling. Defaults to 4. */
  configuredPixelFloor?: number;
  tools?: RendererTools;
};

export type PrivateCorpusCase = {
  label: string;
  trackedDocxPath: string;
  expectedMarkupTextPath: string;
  expectedTrackedSha256: string;
  expectedMarkupTextSha256?: string;
  requireRender: boolean;
};

export type PrivateCorpusManifest = {
  version: 1;
  outputDir: string;
  cases: PrivateCorpusCase[];
};

export type PrivateCorpusSummary = {
  version: 1;
  cases: Array<{ label: string; trackedSha256: string; status: Verdict; reason?: string }>;
};
