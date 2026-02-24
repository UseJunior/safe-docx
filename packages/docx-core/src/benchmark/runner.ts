/**
 * Benchmark runner for A/B baseline comparison.
 *
 * Runs both baselines against test fixtures and collects metrics.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type {
  BenchmarkResult,
  ComparisonMetrics,
} from './metrics.js';
import {
  createEmptyMetrics,
  createTimer,
  measureMemory,
} from './metrics.js';
import { compareWithDotnet, isRedlineAvailable, DotnetCliOptions } from '../baselines/wmlcomparer/DotnetCli.js';
import { compareDocumentsBaselineB } from '../baselines/diffmatch/pipeline.js';
// import { compareWithWasm, isWasmInitialized } from '../baselines/wmlcomparer/DocxodusWasm.js';

/**
 * Configuration for benchmark runs.
 */
export interface BenchmarkConfig {
  /** Path to fixtures directory */
  fixturesPath: string;
  /** Author name for revisions */
  author?: string;
  /** Path to Docxodus repository (for CLI fallback) */
  docxodusPath?: string;
  /** Path to dotnet executable (e.g., /opt/homebrew/opt/dotnet@8/bin/dotnet) */
  dotnetPath?: string;
  /** Run Baseline A (WmlComparer) */
  runBaselineA?: boolean;
  /** Run Baseline B (pure TS) */
  runBaselineB?: boolean;
  /** Timeout for each comparison in ms */
  timeout?: number;
}

/**
 * Fixture pair: original and revised documents.
 */
interface FixturePair {
  name: string;
  originalPath: string;
  revisedPath: string;
}

/**
 * Discover fixtures in a directory.
 *
 * Expects structure like:
 * - fixtures/simple-word-change/original.docx
 * - fixtures/simple-word-change/revised.docx
 *
 * Or:
 * - fixtures/simple-word-change.original.docx
 * - fixtures/simple-word-change.revised.docx
 */
async function discoverFixtures(fixturesPath: string): Promise<FixturePair[]> {
  const fixtures: FixturePair[] = [];
  const entries = await readdir(fixturesPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Directory structure: fixture-name/original.docx + revised.docx
      const dirPath = join(fixturesPath, entry.name);
      const originalPath = join(dirPath, 'original.docx');
      const revisedPath = join(dirPath, 'revised.docx');

      try {
        await stat(originalPath);
        await stat(revisedPath);
        fixtures.push({
          name: entry.name,
          originalPath,
          revisedPath,
        });
      } catch {
        // Missing files, skip this fixture
      }
    } else if (entry.name.endsWith('.original.docx')) {
      // File structure: fixture-name.original.docx + fixture-name.revised.docx
      const baseName = entry.name.replace('.original.docx', '');
      const originalPath = join(fixturesPath, entry.name);
      const revisedPath = join(fixturesPath, `${baseName}.revised.docx`);

      try {
        await stat(revisedPath);
        fixtures.push({
          name: baseName,
          originalPath,
          revisedPath,
        });
      } catch {
        // Missing revised file, skip
      }
    }
  }

  return fixtures;
}

/**
 * Run Baseline A (WmlComparer via CLI) on a fixture.
 */
async function runBaselineA(
  original: Buffer,
  revised: Buffer,
  options: DotnetCliOptions
): Promise<{ metrics: ComparisonMetrics; output: Buffer }> {
  const metrics = createEmptyMetrics();
  const startMemory = measureMemory();
  const timer = createTimer();

  const result = await compareWithDotnet(original, revised, options);

  metrics.wallTimeMs = timer();
  metrics.peakRssMb = Math.max(measureMemory() - startMemory, 0);
  metrics.outputSizeBytes = result.document.length;
  metrics.insertions = result.stats.insertions;
  metrics.deletions = result.stats.deletions;
  metrics.modifications = result.stats.modifications;

  // TODO: Add structural validation
  // - Parse output DOCX
  // - Check for broken relationships
  // - Count actual track changes elements

  return { metrics, output: result.document };
}

/**
 * Run Baseline B (pure TypeScript) on a fixture.
 *
 * Uses the diffmatch pipeline:
 * 1. Parse DOCX to extract paragraphs/runs
 * 2. Align paragraphs using LCS
 * 3. Diff matched paragraphs at run level
 * 4. Render track changes back to DOCX
 */
