import { pathToFileURL } from 'url';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { File, Reporter, TaskResultPack, Vitest } from 'vitest';

type AllureReporterLike = {
  onInit?: (ctx?: Vitest) => void | Promise<void>;
  onFinished?: (files?: File[], errors?: unknown[]) => void | Promise<void>;
  onTaskUpdate?: (packs: TaskResultPack[]) => void | Promise<void>;
  onTestRunEnd?: (tests: Array<{ task: unknown }>) => void | Promise<void>;
};

type CompatReporterOptions = {
  innerReporterPath: string;
  resultsDir?: string;
  cleanResultsDir?: boolean;
  /** Used to replace the leading directory in the `package` label for proper Allure tree grouping. */
  packageName?: string;
  [key: string]: unknown;
};

/** Label names where allure-vitest auto-derives a value AND our setup adds one. Keep only the last. */
const DEDUPE_LABEL_NAMES = new Set(['parentSuite', 'suite', 'subSuite']);

export default class AllureVitestCompatReporter implements Reporter {
  private ctx: Vitest | undefined;
  private innerPromise: Promise<AllureReporterLike | null> | null = null;
  private cleanedResultsDir = false;
  private options: CompatReporterOptions;

  constructor(options?: CompatReporterOptions) {
    this.options = options ?? { innerReporterPath: '' };
  }

  onInit(ctx: Vitest): void {
    this.ctx = ctx;
    void this.ensureInnerReporter();
  }

  async onTaskUpdate(packs: TaskResultPack[]): Promise<void> {
    const inner = await this.ensureInnerReporter();
    if (inner?.onTaskUpdate) {
      await inner.onTaskUpdate(packs);
    }
  }

  async onFinished(files: File[] = [], errors: unknown[] = []): Promise<void> {
    const inner = await this.ensureInnerReporter();
    if (!inner) return;

    if (inner.onFinished) {
      await inner.onFinished(files, errors);
    } else if (inner.onTestRunEnd) {
      // allure-vitest >=3.4 uses onTestRunEnd, while Vitest 2 invokes onFinished.
      await inner.onTestRunEnd(files.map((file) => ({ task: file })));
    }

    // Post-process result files: de-duplicate suite labels and rewrite package labels
    // so the Allure tree groups by package name instead of directory name.
    await this.normalizeResultLabels();
  }

  private async normalizeResultLabels(): Promise<void> {
    const resultsDir = this.options.resultsDir as string | undefined;
    if (!resultsDir) return;

    const packageName = this.options.packageName as string | undefined;

    let entries: string[];
    try {
      entries = await readdir(resultsDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('-result.json')) continue;
      const filepath = join(resultsDir, entry);
      try {
        const raw = await readFile(filepath, 'utf-8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data.labels)) continue;

        let changed = false;

        // 1. De-duplicate suite labels: keep only the LAST value (from our setup beforeEach).
        for (const name of DEDUPE_LABEL_NAMES) {
          const indices: number[] = [];
          for (let i = 0; i < data.labels.length; i++) {
            if (data.labels[i].name === name) indices.push(i);
          }
          if (indices.length > 1) {
            const toRemove = new Set(indices.slice(0, -1));
            data.labels = data.labels.filter((_: unknown, i: number) => !toRemove.has(i));
            changed = true;
          }
        }

        // 2. Rewrite `package` label: replace leading directory (test/src) with packageName.
        if (packageName) {
          for (const label of data.labels) {
            if (label.name === 'package' && typeof label.value === 'string') {
              const parts = label.value.split('.');
              if (parts.length > 0 && (parts[0] === 'test' || parts[0] === 'src')) {
                parts[0] = packageName;
                label.value = parts.join('.');
                changed = true;
              }
            }
          }

          // 3. Rewrite `fullName` and `titlePath`: controls the Results page tree hierarchy.
          if (typeof data.fullName === 'string') {
            const rewritten = data.fullName.replace(/^(test|src)\//, `${packageName}/`);
            if (rewritten !== data.fullName) {
              data.fullName = rewritten;
              changed = true;
            }
          }
          if (Array.isArray(data.titlePath) && data.titlePath.length > 0
              && (data.titlePath[0] === 'test' || data.titlePath[0] === 'src')) {
            data.titlePath[0] = packageName;
            changed = true;
          }

          // 4. Strip filename from titlePath so the tree matches the breadcrumb hierarchy.
          //    Before: ['Safe DOCX MCP Server', 'parity.test.ts', 'describe block', ...]
          //    After:  ['Safe DOCX MCP Server', 'describe block', ...]
          if (Array.isArray(data.titlePath) && data.titlePath.length > 2
              && /\.\w+$/.test(data.titlePath[1])) {
            data.titlePath.splice(1, 1);
            changed = true;
          }
        }

        if (changed) {
          await writeFile(filepath, JSON.stringify(data));
        }
      } catch {
        // Skip malformed files.
      }
    }
  }

  private ensureInnerReporter(): Promise<AllureReporterLike | null> {
    if (this.innerPromise) return this.innerPromise;

    this.innerPromise = (async () => {
      await this.ensureResultsDirClean();

      const { innerReporterPath, ...innerOptions } = this.options;
      if (!innerReporterPath) {
        // eslint-disable-next-line no-console
        console.warn('[safe-docx-ts] Missing innerReporterPath for Allure compatibility reporter.');
        return null;
      }

      try {
        const mod = await import(pathToFileURL(innerReporterPath).href);
        const ReporterCtor = mod?.default;
        if (typeof ReporterCtor !== 'function') {
          // eslint-disable-next-line no-console
          console.warn(
            `[safe-docx-ts] Allure reporter at '${innerReporterPath}' has no default class export.`,
          );
          return null;
        }

        const inner = new ReporterCtor(innerOptions) as AllureReporterLike;
        if (inner.onInit) {
          await inner.onInit(this.ctx);
        }
        return inner;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[safe-docx-ts] Failed to load Allure reporter '${innerReporterPath}': ${String(error)}`,
        );
        return null;
      }
    })();

    return this.innerPromise;
  }

  private async ensureResultsDirClean(): Promise<void> {
    if (this.cleanedResultsDir) {
      return;
    }
    this.cleanedResultsDir = true;

    if (!this.options.cleanResultsDir) {
      return;
    }

    const resultsDir = this.options.resultsDir;
    if (!resultsDir) {
      return;
    }

    try {
      await rm(resultsDir, { recursive: true, force: true });
      await mkdir(resultsDir, { recursive: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[safe-docx-ts] Failed to clean results dir '${resultsDir}': ${String(error)}`,
      );
    }
  }
}
