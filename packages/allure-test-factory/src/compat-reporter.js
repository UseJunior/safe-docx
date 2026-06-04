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

/**
 * Rewrite an ordered path (the dot-split `package` label or the `titlePath`
 * array) so the Allure tree groups by display name.
 *
 * allure-vitest >=3.6 prepends a project-scope segment — the nearest
 * package.json `name`, e.g. `@usejunior/docx-core` — ahead of the source
 * directory, so the source-root anchor (`src`/`test`/an override key) is no
 * longer at index 0. Find that anchor wherever it now sits, drop everything
 * before it (the project scope), and replace it with its display name. Pre-3.6
 * shapes have the anchor at index 0, so this is a no-op-equivalent rewrite for
 * them and stays backward compatible.
 *
 * @param {string[]} segments - Ordered path segments.
 * @param {Record<string, string> | undefined} overrides
 * @param {string | undefined} packageName
 * @returns {string[] | null} - Rewritten segments, or null if no anchor resolves.
 */
function rewritePathSegments(segments, overrides, packageName) {
  for (let i = 0; i < segments.length; i++) {
    const resolved = resolvePrefix(segments[i], overrides, packageName);
    if (resolved !== null) {
      return [resolved, ...segments.slice(i + 1)];
    }
  }
  return null;
}

/**
 * Rewrite an allure-vitest `fullName`. The shape is `<project>:<specPath>#<test>`
 * in >=3.6 (e.g. `@usejunior/docx-core:src/foo.test.ts#suite test`) and just
 * `<specPath>#<test>` before that. Drop the leading `<project>:` scope (package
 * names never contain `:`), then replace the spec path's source-root directory
 * with its display name.
 *
 * @returns {string | null} - Rewritten fullName, or null if the prefix doesn't resolve.
 */
function rewriteFullName(fullName, overrides, packageName) {
  const hashIdx = fullName.indexOf('#');
  const locator = hashIdx === -1 ? fullName : fullName.slice(0, hashIdx);
  const testPart = hashIdx === -1 ? '' : fullName.slice(hashIdx);

  const colonIdx = locator.indexOf(':');
  const specPath = colonIdx === -1 ? locator : locator.slice(colonIdx + 1);

  const slashIdx = specPath.indexOf('/');
  const prefix = slashIdx === -1 ? specPath : specPath.slice(0, slashIdx);
  const resolved = resolvePrefix(prefix, overrides, packageName);
  if (resolved === null) return null;

  const rewrittenPath = slashIdx === -1 ? resolved : resolved + specPath.slice(slashIdx);
  return rewrittenPath + testPart;
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

  /**
   * Vitest 4 removed the legacy `onFinished`/`onTaskUpdate` reporter hooks and
   * drives reporters through `onTestRunEnd(testModules, errors, reason)`
   * instead. allure-vitest >=3.4 already implements `onTestRunEnd`, so forward
   * Vitest's native arguments straight through rather than the old shim shape.
   */
  async onTestRunEnd(testModules = [], unhandledErrors = [], reason) {
    const inner = await this.ensureInnerReporter();
    if (!inner) return;

    if (inner.onTestRunEnd) {
      await inner.onTestRunEnd(testModules, unhandledErrors, reason);
    } else if (inner.onFinished) {
      await inner.onFinished(testModules, unhandledErrors);
    }

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

        // 2. Rewrite `package` label so the Packages tab groups by display name.
        //    Anchor on the source-root segment (`src`/override key), dropping any
        //    leading project-scope segment that allure-vitest >=3.6 prepends.
        if (packageName) {
          for (const label of data.labels) {
            if (label.name === 'package' && typeof label.value === 'string') {
              const rewritten = rewritePathSegments(label.value.split('.'), overrides, packageName);
              if (rewritten !== null) {
                label.value = rewritten.join('.');
                changed = true;
              }
            }
          }

          // 3. Rewrite `fullName`: controls the Results page tree hierarchy.
          if (typeof data.fullName === 'string') {
            const rewritten = rewriteFullName(data.fullName, overrides, packageName);
            if (rewritten !== null && rewritten !== data.fullName) {
              data.fullName = rewritten;
              changed = true;
            }
          }

          // 4. Rewrite `titlePath`: drop the project scope and map the source root.
          if (Array.isArray(data.titlePath) && data.titlePath.length > 0) {
            const rewritten = rewritePathSegments(data.titlePath, overrides, packageName);
            if (rewritten !== null) {
              data.titlePath = rewritten;
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
