import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compareDocuments } from '../index.js';

const USAGE =
  'Usage: docx-comparison <original.docx> <revised.docx> [output.docx] ' +
  '[--author "Name"]\n' +
  'Comparison always publishes the revised-based tagged package; engine, mode, strategy, premerge, ' +
  'and word-refinement selectors have been removed.\n' +
  'Stats: insertions/deletions count contiguous revision ranges; insertedAtoms/deletedAtoms use the tagged-token-v1 unit; ' +
  'modifications counts modified paragraphs and formatChanges is separate.';

export interface ParsedCompareCliArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  options: {
    author: string;
  };
}

export interface CompareCliHelpResult {
  help: true;
  text: string;
}

export interface CompareCliRunResult {
  help?: false;
  output: string;
  package_base: 'revised';
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

export function parseCompareCliArgs(argv: string[]): ParsedCompareCliArgs {
  const positional: string[] = [];
  const options: ParsedCompareCliArgs['options'] = {
    author: 'Comparison',
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
      case '--author':
        options.author = consumeValue(token);
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

function defaultOutputPath(revisedAbs: string): string {
  return revisedAbs.replace(/\.docx$/i, '') + '.REDLINE.docx';
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
  const outputAbs = resolve(parsed.outputPath ?? defaultOutputPath(revisedAbs));

  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalAbs),
    readFile(revisedAbs),
  ]);

  const result = await dependencies.compare(originalBuffer, revisedBuffer, {
    author: parsed.options.author,
  });

  await mkdir(dirname(outputAbs), { recursive: true });
  await writeFile(outputAbs, result.document);

  return {
    output: outputAbs,
    package_base: 'revised',
    bytes: result.document.length,
    stats: result.stats,
  };
}
