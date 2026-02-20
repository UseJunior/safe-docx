#!/usr/bin/env node
/**
 * Debug script to find duplicate atoms for specific text.
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
  console.log('Loading documents...');
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

  // Run comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Run move detection
  const allAtoms = [...originalAtoms, ...revisedAtoms];
  detectMovesInAtomList(allAtoms, DEFAULT_MOVE_DETECTION_SETTINGS);
  detectFormatChangesInAtomList(revisedAtoms, DEFAULT_FORMAT_DETECTION_SETTINGS);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  // Find all atoms containing "Commitments"
  console.log('\n=== ATOMS CONTAINING "Commitments" ===');
  const commitmentsAtoms = mergedAtoms.filter(a =>
    a.contentElement?.textContent?.includes('Commitments')
  );

  console.log(`Total atoms with "Commitments": ${commitmentsAtoms.length}`);

  for (const atom of commitmentsAtoms) {
    const status = CorrelationStatus[atom.correlationStatus];
    const text = atom.contentElement?.textContent;
    const para = atom.paragraphIndex;
    const isOrig = originalAtoms.includes(atom);
    const isRev = revisedAtoms.includes(atom);
    console.log(`  status=${status.padEnd(18)} para=${para} from=${isOrig ? 'original' : 'revised'} text="${text}"`);
  }

  // Check for atoms that share the same sourceRunElement
  console.log('\n=== CHECKING FOR SHARED sourceRunElement ===');
  const runToAtoms = new Map();
  for (const atom of mergedAtoms) {
    if (atom.sourceRunElement) {
      if (!runToAtoms.has(atom.sourceRunElement)) {
        runToAtoms.set(atom.sourceRunElement, []);
      }
      runToAtoms.get(atom.sourceRunElement).push(atom);
    }
  }

  let sharedCount = 0;
  for (const [run, atoms] of runToAtoms.entries()) {
    if (atoms.length > 1) {
      sharedCount++;
      if (sharedCount <= 5) {
        console.log(`  Run shared by ${atoms.length} atoms:`);
        for (const atom of atoms) {
          const status = CorrelationStatus[atom.correlationStatus];
          const text = atom.contentElement?.textContent?.slice(0, 40);
          console.log(`    status=${status}, text="${text}"`);
        }
      }
    }
  }
  console.log(`Total shared runs: ${sharedCount}`);

  // Check specific paragraph 64 atoms
  console.log('\n=== ATOMS AT UNIFIED PARAGRAPH 64 ===');
  const para64Atoms = mergedAtoms.filter(a => a.paragraphIndex === 64);
  for (const atom of para64Atoms) {
    const status = CorrelationStatus[atom.correlationStatus];
    const text = atom.contentElement?.textContent;
    console.log(`  status=${status.padEnd(18)} text="${text}"`);
  }
}

main().catch(console.error);
