#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileMarkdoc } from './compile.js';
import { exportEditPairs } from './export.js';
import { importDocxToMarkdoc } from './import.js';
import { inspectMarkdocSource } from './inspect.js';
import { requireMarkdoc } from './markdoc.js';
import { convertCommentsToFootnotes } from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import { assertDistinctInternalPath, EXTERNAL_FILENAME, parseRenderingFlags, warnedInternalPath } from './cli-options.js';

function usage(): string {
  return [
    'Usage:',
    '  docx-markdoc import <source.docx> <anchored.docx> <document.mdoc>',
    '  docx-markdoc validate <document.mdoc>',
    '  docx-markdoc inspect <anchored.docx> [paragraph-id ...]',
    '  docx-markdoc compile <anchored.docx> <document.mdoc> <output-dir> [--external-comments|--no-external-comments]',
    '    [--dangerously-include-internal-comments --internal-output <path.docx>]',
    '  docx-markdoc verify <anchored.docx> <document.mdoc> [--external-comments|--no-external-comments]',
    '  docx-markdoc export-edits <document.mdoc> <output.json>',
    '  docx-markdoc comments-to-footnotes <input.docx> <output.docx> [--prefix TEXT] [--prefix-separator TEXT] [--bold-prefix] [--prefix-color RRGGBB] [--prefix-highlight COLOR] [--body-color RRGGBB] [--body-highlight COLOR] [--flatten-threads]',
  ].join('\n');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!command) throw new Error(usage());
  if (command === 'import') {
    const [sourcePath, anchoredPath, markdocPath] = args;
    if (!sourcePath || !anchoredPath || !markdocPath) throw new Error(usage());
    const result = await importDocxToMarkdoc(await readFile(sourcePath));
    await Promise.all([writeFile(anchoredPath, result.anchoredSource), writeFile(markdocPath, result.markdoc)]);
    return;
  }
  if (command === 'validate') {
    const [markdocPath] = args;
    if (!markdocPath) throw new Error(usage());
    const ir = requireMarkdoc(await readFile(markdocPath, 'utf8'));
    process.stdout.write(`${JSON.stringify(ir, null, 2)}\n`);
    return;
  }
  if (command === 'inspect') {
    const [sourcePath, ...ids] = args;
    if (!sourcePath) throw new Error(usage());
    const records = await inspectMarkdocSource(await readFile(sourcePath), { paragraphIds: ids.length ? ids : undefined });
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }
  if (command === 'compile' || command === 'verify') {
    const flags = parseRenderingFlags(args);
    const [sourcePath, markdocPath, outputDir] = flags.positional;
    if (!sourcePath || !markdocPath || (command === 'compile' && !outputDir)) throw new Error(usage());
    if (command === 'verify' && flags.includeInternalComments) {
      throw new Error('Internal comments can be materialized only by compile with an explicit output path.');
    }
    const hasCliOverride = flags.externalComments !== undefined || flags.includeInternalComments;
    const result = await compileMarkdoc(await readFile(sourcePath), await readFile(markdocPath, 'utf8'), {
      ...(flags.externalComments === undefined ? {} : { externalComments: flags.externalComments }),
      ...(flags.includeInternalComments ? { dangerouslyIncludeInternalComments: true } : {}),
      ...(hasCliOverride ? { configurationSource: 'cli' } : {}),
    });
    if (command === 'compile') {
      if (!result.certificate.deliveryReady) {
        throw new DocxMarkdocError(
          'DELIVERY_NOT_READY',
          'Projection verification passed, but draft completeness blocks deliverable output.',
          result.certificate,
        );
      }
      await mkdir(outputDir!, { recursive: true });
      const cleanPath = path.join(outputDir!, 'clean.docx');
      const externalPath = path.join(
        outputDir!,
        result.certificate.commentRendering.externalCommentsIncluded
          && !result.certificate.commentRendering.internalCommentsIncluded
          ? EXTERNAL_FILENAME
          : 'redline.docx',
      );
      const internalPath = flags.internalOutput ? warnedInternalPath(flags.internalOutput) : undefined;
      if (internalPath) {
        assertDistinctInternalPath(internalPath, [sourcePath, cleanPath, externalPath]);
        await mkdir(path.dirname(internalPath), { recursive: true });
      }
      await Promise.all([
        writeFile(cleanPath, result.clean),
        internalPath
          ? writeFile(internalPath, result.tracked, { flag: 'wx' })
          : writeFile(externalPath, result.tracked),
        writeFile(path.join(outputDir!, 'verification.json'), `${JSON.stringify(result.certificate, null, 2)}\n`),
      ]);
      if (result.certificate.commentRendering.externalCommentsIncluded) {
        process.stderr.write('WARNING: EXTERNAL COMMENTS INCLUDED in generated redline.\n');
      }
      if (result.certificate.commentRendering.internalCommentsIncluded) {
        process.stderr.write(`DANGER: INTERNAL COMMENTS INCLUDED in ${internalPath}.\n`);
      }
      for (const warning of result.certificate.commentRendering.warnings) {
        process.stderr.write(`WARNING: ${warning}\n`);
      }
    }
    process.stdout.write(`${JSON.stringify(result.certificate, null, 2)}\n`);
    if (command === 'verify' && !result.certificate.deliveryReady) process.exitCode = 2;
    return;
  }
  if (command === 'export-edits') {
    const [markdocPath, outputPath] = args;
    if (!markdocPath || !outputPath) throw new Error(usage());
    const ir = requireMarkdoc(await readFile(markdocPath, 'utf8'));
    await writeFile(outputPath, `${JSON.stringify(exportEditPairs(ir), null, 2)}\n`);
    return;
  }
  if (command === 'comments-to-footnotes') {
    const [inputPath, outputPath, ...flags] = args;
    if (!inputPath || !outputPath) throw new Error(usage());
    const valueAfter = (flag: string): string | undefined => {
      const index = flags.indexOf(flag);
      return index < 0 ? undefined : flags[index + 1];
    };
    const prefix = valueAfter('--prefix');
    const prefixColor = valueAfter('--prefix-color');
    const prefixHighlight = valueAfter('--prefix-highlight') as import('@usejunior/docx-core').FootnoteRunStyle['highlight'];
    const bodyColor = valueAfter('--body-color') ?? valueAfter('--color');
    const bodyHighlight = (valueAfter('--body-highlight') ?? valueAfter('--highlight')) as import('@usejunior/docx-core').FootnoteRunStyle['highlight'];
    const result = await convertCommentsToFootnotes(await readFile(inputPath), {
      flattenThreads: flags.includes('--flatten-threads'),
      presentation: {
        prefix,
        prefixSeparator: valueAfter('--prefix-separator'),
        prefixStyle: { bold: flags.includes('--bold-prefix'), color: prefixColor, highlight: prefixHighlight },
        bodyStyle: { color: bodyColor, highlight: bodyHighlight },
      },
    });
    await writeFile(outputPath, result.buffer);
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    return;
  }
  throw new Error(usage());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
