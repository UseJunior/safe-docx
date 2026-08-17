import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { compareDocuments } from '@usejunior/docx-compare';

export interface CompareCommandArgs {
  originalPath: string;
  revisedPath: string;
  outputPath?: string;
  author?: string;
}

export interface CompareCommandResult {
  output: string;
  package_base: 'revised';
  bytes: number;
  stats: unknown;
}

export interface CompareCommandDependencies {
  compare: typeof compareDocuments;
}

const DEFAULT_DEPENDENCIES: CompareCommandDependencies = {
  compare: compareDocuments,
};

async function writeFileAtomically(target: string, contents: Buffer | string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function defaultOutputPath(revisedPath: string): string {
  return revisedPath.replace(/\.docx$/i, '') + '.REDLINE.docx';
}

export async function runCompareCommand(
  args: CompareCommandArgs,
  dependencies: CompareCommandDependencies = DEFAULT_DEPENDENCIES,
): Promise<CompareCommandResult> {
  const originalAbs = resolve(args.originalPath);
  const revisedAbs = resolve(args.revisedPath);
  const outputAbs = resolve(args.outputPath ?? defaultOutputPath(revisedAbs));
  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalAbs),
    readFile(revisedAbs),
  ]);

  const result = await dependencies.compare(originalBuffer, revisedBuffer, {
    author: args.author ?? 'Comparison',
  });
  await writeFileAtomically(outputAbs, result.document);

  return {
    output: outputAbs,
    package_base: 'revised',
    bytes: result.document.length,
    stats: result.stats,
  };
}
