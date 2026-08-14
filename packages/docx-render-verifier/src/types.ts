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

export type RenderVerdict = {
  status: Verdict;
  reason?: string;
  trackedSha256: string;
  renderedInputSha256?: string;
  transform?: { id: string; version: string; inputSha256: string; outputSha256: string };
  pdfPath?: string;
  reviewPngs: string[];
  markupTextMatchesPdf?: boolean;
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
