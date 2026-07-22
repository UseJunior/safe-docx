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
import { generateDocx } from '../generation/compile.js';
import { DocxDocument } from '../primitives/document.js';
import { OOXML, W } from '../primitives/namespaces.js';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';

const SUPPORTED_PROTOCOL_VERSION = '1';
export const SUPPORTED_CONFORMANCE_OPERATIONS: ReadonlySet<string> = new Set([
  'acceptAllTrackedChanges',
  'composeDocumentWithCompatibilityMode',
  'rejectAllTrackedChanges',
  'replaceFirstTextOccurrence',
]);

export interface OperationDescriptor {
  operationName: string;
  bodyText?: unknown;
  compatibilityMode?: unknown;
  findText?: string;
  replaceText?: string;
}

export interface ConformanceSupportDecision {
  supported: boolean;
  reason?: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

async function hasTableRowRevision(buffer: Buffer, markerName: 'del' | 'ins'): Promise<boolean> {
  const documentXml = await readZipText(buffer, 'word/document.xml');
  if (!documentXml) return false;
  const document = parseXml(documentXml);
  const rows = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, W.tr));
  return rows.some((row) =>
    Array.from(row.children).some(
      (child) =>
        child.namespaceURI === OOXML.W_NS &&
        child.localName === W.trPr &&
        Array.from(child.children).some(
          (property) => property.namespaceURI === OOXML.W_NS && property.localName === markerName,
        ),
    ),
  );
}

/** Classifies adapter support from the requested operation and input package shape. */
export async function classifyConformanceSupport(
  operation: OperationDescriptor,
  input?: Buffer,
): Promise<ConformanceSupportDecision> {
  if (!SUPPORTED_CONFORMANCE_OPERATIONS.has(operation.operationName)) {
    return {
      supported: false,
      reason: `safe-docx adapter does not implement operation '${operation.operationName}'`,
    };
  }
  if (operation.operationName === 'composeDocumentWithCompatibilityMode') {
    return operation.compatibilityMode === 15
      ? { supported: true }
      : {
          supported: false,
          reason: `safe-docx adapter only implements compatibilityMode 15, got ${String(operation.compatibilityMode)}`,
        };
  }
  if (!input) {
    throw new Error(`operation '${operation.operationName}' requires an input package for support classification`);
  }
  if (
    operation.operationName === 'acceptAllTrackedChanges' &&
    await hasTableRowRevision(input, 'del')
  ) {
    return {
      supported: false,
      reason: 'safe-docx adapter does not implement accepting deleted table-row revisions',
    };
  }
  if (
    operation.operationName === 'rejectAllTrackedChanges' &&
    await hasTableRowRevision(input, 'ins')
  ) {
    return {
      supported: false,
      reason: 'safe-docx adapter does not implement rejecting inserted table-row revisions',
    };
  }
  return { supported: true };
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
  if (typeof operation.operationName !== 'string') {
    console.error('operation descriptor requires a string operationName');
    return 1;
  }
  // Unknown operations are classified without touching the input package.
  if (!SUPPORTED_CONFORMANCE_OPERATIONS.has(operation.operationName)) {
    const operationDecision = await classifyConformanceSupport(operation);
    console.log(operationDecision.reason);
    return 2;
  }

  if (operation.operationName === 'composeDocumentWithCompatibilityMode') {
    const { bodyText, compatibilityMode } = operation;
    if (typeof compatibilityMode !== 'number' || !Number.isInteger(compatibilityMode)) {
      console.error('composeDocumentWithCompatibilityMode requires an integer compatibilityMode');
      return 1;
    }
    if (typeof bodyText !== 'string') {
      console.error('composeDocumentWithCompatibilityMode requires a string bodyText');
      return 1;
    }
    const operationDecision = await classifyConformanceSupport(operation);
    if (!operationDecision.supported) {
      console.log(operationDecision.reason);
      return 2;
    }

    const buffer = await generateDocx({
      sections: [
        {
          blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: bodyText }] }],
        },
      ],
    });
    writeFileSync(outputPath, buffer);
    return 0;
  }

  const input = readFileSync(inputPath);
  const documentDecision = await classifyConformanceSupport(operation, input);
  if (!documentDecision.supported) {
    console.log(documentDecision.reason);
    return 2;
  }

  const doc = await DocxDocument.load(input);

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
      doc.insertParagraphBookmarks('dpt-adapter');
      const paragraph = doc
        .readParagraphs()
        .paragraphs.find((candidate) => candidate.text.includes(findText));
      if (!paragraph) {
        console.error(`findText not present in any paragraph: ${JSON.stringify(findText)}`);
        return 1;
      }
      const paragraphText = doc.getParagraphTextById(paragraph.id)!;
      const start = paragraphText.indexOf(findText);
      doc.replaceTextAtRange({
        targetParagraphId: paragraph.id,
        start,
        end: start + findText.length,
        replaceText,
      });
      doc.normalize();
      break;
    }
    default:
      // Unreachable: membership was checked above.
      return 2;
  }

  const { buffer } = await doc.toBuffer({ cleanBookmarks: true });
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
