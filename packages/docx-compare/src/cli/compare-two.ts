import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compareDocuments, type CompareOptions } from '../index.js';
import { DEFAULT_RECONSTRUCTION_MODE } from '../comparison-defaults.js';

const USAGE =
  'Usage: docx-comparison <original.docx> <revised.docx> [output.docx] ' +
  '[--engine atomizer|auto] [--mode inplace|rebuild] [--comparison-strategy tagged-tree|legacy] [--author "Name"] [--premerge-runs true|false]\n' +
  `Mode defaults to ${DEFAULT_RECONSTRUCTION_MODE}; the pipeline may fall back to rebuild when safety checks fail ` +
  '(reported via mode vs mode_requested and fallback_reason).\n' +
  'Stats: insertions/deletions count contiguous revision ranges; insertedAtoms/deletedAtoms count granular word atoms; ' +
  'modifications counts modified paragraphs and formatChanges is separate.';

export interface ParsedCompareCliArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  options: {
    engine: NonNullable<CompareOptions['engine']>;
    reconstructionMode: 'inplace' | 'rebuild';
    author: string;
    premergeRuns: boolean;
    comparisonStrategy: 'tagged-tree' | 'legacy';
  };
}

export interface CompareCliHelpResult {
  help: true;
  text: string;
}

export interface CompareCliRunResult {
  help?: false;
  output: string;
  engine: string;
  /** Reconstruction mode actually used to produce the output. */
  mode: 'inplace' | 'rebuild';
  /** Reconstruction mode the caller requested (or the shared default). */
  mode_requested: 'inplace' | 'rebuild';
  /** Present only when the pipeline fell back from the requested mode. */
  fallback_reason?: string;
  bytes: number;
  stats: unknown;
}

export type CompareCliResult = CompareCliHelpResult | CompareCliRunResult;

export interface CompareCliDependencies {
  compare: typeof compareDocuments;
}

const DEFAULT_DEPENDENCIES: CompareCliDependencies = {
  compare: compareDocuments,
};

function parseBooleanFlag(raw: string, flagName: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid value for ${flagName}: ${raw}. Use true or false.`);
}

export function parseCompareCliArgs(argv: string[]): ParsedCompareCliArgs {
  const positional: string[] = [];
  const options: ParsedCompareCliArgs['options'] = {
    engine: 'atomizer',
    reconstructionMode: DEFAULT_RECONSTRUCTION_MODE,
    author: 'Comparison',
    premergeRuns: true,
    comparisonStrategy: 'tagged-tree',
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const consumeValue = (flagName: string): string => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${flagName}.\n${USAGE}`);
      }
      i += 1;
      return next;
    };

    switch (token) {
      case '--engine': {
        const engine = consumeValue(token);
        if (engine !== 'atomizer' && engine !== 'auto') {
          throw new Error(`Unsupported engine: ${engine}. Use atomizer or auto.`);
        }
        options.engine = engine;
        break;
      }
      case '--mode': {
        const mode = consumeValue(token);
        if (mode !== 'inplace' && mode !== 'rebuild') {
          throw new Error(`Unsupported mode: ${mode}. Use inplace or rebuild.`);
        }
        options.reconstructionMode = mode;
        break;
      }
      case '--author':
        options.author = consumeValue(token);
        break;
      case '--comparison-strategy': {
        const strategy = consumeValue(token);
        if (strategy !== 'tagged-tree' && strategy !== 'legacy') {
          throw new Error(`Unsupported comparison strategy: ${strategy}. Use tagged-tree or legacy.`);
        }
        options.comparisonStrategy = strategy;
        break;
      }
      case '--premerge-runs':
        options.premergeRuns = parseBooleanFlag(consumeValue(token), token);
        break;
      default:
        throw new Error(`Unknown option: ${token}.\n${USAGE}`);
    }
  }

  if (positional.length < 2 || positional.length > 3) {
    throw new Error(`Expected <original.docx> <revised.docx> [output.docx].\n${USAGE}`);
  }

  const [originalPath, revisedPath, outputPath] = positional;
  if (!originalPath || !revisedPath) {
    throw new Error(`Expected <original.docx> <revised.docx> [output.docx].\n${USAGE}`);
  }

  return {
    originalPath,
    revisedPath,
    outputPath,
    options,
  };
}

function defaultOutputPath(revisedAbs: string, options: ParsedCompareCliArgs['options']): string {
  return revisedAbs.replace(/\.docx$/i, '') + `.REDLINE.${options.engine}.${options.reconstructionMode}.docx`;
}

export async function runCompareCli(
  argv = process.argv.slice(2),
  dependencies: CompareCliDependencies = DEFAULT_DEPENDENCIES,
): Promise<CompareCliResult> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, text: USAGE };
  }

  const parsed = parseCompareCliArgs(argv);

  const originalAbs = resolve(parsed.originalPath);
  const revisedAbs = resolve(parsed.revisedPath);
  const outputAbs = resolve(parsed.outputPath ?? defaultOutputPath(revisedAbs, parsed.options));

  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalAbs),
    readFile(revisedAbs),
  ]);

  const result = await dependencies.compare(originalBuffer, revisedBuffer, {
    engine: parsed.options.engine,
    author: parsed.options.author,
    reconstructionMode: parsed.options.reconstructionMode,
    premergeRuns: parsed.options.premergeRuns,
    comparisonStrategy: parsed.options.comparisonStrategy,
  });

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, result.document);

  return {
    output: outputAbs,
    engine: result.engine,
    mode: result.reconstructionModeUsed ?? parsed.options.reconstructionMode,
    mode_requested: parsed.options.reconstructionMode,
    fallback_reason: result.fallbackReason,
    bytes: result.document.length,
    stats: result.stats,
  };
}
