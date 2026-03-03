/**
 * Quality benchmark runner — gate-then-score architecture.
 *
 * For each fixture × engine: produce redline → run gates → if hard gates pass, run scores.
 */

import { readFile, access } from 'fs/promises';
import { resolve, dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { compareDocuments } from '../index.js';
import { extractTextWithParagraphs } from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { createTimer } from './metrics.js';
import { runGates } from './gates.js';
import { scoreDiffMinimality, scoreCompatibility, scoreExtras } from './scores.js';
import { generateMarkdownReport, generateJsonReport } from './reporter.js';
import type {
  BenchmarkEngine,
  EngineResult,
  FixtureBenchmarkResult,
  FixtureManifest,
  FixtureManifestEntry,
  QualityBenchmarkConfig,
  ScoreResults,
} from './types.js';

const execFileAsync = promisify(execFile);

// ── Manifest loading ────────────────────────────────────────────────

export async function loadManifest(manifestPath: string): Promise<{
  manifest: FixtureManifest;
  resolvedFixtures: Array<FixtureManifestEntry & { resolvedOriginal: string; resolvedRevised: string }>;
}> {
  const raw = await readFile(manifestPath, 'utf-8');
  const manifest: FixtureManifest = JSON.parse(raw);
  const baseDir = resolve(dirname(manifestPath), manifest.base_dir);

  const resolvedFixtures: Array<FixtureManifestEntry & { resolvedOriginal: string; resolvedRevised: string }> = [];
  const missing: string[] = [];

  for (const entry of manifest.fixtures) {
    const resolvedOriginal = resolve(baseDir, entry.original);
    const resolvedRevised = resolve(baseDir, entry.revised);

    try {
      await access(resolvedOriginal);
    } catch {
      missing.push(`${entry.name}: original not found at ${resolvedOriginal}`);
    }
    try {
      await access(resolvedRevised);
    } catch {
      missing.push(`${entry.name}: revised not found at ${resolvedRevised}`);
    }

    resolvedFixtures.push({ ...entry, resolvedOriginal, resolvedRevised });
  }

  if (missing.length > 0) {
    throw new Error(`Manifest path validation failed:\n${missing.join('\n')}`);
  }

  return { manifest, resolvedFixtures };
}

// ── Engine dispatch ─────────────────────────────────────────────────

async function produceRedline(
  engine: BenchmarkEngine,
  originalBuffer: Buffer,
  revisedBuffer: Buffer,
  author: string,
  asposeCliPath?: string,
): Promise<Buffer> {
  if (engine === 'atomizer') {
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'atomizer', author });
    return result.document;
  }

  if (engine === 'diffmatch') {
    const result = await compareDocuments(originalBuffer, revisedBuffer, { engine: 'diffmatch', author });
    return result.document;
  }

  if (engine === 'aspose') {
    if (!asposeCliPath) {
      throw new Error('Aspose CLI path not provided');
    }

    // Use Python subprocess
    const { tmpdir } = await import('os');
    const { mkdtemp, writeFile, unlink } = await import('fs/promises');
    const { join } = await import('path');

    const tempDir = await mkdtemp(join(tmpdir(), 'benchmark-aspose-'));
    const origPath = join(tempDir, 'original.docx');
    const revPath = join(tempDir, 'revised.docx');
    const outPath = join(tempDir, 'result.docx');

    try {
      await writeFile(origPath, originalBuffer);
      await writeFile(revPath, revisedBuffer);

      await execFileAsync('python3', [
        asposeCliPath,
        '--original', origPath,
        '--revised', revPath,
        '--output', outPath,
        '--author', author,
      ], { timeout: 120_000 });

      return await readFile(outPath);
    } finally {
      try { await unlink(origPath); } catch { /* ignore */ }
      try { await unlink(revPath); } catch { /* ignore */ }
      try { await unlink(outPath); } catch { /* ignore */ }
      try { await unlink(outPath.replace('.docx', '.manifest.json')); } catch { /* ignore */ }
      try {
        const { rmdir } = await import('fs/promises');
        await rmdir(tempDir);
      } catch { /* ignore */ }
    }
  }

  throw new Error(`Unknown engine: ${engine}`);
}

// ── Single fixture × engine ─────────────────────────────────────────

