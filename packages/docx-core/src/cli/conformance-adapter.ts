#!/usr/bin/env node
/**
 * docx-platform-tests adapter protocol v1 entrypoint.
 *
 * Invoked by the suite runner as:
 *   safe-docx-conformance-adapter --protocol-version 1 \
 *     --operation operation.json --input input.docx --output output.docx
 *
 * Exit codes (per the suite's docs/adapter-protocol.md):
 *   0 success, 1 error, 2 unsupported operation, 3 protocol mismatch.
 * Declining with 2 is mandatory for operations outside the implemented
 * set — the suite's design treats honest gaps as data, never approximate.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DocxDocument } from '../primitives/document.js';
import { getParagraphText, replaceParagraphTextRange } from '../primitives/text.js';

const SUPPORTED_PROTOCOL_VERSION = '1';
const SUPPORTED_OPERATIONS = new Set([
  'acceptAllTrackedChanges',
  'rejectAllTrackedChanges',
  'replaceFirstTextOccurrence',
]);

interface OperationDescriptor {
  operationName: string;
  findText?: string;
  replaceText?: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

export async function runConformanceAdapter(argv: string[]): Promise<number> {
  const protocolVersion = argValue(argv, '--protocol-version');
  const operationPath = argValue(argv, '--operation');
  const inputPath = argValue(argv, '--input');
  const outputPath = argValue(argv, '--output');

  if (protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    console.log(
      `safe-docx-conformance-adapter speaks protocol v${SUPPORTED_PROTOCOL_VERSION}, got ${protocolVersion ?? 'none'}`
    );
    return 3;
  }
  if (!operationPath || !inputPath || !outputPath) {
    console.error('usage: --protocol-version 1 --operation <json> --input <docx> --output <docx>');
    return 1;
  }

  const operation = JSON.parse(readFileSync(operationPath, 'utf8')) as OperationDescriptor;
  // Decline before touching the input: unsupported must not depend on the
  // document being readable.
  if (!SUPPORTED_OPERATIONS.has(operation.operationName)) {
    console.log(`safe-docx adapter does not implement operation '${operation.operationName}'`);
    return 2;
  }
  const doc = await DocxDocument.load(readFileSync(inputPath));

  switch (operation.operationName) {
    case 'acceptAllTrackedChanges':
      await doc.acceptChanges();
      break;
    case 'rejectAllTrackedChanges':
      await doc.rejectChanges();
      break;
    case 'replaceFirstTextOccurrence': {
      const { findText, replaceText } = operation;
      if (typeof findText !== 'string' || typeof replaceText !== 'string') {
        console.error('replaceFirstTextOccurrence requires findText and replaceText');
        return 1;
      }
      // DSL 1.0 match scope: first paragraph-local occurrence in document
      // order; the replacement is a plain edit, not a tracked change.
      const paragraph = doc
        .getParagraphs()
        .find((p) => getParagraphText(p).includes(findText));
      if (!paragraph) {
        console.error(`findText not present in any paragraph: ${JSON.stringify(findText)}`);
        return 1;
      }
      const start = getParagraphText(paragraph).indexOf(findText);
      replaceParagraphTextRange(paragraph, start, start + findText.length, replaceText);
      break;
    }
    default:
      // Unreachable: membership was checked above.
      return 2;
  }

  const { buffer } = await doc.toBuffer();
  writeFileSync(outputPath, buffer);
  return 0;
}

// realpathSync: when invoked through the node_modules/.bin symlink,
// process.argv[1] is the symlink while import.meta.url is the real file.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  runConformanceAdapter(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err?.message ?? String(err));
      process.exit(1);
    });
}
