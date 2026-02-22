import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runServeCommand } from './commands/serve.js';
import { runCompareCommand, type CompareCommandArgs, type CompareCommandResult } from './commands/compare.js';

interface CliHandlers {
  serve: () => Promise<void>;
  compare: (args: CompareCommandArgs) => Promise<CompareCommandResult>;
  write: (line: string) => void;
}

export interface CliProgram {
  parseAsync(argv?: string[]): Promise<void>;
}

function packageVersion(): string {
  try {
    const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function renderHelp(): string {
  return [
    'safe-docx CLI',
    '',
    'Usage:',
    '  safe-docx [command] [options]',
    '  safedocx [command] [options]',
    '',
    'Commands:',
    '  serve                                       Start the MCP server (default)',
    '  compare <original> <revised> [output]       Compare two DOCX files and write redline output',
    '',
    'Compare options:',
    '  --engine <auto|atomizer|diffmatch>          Comparison engine (default: atomizer)',
    '  --mode <inplace|rebuild>                    Reconstruction mode (default: rebuild)',
    '  --author <name>                             Track-changes author label (default: Comparison)',
    '  --premerge-runs <true|false>                Enable run premerge optimization',
    '',
    'Global options:',
    '  -h, --help                                  Show help',
    '  -v, --version                               Show version',
  ].join('\n');
}

function parseBoolean(raw: string, flagName: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid value for ${flagName}: ${raw}. Use true or false.`);
}

function parseCompareArgs(args: string[]): CompareCommandArgs {
  const positional: string[] = [];
  const options: Omit<CompareCommandArgs, 'originalPath' | 'revisedPath' | 'outputPath'> = {};

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token) continue;

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const consumeValue = (flagName: string): string => {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${flagName}.`);
      }
      i += 1;
      return next;
    };

    switch (token) {
      case '--engine':
        options.engine = consumeValue(token);
        break;
      case '--mode':
        options.mode = consumeValue(token);
        break;
      case '--author':
        options.author = consumeValue(token);
        break;
      case '--premerge-runs':
        options.premergeRuns = parseBoolean(consumeValue(token), token);
        break;
      default:
        throw new Error(`Unknown option for compare command: ${token}`);
    }
  }

  if (positional.length < 2 || positional.length > 3) {
    throw new Error('compare requires: <original> <revised> [output]');
  }

  const [originalPath, revisedPath, outputPath] = positional;
  if (!originalPath || !revisedPath) {
    throw new Error('compare requires: <original> <revised> [output]');
  }

  return {
    originalPath,
    revisedPath,
    outputPath,
    ...options,
  };
}

export function createProgram(overrides: Partial<CliHandlers> = {}): CliProgram {
  const handlers: CliHandlers = {
    serve: runServeCommand,
    compare: runCompareCommand,
    write: (line) => {
      // eslint-disable-next-line no-console
      console.log(line);
    },
    ...overrides,
  };

  return {
    async parseAsync(argv = process.argv): Promise<void> {
      const args = argv.slice(2);

      if (args.length === 0) {
        await handlers.serve();
        return;
      }

      const command = args[0];
      if (!command) {
        await handlers.serve();
        return;
      }
      const rest = args.slice(1);

      if (command === '--help' || command === '-h' || command === 'help') {
        handlers.write(renderHelp());
        return;
      }

      if (command === '--version' || command === '-v') {
        handlers.write(packageVersion());
        return;
      }

      if (command === 'serve') {
        await handlers.serve();
        return;
      }

      if (command === 'compare') {
        const parsed = parseCompareArgs(rest);
        const result = await handlers.compare(parsed);
        handlers.write(JSON.stringify(result));
        return;
      }

      throw new Error(`Unknown command: ${command}. Use --help to see available commands.`);
    },
  };
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