async function runEngineOnFixture(
  engine: BenchmarkEngine,
  originalBuffer: Buffer,
  revisedBuffer: Buffer,
  author: string,
  config: QualityBenchmarkConfig,
): Promise<EngineResult> {
  const timer = createTimer();

  try {
    const resultBuffer = await produceRedline(
      engine,
      originalBuffer,
      revisedBuffer,
      author,
      config.asposeCliPath,
    );
    const wallTimeMs = timer();

    // Extract text from source documents for gate comparison
    const originalArchive = await DocxArchive.load(originalBuffer);
    const revisedArchive = await DocxArchive.load(revisedBuffer);
    const originalDocXml = await originalArchive.getDocumentXml();
    const revisedDocXml = await revisedArchive.getDocumentXml();
    const originalText = extractTextWithParagraphs(originalDocXml);
    const revisedText = extractTextWithParagraphs(revisedDocXml);

    // Get result document.xml for gates
    const resultArchive = await DocxArchive.load(resultBuffer);
    const resultDocXml = await resultArchive.getDocumentXml();

    // Run gates
    const { gates, hardGatesPassed, softGatesPassed } = await runGates(
      resultBuffer,
      resultDocXml,
      originalText,
      revisedText,
      originalBuffer,
      revisedBuffer,
    );

    // Run scores only if hard gates pass
    let scores: ScoreResults | null = null;
    if (hardGatesPassed) {
      const diffMin = scoreDiffMinimality(resultDocXml);
      const compat = await scoreCompatibility(resultBuffer, config.libreOfficePath, config.timeout);
      const extras = scoreExtras(resultDocXml);

      scores = {
        diffMinimality: diffMin,
        compatibility: compat,
        performance: { wallTimeMs },
        extras,
      };
    }

    return {
      engine,
      gates,
      hardGatesPassed,
      softGatesPassed,
      scores,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      engine,
      gates: {
        textRoundTrip: {
          normalizedTextParity: { passed: false, detail: 'Skipped (engine error)' },
          paragraphCountParity: { passed: false, detail: 'Skipped (engine error)' },
          xmlParseValidity: { passed: false, detail: 'Skipped (engine error)' },
        },
        formattingProjection: { passed: false, detail: 'Skipped (engine error)' },
        structuralIntegrity: { passed: false, detail: 'Skipped (engine error)' },
      },
      hardGatesPassed: false,
      softGatesPassed: false,
      scores: null,
      error: msg,
    };
  }
}

// ── Main entry point ────────────────────────────────────────────────

export async function runQualityBenchmark(
  config: QualityBenchmarkConfig,
): Promise<FixtureBenchmarkResult[]> {
  const { resolvedFixtures } = await loadManifest(config.manifestPath);
  const author = config.author ?? 'Benchmark';
  const results: FixtureBenchmarkResult[] = [];

  for (const fixture of resolvedFixtures) {
    console.log(`Running: ${fixture.name}`);
    const originalBuffer = await readFile(fixture.resolvedOriginal);
    const revisedBuffer = await readFile(fixture.resolvedRevised);

    const engines: Record<string, EngineResult> = {};

    for (const engine of config.engines) {
      console.log(`  Engine: ${engine}`);
      engines[engine] = await runEngineOnFixture(
        engine,
        originalBuffer,
        revisedBuffer,
        author,
        config,
      );
    }

    results.push({
      fixture: fixture.name,
      tags: fixture.tags,
      engines,
      timestamp: new Date().toISOString(),
    });
  }

  return results;
}

// ── CLI entry point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: pnpm benchmark <manifest.json> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --engines=atomizer,diffmatch  Engines to run (comma-separated)');
    console.log('  --aspose-cli=<path>           Path to aspose_compare.py');
    console.log('  --libreoffice=<path>          Path to LibreOffice binary');
    console.log('  --author=<name>               Author name for revisions');
    console.log('  --format=json|markdown        Output format (default: json)');
    process.exit(1);
  }

  const manifestPath = args[0]!;
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.slice(2).split('=', 2);
      options[key!] = value!;
    }
  }

  const engines = (options.engines ?? 'atomizer,diffmatch')
    .split(',')
    .map((e) => e.trim()) as BenchmarkEngine[];

  const config: QualityBenchmarkConfig = {
    manifestPath: resolve(manifestPath),
    engines,
    author: options.author,
    asposeCliPath: options['aspose-cli'],
    libreOfficePath: options.libreoffice,
  };

  try {
    const results = await runQualityBenchmark(config);
    const format = options.format ?? 'json';

    if (format === 'markdown') {
      console.log(generateMarkdownReport(results));
    } else {
      console.log(generateJsonReport(results));
    }
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
