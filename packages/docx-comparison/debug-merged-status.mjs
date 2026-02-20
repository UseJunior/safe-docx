#!/usr/bin/env node
/**
 * Debug script to check correlation status in merged atoms.
 */

import { readFile } from 'fs/promises';
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

async function main() {
  console.log('Loading ILPA documents...');
  const originalBuffer = await readFile(ORIGINAL_DOC);
  const revisedBuffer = await readFile(REVISED_DOC);

  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);

  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  const originalTree = parseDocumentXml(originalXml);
  const revisedTree = parseDocumentXml(revisedXml);
  backfillParentReferences(originalTree);
  backfillParentReferences(revisedTree);

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

  // Check status BEFORE hierarchical compare
  console.log('\n=== BEFORE COMPARISON ===');
  const beforeCounts = countStatuses(originalAtoms.concat(revisedAtoms));
  console.log(beforeCounts);

  // Run hierarchical comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);

  console.log('\n=== LCS RESULT ===');
  console.log(`Matches: ${lcsResult.matches.length}`);
  console.log(`Deleted indices: ${lcsResult.deletedIndices.length}`);
  console.log(`Inserted indices: ${lcsResult.insertedIndices.length}`);

  // Mark status
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Check status AFTER marking
  console.log('\n=== AFTER MARKING (original atoms) ===');
  const originalCounts = countStatuses(originalAtoms);
  console.log(originalCounts);

  console.log('\n=== AFTER MARKING (revised atoms) ===');
  const revisedCounts = countStatuses(revisedAtoms);
  console.log(revisedCounts);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  console.log('\n=== MERGED ATOMS ===');
  console.log(`Total: ${mergedAtoms.length}`);
  const mergedCounts = countStatuses(mergedAtoms);
  console.log(mergedCounts);

  // Check if merged atoms are different from what we'd expect
  console.log('\n=== COMPARISON ===');
  console.log(`Expected Deleted in merged (from original): ${originalCounts['Deleted'] || 0}`);
  console.log(`Expected Inserted in merged (from revised): ${revisedCounts['Inserted'] || 0}`);
  console.log(`Actual Deleted in merged: ${mergedCounts['Deleted'] || 0}`);
  console.log(`Actual Inserted in merged: ${mergedCounts['Inserted'] || 0}`);

  // Check if status was preserved for first 10 deleted atoms from original
  console.log('\n=== FIRST 10 DELETED ORIGINAL ATOMS ===');
  let foundDeleted = 0;
  for (let i = 0; i < originalAtoms.length && foundDeleted < 10; i++) {
    if (originalAtoms[i].correlationStatus === CorrelationStatus.Deleted) {
      const text = originalAtoms[i].contentElement?.textContent?.slice(0, 40) || '(empty)';
      const inMerged = mergedAtoms.includes(originalAtoms[i]);
      console.log(`  [${i}] "${text}" inMerged=${inMerged}`);
      foundDeleted++;
    }
  }

  // Check lcsResult.deletedIndices content
  console.log('\n=== FIRST 10 DELETED INDICES IN LCS RESULT ===');
  for (let i = 0; i < 10 && i < lcsResult.deletedIndices.length; i++) {
    const idx = lcsResult.deletedIndices[i];
    const atom = originalAtoms[idx];
    const text = atom?.contentElement?.textContent?.slice(0, 40) || '(empty)';
    const status = atom ? CorrelationStatus[atom.correlationStatus] : 'N/A';
    console.log(`  deletedIndex[${i}] = ${idx}, status=${status}, text="${text}"`);
  }
}

function countStatuses(atoms) {
  const counts = {};
  for (const atom of atoms) {
    const status = CorrelationStatus[atom.correlationStatus] || 'Unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

main().catch(console.error);
