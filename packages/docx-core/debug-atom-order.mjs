#!/usr/bin/env node
/**
 * Debug script to examine atom ordering in the merged list.
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

  // Save original paragraph indices before unified assignment
  for (const atom of originalAtoms) {
    atom._origParagraphIndex = atom.paragraphIndex;
  }
  for (const atom of revisedAtoms) {
    atom._origParagraphIndex = atom.paragraphIndex;
  }

  // Run comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Run move detection
  const allAtoms = [...originalAtoms, ...revisedAtoms];
  detectMovesInAtomList(allAtoms, DEFAULT_MOVE_DETECTION_SETTINGS);

  // Run format detection
  detectFormatChangesInAtomList(revisedAtoms, DEFAULT_FORMAT_DETECTION_SETTINGS);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  // Examine the first 50 atoms in merged order
  console.log('\n=== FIRST 50 ATOMS IN MERGED ORDER ===');
  for (let i = 0; i < 50 && i < mergedAtoms.length; i++) {
    const atom = mergedAtoms[i];
    const status = CorrelationStatus[atom.correlationStatus];
    const text = atom.contentElement?.textContent?.slice(0, 40) || '(empty)';
    const origPara = atom._origParagraphIndex;
    const unifiedPara = atom.paragraphIndex;
    console.log(`[${i}] status=${status.padEnd(18)} origPara=${String(origPara).padEnd(4)} unifiedPara=${String(unifiedPara).padEnd(4)} text="${text}"`);
  }

  // Check if there are any MovedSource atoms at the start
  console.log('\n=== FIRST ATOMS BY STATUS ===');
  const firstOfEach = {};
  for (let i = 0; i < mergedAtoms.length; i++) {
    const status = CorrelationStatus[mergedAtoms[i].correlationStatus];
    if (!firstOfEach[status]) {
      firstOfEach[status] = { index: i, atom: mergedAtoms[i] };
    }
  }
  for (const [status, info] of Object.entries(firstOfEach)) {
    const text = info.atom.contentElement?.textContent?.slice(0, 40) || '(empty)';
    console.log(`  First ${status}: index=${info.index}, text="${text}"`);
  }

  // Check paragraph index distribution in merged list
  console.log('\n=== PARAGRAPH INDEX DISTRIBUTION IN MERGED LIST ===');
  const paraToAtoms = new Map();
  for (const atom of mergedAtoms) {
    const para = atom.paragraphIndex;
    if (!paraToAtoms.has(para)) {
      paraToAtoms.set(para, []);
    }
    paraToAtoms.get(para).push(atom);
  }

  // Show first 10 paragraph indices
  const sortedParas = [...paraToAtoms.keys()].sort((a, b) => a - b);
  for (let i = 0; i < 10 && i < sortedParas.length; i++) {
    const para = sortedParas[i];
    const atoms = paraToAtoms.get(para);
    const statusCounts = {};
    for (const atom of atoms) {
      const status = CorrelationStatus[atom.correlationStatus];
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    console.log(`  Paragraph ${para}: ${atoms.length} atoms - ${JSON.stringify(statusCounts)}`);
  }
}

main().catch(console.error);
