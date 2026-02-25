export interface CompatReporterOptions {
  innerReporterPath: string;
  resultsDir?: string;
  cleanResultsDir?: boolean;
  packageName?: string;
  packageNameOverrides?: Record<string, string>;
  [key: string]: unknown;
}

export default class AllureVitestCompatReporter {
  constructor(options?: CompatReporterOptions);
  onInit(ctx: unknown): void;
  onTaskUpdate(packs: unknown[]): Promise<void>;
  onFinished(files?: unknown[], errors?: unknown[]): Promise<void>;
}
