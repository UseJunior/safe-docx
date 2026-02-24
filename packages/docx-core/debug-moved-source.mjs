#!/usr/bin/env node
/**
 * Debug script to check which tree MovedSource atoms reference.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';
import { atomizeTree, assignParagraphIndices } from './dist/atomizer.js';
import { parseDocumentXml, findBody, backfillParentReferences } from './dist/baselines/atomizer/xmlToWmlElement.js';
import { createMergedAtomList, assignUnifiedParagraphIndices } from './dist/baselines/atomizer/atomLcs.js';
import { hierarchicalCompare, markHierarchicalCorrelationStatus } from './dist/baselines/atomizer/hierarchicalLcs.js';
import { detectMovesInAtomList } from './dist/move-detection.js';
import { detectFormatChangesInAtomList } from './dist/format-detection.js';
import { CorrelationStatus, DEFAULT_MOVE_DETECTION_SETTINGS, DEFAULT_FORMAT_DETECTION_SETTINGS } from './dist/core-types.js';
import { findAllByTagName } from './dist/baselines/atomizer/wmlElementUtils.js';

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

  // Get all runs from original tree for comparison
  const originalRuns = findAllByTagName(originalTree, 'w:r');
  const revisedRuns = findAllByTagName(revisedTree, 'w:r');
  const originalRunSet = new Set(originalRuns);
  const revisedRunSet = new Set(revisedRuns);

  console.log(`Original runs: ${originalRuns.length}`);
  console.log(`Revised runs: ${revisedRuns.length}`);

  // Run comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Run move detection (this is what changes Deleted -> MovedSource)
  const allAtoms = [...originalAtoms, ...revisedAtoms];
  detectMovesInAtomList(allAtoms, DEFAULT_MOVE_DETECTION_SETTINGS);

  // Run format detection
  detectFormatChangesInAtomList(revisedAtoms, DEFAULT_FORMAT_DETECTION_SETTINGS);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  // Check which tree MovedSource atoms reference
  console.log('\n=== MOVED SOURCE ATOMS ===');
  let movedSourceCount = 0;
  let movedSourceInOriginal = 0;
  let movedSourceInRevised = 0;
  let movedSourceNoRun = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.MovedSource) {
      movedSourceCount++;
      if (atom.sourceRunElement) {
        if (originalRunSet.has(atom.sourceRunElement)) {
          movedSourceInOriginal++;
        } else if (revisedRunSet.has(atom.sourceRunElement)) {
          movedSourceInRevised++;
        }
      } else {
        movedSourceNoRun++;
      }
    }
  }

  console.log(`Total MovedSource atoms: ${movedSourceCount}`);
  console.log(`  In ORIGINAL tree: ${movedSourceInOriginal}`);
  console.log(`  In REVISED tree: ${movedSourceInRevised}`);
  console.log(`  No sourceRunElement: ${movedSourceNoRun}`);

  // Check MovedDestination
  console.log('\n=== MOVED DESTINATION ATOMS ===');
  let movedDestCount = 0;
  let movedDestInOriginal = 0;
  let movedDestInRevised = 0;
  let movedDestNoRun = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.MovedDestination) {
      movedDestCount++;
      if (atom.sourceRunElement) {
        if (originalRunSet.has(atom.sourceRunElement)) {
          movedDestInOriginal++;
        } else if (revisedRunSet.has(atom.sourceRunElement)) {
          movedDestInRevised++;
        }
      } else {
        movedDestNoRun++;
      }
    }
  }

  console.log(`Total MovedDestination atoms: ${movedDestCount}`);
  console.log(`  In ORIGINAL tree: ${movedDestInOriginal}`);
  console.log(`  In REVISED tree: ${movedDestInRevised}`);
  console.log(`  No sourceRunElement: ${movedDestNoRun}`);

  // Check Deleted atoms (should be in original)
  console.log('\n=== DELETED ATOMS ===');
  let deletedCount = 0;
  let deletedInOriginal = 0;
  let deletedInRevised = 0;
  let deletedNoRun = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.Deleted) {
      deletedCount++;
      if (atom.sourceRunElement) {
        if (originalRunSet.has(atom.sourceRunElement)) {
          deletedInOriginal++;
        } else if (revisedRunSet.has(atom.sourceRunElement)) {
          deletedInRevised++;
        }
      } else {
        deletedNoRun++;
      }
    }
  }

  console.log(`Total Deleted atoms: ${deletedCount}`);
  console.log(`  In ORIGINAL tree: ${deletedInOriginal}`);
  console.log(`  In REVISED tree: ${deletedInRevised}`);
  console.log(`  No sourceRunElement: ${deletedNoRun}`);

  // Check Inserted atoms (should be in revised)
  console.log('\n=== INSERTED ATOMS ===');
  let insertedCount = 0;
  let insertedInOriginal = 0;
  let insertedInRevised = 0;
  let insertedNoRun = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.Inserted) {
      insertedCount++;
      if (atom.sourceRunElement) {
        if (originalRunSet.has(atom.sourceRunElement)) {
          insertedInOriginal++;
        } else if (revisedRunSet.has(atom.sourceRunElement)) {
          insertedInRevised++;
        }
      } else {
        insertedNoRun++;
      }
    }
  }

  console.log(`Total Inserted atoms: ${insertedCount}`);
  console.log(`  In ORIGINAL tree: ${insertedInOriginal}`);
  console.log(`  In REVISED tree: ${insertedInRevised}`);
  console.log(`  No sourceRunElement: ${insertedNoRun}`);
}

main().catch(console.error);
