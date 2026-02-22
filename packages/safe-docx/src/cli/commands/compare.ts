import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compareDocuments, type CompareOptions } from '@usejunior/docx-comparison';

const SUPPORTED_ENGINES: ReadonlySet<NonNullable<CompareOptions['engine']>> = new Set([
  'auto',
  'atomizer',
  'diffmatch',
]);

export interface CompareCommandArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  engine?: string;
  mode?: string;
  author?: string;
  premergeRuns?: boolean;
}

export interface CompareCommandResult {
  output: string;
  engine: string;
  mode: 'inplace' | 'rebuild';
  bytes: number;
  stats: unknown;
}

function normalizeEngine(raw: string | undefined): NonNullable<CompareOptions['engine']> {
  const candidate = (raw ?? 'atomizer').trim() as NonNullable<CompareOptions['engine']>;
  if (!SUPPORTED_ENGINES.has(candidate)) {
    throw new Error(`Unsupported engine: ${String(raw)}. Use auto, atomizer, or diffmatch.`);
  }
  return candidate;
}

function normalizeMode(raw: string | undefined): 'inplace' | 'rebuild' {
  const candidate = (raw ?? 'rebuild').trim().toLowerCase();
  if (candidate !== 'inplace' && candidate !== 'rebuild') {
    throw new Error(`Unsupported mode: ${String(raw)}. Use inplace or rebuild.`);
  }
  return candidate;
}

function defaultOutputPath(revisedPath: string, engine: string, mode: 'inplace' | 'rebuild'): string {
  return revisedPath.replace(/\.docx$/i, '') + `.REDLINE.${engine}.${mode}.docx`;
}

export async function runCompareCommand(args: CompareCommandArgs): Promise<CompareCommandResult> {
  const engine = normalizeEngine(args.engine);
  const mode = normalizeMode(args.mode);

  const originalAbs = resolve(args.originalPath);
  const revisedAbs = resolve(args.revisedPath);
  const outputAbs = resolve(args.outputPath ?? defaultOutputPath(revisedAbs, engine, mode));

  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalAbs),
    readFile(revisedAbs),
  ]);

  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine,
    author: args.author ?? 'Comparison',
    reconstructionMode: mode,
    premergeRuns: args.premergeRuns,
  });

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, result.document);

  return {
    output: outputAbs,
    engine: result.engine,
    mode,
    bytes: result.document.length,
    stats: result.stats,
  };
}
