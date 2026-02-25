import { pathToFileURL } from 'url';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

/** Label names where allure-vitest auto-derives a value AND our setup adds one. Keep only the last. */
const DEDUPE_LABEL_NAMES = new Set(['parentSuite', 'suite', 'subSuite']);

/**
 * Resolve a prefix directory name to a display name.
 * @param {string} prefix - The leading directory segment (e.g. 'src', 'test', 'test-primitives')
 * @param {Record<string, string> | undefined} overrides - Optional map from prefix → display name
 * @param {string | undefined} packageName - Default display name for standard prefixes
 * @returns {string | null} - The resolved display name, or null if prefix should not be rewritten
 */
function resolvePrefix(prefix, overrides, packageName) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, prefix)) {
    return overrides[prefix];
  }
  if (prefix === 'test' || prefix === 'src') {
    return packageName || null;
  }
  return null;
}

export default class AllureVitestCompatReporter {
  /** @type {unknown} */
  ctx;
  /** @type {Promise<object | null> | null} */
  innerPromise = null;
  /** @type {boolean} */
  cleanedResultsDir = false;
  /** @type {object} */
  options;

  constructor(options) {
    this.options = options ?? { innerReporterPath: '' };
  }

  onInit(ctx) {
    this.ctx = ctx;
    void this.ensureInnerReporter();
  }

  async onTaskUpdate(packs) {
    const inner = await this.ensureInnerReporter();
    if (inner?.onTaskUpdate) {
      await inner.onTaskUpdate(packs);
    }
  }

  async onFinished(files = [], errors = []) {
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

  async normalizeResultLabels() {
    const resultsDir = this.options.resultsDir;
    if (!resultsDir) return;

    const packageName = this.options.packageName;
    const overrides = this.options.packageNameOverrides;

    let entries;
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
          const indices = [];
          for (let i = 0; i < data.labels.length; i++) {
            if (data.labels[i].name === name) indices.push(i);
          }
          if (indices.length > 1) {
            const toRemove = new Set(indices.slice(0, -1));
            data.labels = data.labels.filter((_, i) => !toRemove.has(i));
            changed = true;
          }
        }

        // 2. Rewrite `package` label: replace leading directory with resolved name.
        if (packageName) {
          for (const label of data.labels) {
            if (label.name === 'package' && typeof label.value === 'string') {
              const parts = label.value.split('.');
              if (parts.length > 0) {
                const resolved = resolvePrefix(parts[0], overrides, packageName);
                if (resolved !== null) {
                  parts[0] = resolved;
                  label.value = parts.join('.');
                  changed = true;
                }
              }
            }
          }

          // 3. Rewrite `fullName`: controls the Results page tree hierarchy.
          if (typeof data.fullName === 'string') {
            const slashIdx = data.fullName.indexOf('/');
            if (slashIdx !== -1) {
              const prefix = data.fullName.slice(0, slashIdx);
              const resolved = resolvePrefix(prefix, overrides, packageName);
              if (resolved !== null) {
                data.fullName = resolved + data.fullName.slice(slashIdx);
                changed = true;
              }
            }
          }

          // 4. Rewrite `titlePath[0]`.
          if (Array.isArray(data.titlePath) && data.titlePath.length > 0) {
            const resolved = resolvePrefix(data.titlePath[0], overrides, packageName);
            if (resolved !== null) {
              data.titlePath[0] = resolved;
              changed = true;
            }
          }

          // 5. Strip filename from titlePath so the tree matches the breadcrumb hierarchy.
          //    Before: ['DOCX Comparison', 'atomLcs.test.ts', 'describe block', ...]
          //    After:  ['DOCX Comparison', 'describe block', ...]
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

  ensureInnerReporter() {
    if (this.innerPromise) return this.innerPromise;

    this.innerPromise = (async () => {
      await this.ensureResultsDirClean();

      const { innerReporterPath, ...innerOptions } = this.options;
      if (!innerReporterPath) {
        // eslint-disable-next-line no-console
        console.warn('[allure-compat-reporter] Missing innerReporterPath for Allure compatibility reporter.');
        return null;
      }

      try {
        const mod = await import(pathToFileURL(innerReporterPath).href);
        const ReporterCtor = mod?.default;
        if (typeof ReporterCtor !== 'function') {
          // eslint-disable-next-line no-console
          console.warn(
            `[allure-compat-reporter] Allure reporter at '${innerReporterPath}' has no default class export.`,
          );
          return null;
        }

        const inner = new ReporterCtor(innerOptions);
        if (inner.onInit) {
          await inner.onInit(this.ctx);
        }
        return inner;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[allure-compat-reporter] Failed to load Allure reporter '${innerReporterPath}': ${String(error)}`,
        );
        return null;
      }
    })();

    return this.innerPromise;
  }

  async ensureResultsDirClean() {
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
        `[allure-compat-reporter] Failed to clean results dir '${resultsDir}': ${String(error)}`,
      );
    }
  }
}
