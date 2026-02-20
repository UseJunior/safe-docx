#!/usr/bin/env node
/**
 * Debug script to check parent references on atom source elements.
 */

import { readFile, mkdir } from 'fs/promises';
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

  // Load archives
  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);

  // Extract XML
  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  // Parse trees
  const originalTree = parseDocumentXml(originalXml);
  const revisedTree = parseDocumentXml(revisedXml);

  console.log('Backfilling parent references...');
  backfillParentReferences(originalTree);
  backfillParentReferences(revisedTree);

  // Find bodies and atomize
  const originalBody = findBody(originalTree);
  const revisedBody = findBody(revisedTree);

  const originalPart = { uri: 'word/document.xml', contentType: 'app' };
  const revisedPart = { uri: 'word/document.xml', contentType: 'app' };

  console.log('Atomizing...');
  const originalAtoms = atomizeTree(originalBody, [], originalPart);
  const revisedAtoms = atomizeTree(revisedBody, [], revisedPart);

  assignParagraphIndices(originalAtoms);
  assignParagraphIndices(revisedAtoms);

  // Check parent refs BEFORE comparison
  console.log('\n=== CHECKING PARENT REFS BEFORE COMPARISON ===');

  let originalWithParent = 0;
  let originalWithoutParent = 0;
  for (const atom of originalAtoms) {
    if (atom.sourceRunElement) {
      if (atom.sourceRunElement.parent) {
        originalWithParent++;
      } else {
        originalWithoutParent++;
        if (originalWithoutParent <= 5) {
          console.log(`  Original atom missing parent: "${atom.contentElement?.textContent?.slice(0, 50)}"`);
        }
      }
    }
  }
  console.log(`Original atoms with sourceRunElement.parent: ${originalWithParent}`);
  console.log(`Original atoms WITHOUT sourceRunElement.parent: ${originalWithoutParent}`);

  let revisedWithParent = 0;
  let revisedWithoutParent = 0;
  for (const atom of revisedAtoms) {
    if (atom.sourceRunElement) {
      if (atom.sourceRunElement.parent) {
        revisedWithParent++;
      } else {
        revisedWithoutParent++;
        if (revisedWithoutParent <= 5) {
          console.log(`  Revised atom missing parent: "${atom.contentElement?.textContent?.slice(0, 50)}"`);
        }
      }
    }
  }
  console.log(`Revised atoms with sourceRunElement.parent: ${revisedWithParent}`);
  console.log(`Revised atoms WITHOUT sourceRunElement.parent: ${revisedWithoutParent}`);

  // Run comparison
  console.log('\nRunning comparison...');
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  // Create merged list
  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  // Check parent refs in merged list
  console.log('\n=== CHECKING PARENT REFS IN MERGED LIST ===');

  const statusChecks = {
    [CorrelationStatus.Inserted]: { withParent: 0, withoutParent: 0 },
    [CorrelationStatus.Deleted]: { withParent: 0, withoutParent: 0 },
    [CorrelationStatus.Equal]: { withParent: 0, withoutParent: 0 },
  };

  for (const atom of mergedAtoms) {
    const status = atom.correlationStatus;
    if (statusChecks[status] && atom.sourceRunElement) {
      if (atom.sourceRunElement.parent) {
        statusChecks[status].withParent++;
      } else {
        statusChecks[status].withoutParent++;
      }
    }
  }

  console.log('Inserted atoms:');
  console.log(`  With parent: ${statusChecks[CorrelationStatus.Inserted].withParent}`);
  console.log(`  Without parent: ${statusChecks[CorrelationStatus.Inserted].withoutParent}`);

  console.log('Deleted atoms:');
  console.log(`  With parent: ${statusChecks[CorrelationStatus.Deleted].withParent}`);
  console.log(`  Without parent: ${statusChecks[CorrelationStatus.Deleted].withoutParent}`);

  console.log('Equal atoms:');
  console.log(`  With parent: ${statusChecks[CorrelationStatus.Equal].withParent}`);
  console.log(`  Without parent: ${statusChecks[CorrelationStatus.Equal].withoutParent}`);

  // Simulate wrapping to see if it would succeed
  console.log('\n=== SIMULATING WRAP OPERATIONS ===');

  let insertedWouldSucceed = 0;
  let insertedWouldFail = 0;

  for (const atom of mergedAtoms) {
    if (atom.correlationStatus === CorrelationStatus.Inserted && atom.sourceRunElement) {
      const run = atom.sourceRunElement;
      const parent = run.parent;
      if (parent && parent.children && parent.children.includes(run)) {
        insertedWouldSucceed++;
      } else {
        insertedWouldFail++;
        if (insertedWouldFail <= 5) {
          console.log(`  Inserted wrap would fail: parent=${!!parent}, hasChildren=${!!parent?.children}, inChildren=${parent?.children?.includes(run)}`);
          console.log(`    Text: "${atom.contentElement?.textContent?.slice(0, 50)}"`);
        }
      }
    }
  }

  console.log(`Inserted wraps would succeed: ${insertedWouldSucceed}`);
  console.log(`Inserted wraps would FAIL: ${insertedWouldFail}`);
}

main().catch(console.error);