async function runBaselineB(
  original: Buffer,
  revised: Buffer,
  author: string
): Promise<{ metrics: ComparisonMetrics; output: Buffer }> {
  const metrics = createEmptyMetrics();
  const startMemory = measureMemory();
  const timer = createTimer();

  const result = await compareDocumentsBaselineB(original, revised, { author });

  metrics.wallTimeMs = timer();
  metrics.peakRssMb = Math.max(measureMemory() - startMemory, 0);
  metrics.outputSizeBytes = result.document.length;
  metrics.insertions = result.stats.insertions;
  metrics.deletions = result.stats.deletions;
  metrics.modifications = result.stats.modifications;

  return { metrics, output: result.document };
}

/**
 * Run benchmark on a single fixture.
 */
async function runFixture(
  fixture: FixturePair,
  config: BenchmarkConfig
): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    fixture: fixture.name,
    baselineA: null,
    baselineB: null,
    timestamp: new Date(),
  };

  // Load fixture files
  const original = await readFile(fixture.originalPath);
  const revised = await readFile(fixture.revisedPath);

  const author = config.author ?? 'Benchmark';

  // Run Baseline A
  if (config.runBaselineA !== false) {
    try {
      const { metrics } = await runBaselineA(original, revised, {
        author,
        docxodusPath: config.docxodusPath,
        dotnetPath: config.dotnetPath,
        timeout: config.timeout,
      });
      result.baselineA = metrics;
    } catch (error) {
      result.baselineAError =
        error instanceof Error ? error.message : String(error);
    }
  }

  // Run Baseline B
  if (config.runBaselineB !== false) {
    try {
      const { metrics } = await runBaselineB(original, revised, author);
      result.baselineB = metrics;
    } catch (error) {
      result.baselineBError =
        error instanceof Error ? error.message : String(error);
    }
  }

  return result;
}

/**
 * Run benchmark on all fixtures.
 */
export async function runBenchmark(
  config: BenchmarkConfig
): Promise<BenchmarkResult[]> {
  // Check if Baseline A is available
  const canRunA = config.runBaselineA !== false &&
    await isRedlineAvailable(config.docxodusPath, config.dotnetPath);

  if (config.runBaselineA !== false && !canRunA) {
    console.warn(
      'Baseline A (WmlComparer) not available. Install .NET 8+ and Docxodus.'
    );
  }

  // Discover fixtures
  const fixtures = await discoverFixtures(config.fixturesPath);

  if (fixtures.length === 0) {
    console.warn(`No fixtures found in ${config.fixturesPath}`);
    return [];
  }

  console.log(`Found ${fixtures.length} fixture(s)`);

  // Run benchmarks
  const results: BenchmarkResult[] = [];

  for (const fixture of fixtures) {
    console.log(`Running: ${fixture.name}`);

    const result = await runFixture(fixture, {
      ...config,
      runBaselineA: canRunA && config.runBaselineA !== false,
    });

    results.push(result);
  }

  return results;
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run benchmark <fixtures-path> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --docxodus=<path>  Path to Docxodus repository');
    console.log('  --dotnet=<path>    Path to dotnet executable (e.g., /opt/homebrew/opt/dotnet@8/bin/dotnet)');
    console.log('  --author=<name>    Author name for revisions');
    console.log('  --no-baseline-a    Skip Baseline A (WmlComparer)');
    console.log('  --no-baseline-b    Skip Baseline B (pure TS)');
    process.exit(1);
  }

  const fixturesPath = args[0]!;
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const [key, value] = arg.slice(2).split('=', 2);
        options[key!] = value!;
      } else if (arg.startsWith('--no-')) {
        options[arg.slice(5)] = false;
      } else {
        options[arg.slice(2)] = true;
      }
    }
  }

  const config: BenchmarkConfig = {
    fixturesPath,
    author: options.author as string | undefined,
    docxodusPath: options.docxodus as string | undefined,
    dotnetPath: options.dotnet as string | undefined,
    runBaselineA: options['baseline-a'] !== false,
    runBaselineB: options['baseline-b'] !== false,
  };

  try {
    const results = await runBenchmark(config);

    // Output results as JSON
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
