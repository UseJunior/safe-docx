#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileMarkdoc, validateMarkdocAgainstSource } from './compile.js';
import { exportEditPairs } from './export.js';
import { importDocxToMarkdoc } from './import.js';
import { inspectMarkdocSource } from './inspect.js';
import { requireMarkdoc } from './markdoc.js';
import { DocxMarkdocError } from './errors.js';

function usage(): never {
  throw new Error([
    'Usage:',
    '  docx-markdoc import <source.docx> <anchored.docx> <document.mdoc>',
    '  docx-markdoc validate <document.mdoc> [anchored.docx]',
    '  docx-markdoc inspect <anchored.docx> [paragraph-id ...]',
    '  docx-markdoc compile <anchored.docx> <document.mdoc> <output-dir>',
    '  docx-markdoc verify <anchored.docx> <document.mdoc>',
    '  docx-markdoc export-edits <document.mdoc> <output.json>',
  ].join('\n'));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();
  if (command === 'import') {
    const [sourcePath, anchoredPath, markdocPath] = args;
    if (!sourcePath || !anchoredPath || !markdocPath) usage();
    const result = await importDocxToMarkdoc(await readFile(sourcePath));
    await Promise.all([writeFile(anchoredPath, result.anchoredSource), writeFile(markdocPath, result.markdoc)]);
    return;
  }
  if (command === 'validate') {
    const [markdocPath, sourcePath] = args;
    if (!markdocPath) usage();
    const markdoc = await readFile(markdocPath, 'utf8');
    const result = sourcePath
      ? await validateMarkdocAgainstSource(await readFile(sourcePath), markdoc)
      : requireMarkdoc(markdoc);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'inspect') {
    const [sourcePath, ...ids] = args;
    if (!sourcePath) usage();
    const records = await inspectMarkdocSource(await readFile(sourcePath), { paragraphIds: ids.length ? ids : undefined });
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }
  if (command === 'compile' || command === 'verify') {
    const [sourcePath, markdocPath, outputDir] = args;
    if (!sourcePath || !markdocPath || (command === 'compile' && !outputDir)) usage();
    const result = await compileMarkdoc(await readFile(sourcePath), await readFile(markdocPath, 'utf8'));
    if (command === 'compile') {
      if (!result.certificate.deliveryReady) {
        throw new DocxMarkdocError(
          'DELIVERY_NOT_READY',
          'Projection verification passed, but draft completeness blocks deliverable output.',
          result.certificate,
        );
      }
      await mkdir(outputDir!, { recursive: true });
      await Promise.all([
        writeFile(path.join(outputDir!, 'clean.docx'), result.clean),
        writeFile(path.join(outputDir!, 'redline.docx'), result.tracked),
        writeFile(path.join(outputDir!, 'verification.json'), `${JSON.stringify(result.certificate, null, 2)}\n`),
      ]);
    }
    process.stdout.write(`${JSON.stringify(result.certificate, null, 2)}\n`);
    if (command === 'verify' && !result.certificate.deliveryReady) process.exitCode = 2;
    return;
  }
  if (command === 'export-edits') {
    const [markdocPath, outputPath] = args;
    if (!markdocPath || !outputPath) usage();
    const ir = requireMarkdoc(await readFile(markdocPath, 'utf8'));
    await writeFile(outputPath, `${JSON.stringify(exportEditPairs(ir), null, 2)}\n`);
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
