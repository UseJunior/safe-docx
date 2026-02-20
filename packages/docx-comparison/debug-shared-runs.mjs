#!/usr/bin/env node
/**
 * Debug script to check if atoms share run elements.
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

  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  // Count atoms sharing run elements by status
  console.log('\n=== CHECKING SHARED RUN ELEMENTS ===');

  const runToAtoms = new Map();

  for (const atom of mergedAtoms) {
    if (atom.sourceRunElement) {
      const key = atom.sourceRunElement;
      if (!runToAtoms.has(key)) {
        runToAtoms.set(key, []);
      }
      runToAtoms.get(key).push(atom);
    }
  }

  // Count runs with multiple atoms
  let runsWithMultiple = 0;
  let totalAtomsInSharedRuns = 0;

  const statusSharedRuns = {
    [CorrelationStatus.Inserted]: 0,
    [CorrelationStatus.Deleted]: 0,
    [CorrelationStatus.Equal]: 0,
  };

  for (const [run, atoms] of runToAtoms) {
    if (atoms.length > 1) {
      runsWithMultiple++;
      totalAtomsInSharedRuns += atoms.length;

      // Check if all atoms have the same status
      const statuses = new Set(atoms.map(a => a.correlationStatus));
      if (statuses.size === 1) {
        const status = atoms[0].correlationStatus;
        if (statusSharedRuns[status] !== undefined) {
          statusSharedRuns[status] += atoms.length;
        }
      }
    }
  }

  console.log(`Total unique runs in merged list: ${runToAtoms.size}`);
  console.log(`Runs with multiple atoms: ${runsWithMultiple}`);
  console.log(`Total atoms in shared runs: ${totalAtomsInSharedRuns}`);

  console.log('\nAtoms in shared runs by status:');
  console.log(`  Inserted: ${statusSharedRuns[CorrelationStatus.Inserted]}`);
  console.log(`  Deleted: ${statusSharedRuns[CorrelationStatus.Deleted]}`);
  console.log(`  Equal: ${statusSharedRuns[CorrelationStatus.Equal]}`);

  // Count unique runs by status
  const uniqueRunsByStatus = {
    [CorrelationStatus.Inserted]: new Set(),
    [CorrelationStatus.Deleted]: new Set(),
    [CorrelationStatus.Equal]: new Set(),
  };

  for (const atom of mergedAtoms) {
    if (atom.sourceRunElement && uniqueRunsByStatus[atom.correlationStatus]) {
      uniqueRunsByStatus[atom.correlationStatus].add(atom.sourceRunElement);
    }
  }

  console.log('\nUnique runs by status:');
  console.log(`  Inserted: ${uniqueRunsByStatus[CorrelationStatus.Inserted].size}`);
  console.log(`  Deleted: ${uniqueRunsByStatus[CorrelationStatus.Deleted].size}`);
  console.log(`  Equal: ${uniqueRunsByStatus[CorrelationStatus.Equal].size}`);

  // Show details of first few shared runs
  console.log('\n=== FIRST FEW SHARED RUNS ===');
  let shown = 0;
  for (const [run, atoms] of runToAtoms) {
    if (atoms.length > 1 && shown < 5) {
      console.log(`\nRun with ${atoms.length} atoms (status: ${CorrelationStatus[atoms[0].correlationStatus]}):`);
      for (const atom of atoms) {
        const text = atom.contentElement?.textContent || '(no text)';
        console.log(`  - "${text.slice(0, 50)}..." (${CorrelationStatus[atom.correlationStatus]})`);
      }
      shown++;
    }
  }
}

main().catch(console.error);
