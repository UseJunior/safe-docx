import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compareDocuments, type CompareOptions } from '../index.js';

const USAGE =
  'Usage: docx-comparison <original.docx> <revised.docx> [output.docx] ' +
  '[--engine atomizer|diffmatch|auto] [--mode inplace|rebuild] [--author "Name"] [--premerge-runs true|false]';

export interface ParsedCompareCliArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  options: {
    engine: NonNullable<CompareOptions['engine']>;
    reconstructionMode: 'inplace' | 'rebuild';
    author: string;
    premergeRuns: boolean;
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
  mode: 'inplace' | 'rebuild';
  bytes: number;
  stats: unknown;
}

export type CompareCliResult = CompareCliHelpResult | CompareCliRunResult;

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
    reconstructionMode: 'rebuild',
    author: 'Comparison',
    premergeRuns: false,
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
        if (engine !== 'atomizer' && engine !== 'diffmatch' && engine !== 'auto') {
          throw new Error(`Unsupported engine: ${engine}. Use atomizer, diffmatch, or auto.`);
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

export async function runCompareCli(argv = process.argv.slice(2)): Promise<CompareCliResult> {
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

  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: parsed.options.engine,
    author: parsed.options.author,
    reconstructionMode: parsed.options.reconstructionMode,
    premergeRuns: parsed.options.premergeRuns,
  });

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, result.document);

  return {
    output: outputAbs,
    engine: result.engine,
    mode: parsed.options.reconstructionMode,
    bytes: result.document.length,
    stats: result.stats,
  };
}
