#!/usr/bin/env node
/**
 * Debug script to trace deleted atom processing in inplace mode.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';
import { atomizeTree, assignParagraphIndices } from './dist/atomizer.js';
import { parseDocumentXml, findBody, backfillParentReferences } from './dist/baselines/atomizer/xmlToWmlElement.js';
import { createMergedAtomList, assignUnifiedParagraphIndices } from './dist/baselines/atomizer/atomLcs.js';
import { hierarchicalCompare, markHierarchicalCorrelationStatus } from './dist/baselines/atomizer/hierarchicalLcs.js';
import { CorrelationStatus } from './dist/core-types.js';

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

  // Load archives
  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);

  // Extract XML
  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  // Parse trees
  const originalTree = parseDocumentXml(originalXml);
  const revisedTree = parseDocumentXml(revisedXml);
  backfillParentReferences(originalTree);
  backfillParentReferences(revisedTree);

  // Find bodies and atomize
  const originalBody = findBody(originalTree);
  const revisedBody = findBody(revisedTree);

  const originalPart = { uri: 'word/document.xml', contentType: 'app' };
  const revisedPart = { uri: 'word/document.xml', contentType: 'app' };

  const originalAtoms = atomizeTree(originalBody, [], originalPart);
  const revisedAtoms = atomizeTree(revisedBody, [], revisedPart);

  assignParagraphIndices(originalAtoms);
  assignParagraphIndices(revisedAtoms);

  console.log(`Original atoms: ${originalAtoms.length}`);
  console.log(`Revised atoms: ${revisedAtoms.length}`);

  // Run comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  console.log(`Merged atoms: ${mergedAtoms.length}`);

  // Analyze merged atoms
  const statusCounts = {};
  let deletedWithRun = 0;
  let deletedWithoutRun = 0;
  let deletedWithPara = 0;
  let deletedEmptyPara = 0;

  const deletedAtomDetails = [];

  for (const atom of mergedAtoms) {
    const status = CorrelationStatus[atom.correlationStatus];
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (atom.correlationStatus === CorrelationStatus.Deleted) {
      if (atom.isEmptyParagraph) {
        deletedEmptyPara++;
      } else if (atom.sourceRunElement) {
        deletedWithRun++;
      } else {
        deletedWithoutRun++;
      }

      if (atom.sourceParagraphElement) {
        deletedWithPara++;
      }

      // Track details of first 50 deleted atoms
      if (deletedAtomDetails.length < 50) {
        const text = atom.contentElement?.textContent || '(no text)';
        deletedAtomDetails.push({
          index: deletedAtomDetails.length,
          text: text.slice(0, 100),
          hasSourceRun: !!atom.sourceRunElement,
          hasSourcePara: !!atom.sourceParagraphElement,
          isEmptyPara: atom.isEmptyParagraph,
          paragraphIndex: atom.paragraphIndex,
        });
      }
    }
  }

  console.log('\n=== STATUS COUNTS ===');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log('\n=== DELETED ATOM ANALYSIS ===');
  console.log(`  Deleted with sourceRunElement: ${deletedWithRun}`);
  console.log(`  Deleted WITHOUT sourceRunElement: ${deletedWithoutRun}`);
  console.log(`  Deleted with sourceParagraphElement: ${deletedWithPara}`);
  console.log(`  Deleted empty paragraphs: ${deletedEmptyPara}`);

  console.log('\n=== FIRST 50 DELETED ATOMS ===');
  for (const detail of deletedAtomDetails) {
    console.log(`  [${detail.index}] hasRun=${detail.hasSourceRun}, hasPara=${detail.hasSourcePara}, empty=${detail.isEmptyPara}, para=${detail.paragraphIndex}`);
    console.log(`       "${detail.text}..."`);
  }

  // Check if Equal atoms have sourceRunElement pointing to revised tree
  let equalWithRun = 0;
  let equalWithoutRun = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.Equal) {
      if (atom.sourceRunElement) {
        equalWithRun++;
      } else {
        equalWithoutRun++;
      }
    }
  }

  console.log('\n=== EQUAL ATOM ANALYSIS ===');
  console.log(`  Equal with sourceRunElement: ${equalWithRun}`);
  console.log(`  Equal WITHOUT sourceRunElement: ${equalWithoutRun}`);

  // Write detailed atom list
  const report = mergedAtoms.map((atom, i) => ({
    index: i,
    status: CorrelationStatus[atom.correlationStatus],
    text: (atom.contentElement?.textContent || '').slice(0, 50),
    hasSourceRun: !!atom.sourceRunElement,
    hasSourcePara: !!atom.sourceParagraphElement,
    paragraphIndex: atom.paragraphIndex,
    isEmptyPara: atom.isEmptyParagraph,
  }));

  await writeFile(
    join(OUTPUT_DIR, 'merged-atoms-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\nFull report saved to: ${OUTPUT_DIR}/merged-atoms-report.json`);
}

main().catch(console.error);
