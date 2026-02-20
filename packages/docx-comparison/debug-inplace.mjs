#!/usr/bin/env node
/**
 * Debug script to investigate inplace mode reject-all-changes failure.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from './dist/index.js';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  compareTexts,
} from './dist/baselines/atomizer/trackChangesAcceptorAst.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

const ORIGINAL_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
);
const REVISED_DOC = join(
  projectRoot,
  'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
);

const OUTPUT_DIR = join(__dirname, 'debug-output');

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('Loading ILPA documents...');
  const originalBuffer = await readFile(ORIGINAL_DOC);
  const revisedBuffer = await readFile(REVISED_DOC);

  // Extract original text for comparison
  const originalArchive = await DocxArchive.load(originalBuffer);
  const originalXml = await originalArchive.getDocumentXml();
  const originalText = extractTextWithParagraphs(originalXml);
  await writeFile(join(OUTPUT_DIR, '1-original-text.txt'), originalText);

  // Extract revised text for comparison
  const revisedArchive = await DocxArchive.load(revisedBuffer);
  const revisedXml = await revisedArchive.getDocumentXml();
  const revisedText = extractTextWithParagraphs(revisedXml);
  await writeFile(join(OUTPUT_DIR, '2-revised-text.txt'), revisedText);

  console.log('\n=== Running INPLACE mode comparison ===');
  const inplaceResult = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
    author: 'Debug',
  });

  const inplaceArchive = await DocxArchive.load(inplaceResult.document);
  const inplaceXml = await inplaceArchive.getDocumentXml();
  await writeFile(join(OUTPUT_DIR, '3-inplace-result.xml'), inplaceXml);
  await writeFile(join(OUTPUT_DIR, '3-inplace-result.docx'), inplaceResult.document);

  // Accept all changes in inplace result
  const inplaceAcceptedXml = acceptAllChanges(inplaceXml);
  const inplaceAcceptedText = extractTextWithParagraphs(inplaceAcceptedXml);
  await writeFile(join(OUTPUT_DIR, '4-inplace-accepted-text.txt'), inplaceAcceptedText);

  // Reject all changes in inplace result
  const inplaceRejectedXml = rejectAllChanges(inplaceXml);
  const inplaceRejectedText = extractTextWithParagraphs(inplaceRejectedXml);
  await writeFile(join(OUTPUT_DIR, '5-inplace-rejected-text.txt'), inplaceRejectedText);
  await writeFile(join(OUTPUT_DIR, '5-inplace-rejected.xml'), inplaceRejectedXml);

  console.log('\n=== Running REBUILD mode comparison ===');
  const rebuildResult = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: 'rebuild',
    author: 'Debug',
  });

  const rebuildArchive = await DocxArchive.load(rebuildResult.document);
  const rebuildXml = await rebuildArchive.getDocumentXml();
  await writeFile(join(OUTPUT_DIR, '6-rebuild-result.xml'), rebuildXml);

  // Reject all changes in rebuild result
  const rebuildRejectedXml = rejectAllChanges(rebuildXml);
  const rebuildRejectedText = extractTextWithParagraphs(rebuildRejectedXml);
  await writeFile(join(OUTPUT_DIR, '7-rebuild-rejected-text.txt'), rebuildRejectedText);

  console.log('\n=== COMPARISON RESULTS ===\n');

  // Compare inplace accept vs revised
  const acceptComparison = compareTexts(revisedText, inplaceAcceptedText);
  console.log('INPLACE Accept vs Revised:');
  console.log(`  Revised length: ${acceptComparison.expectedLength}`);
  console.log(`  Accepted length: ${acceptComparison.actualLength}`);
  console.log(`  Match: ${acceptComparison.normalizedIdentical ? 'YES ✓' : 'NO ✗'}`);

  // Compare inplace reject vs original
  const rejectComparison = compareTexts(originalText, inplaceRejectedText);
  console.log('\nINPLACE Reject vs Original:');
  console.log(`  Original length: ${rejectComparison.expectedLength}`);
  console.log(`  Rejected length: ${rejectComparison.actualLength}`);
  console.log(`  Match: ${rejectComparison.normalizedIdentical ? 'YES ✓' : 'NO ✗'}`);

  if (!rejectComparison.normalizedIdentical) {
    console.log('\n  First differences:');
    for (const diff of rejectComparison.differences.slice(0, 5)) {
      console.log(`    Line ${diff.line}: expected "${diff.expected?.slice(0, 60)}..." got "${diff.actual?.slice(0, 60)}..."`);
    }
  }

  // Compare rebuild reject vs original
  const rebuildRejectComparison = compareTexts(originalText, rebuildRejectedText);
  console.log('\nREBUILD Reject vs Original:');
  console.log(`  Original length: ${rebuildRejectComparison.expectedLength}`);
  console.log(`  Rejected length: ${rebuildRejectComparison.actualLength}`);
  console.log(`  Match: ${rebuildRejectComparison.normalizedIdentical ? 'YES ✓' : 'NO ✗'}`);

  // Key insight: What's the difference between inplace rejected and rebuild rejected?
  const inplaceVsRebuild = compareTexts(rebuildRejectedText, inplaceRejectedText);
  console.log('\nINPLACE Rejected vs REBUILD Rejected:');
  console.log(`  Rebuild length: ${inplaceVsRebuild.expectedLength}`);
  console.log(`  Inplace length: ${inplaceVsRebuild.actualLength}`);
  console.log(`  Match: ${inplaceVsRebuild.normalizedIdentical ? 'YES ✓' : 'NO ✗'}`);

  if (!inplaceVsRebuild.normalizedIdentical) {
    console.log('\n  First differences between inplace and rebuild rejected:');
    for (const diff of inplaceVsRebuild.differences.slice(0, 10)) {
      console.log(`    Line ${diff.line}:`);
      console.log(`      Rebuild: "${diff.expected?.slice(0, 80)}..."`);
      console.log(`      Inplace: "${diff.actual?.slice(0, 80)}..."`);
    }
  }

  console.log(`\nDebug files saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
