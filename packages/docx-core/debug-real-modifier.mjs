#!/usr/bin/env node
/**
 * Debug script that calls the ACTUAL modifyRevisedDocument function.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';
import { atomizeTree, assignParagraphIndices } from './dist/atomizer.js';
import {
  parseDocumentXml,
  findBody,
  backfillParentReferences,
} from './dist/baselines/atomizer/xmlToWmlElement.js';
import { createMergedAtomList, assignUnifiedParagraphIndices } from './dist/baselines/atomizer/atomLcs.js';
import { hierarchicalCompare, markHierarchicalCorrelationStatus } from './dist/baselines/atomizer/hierarchicalLcs.js';
import { modifyRevisedDocument } from './dist/baselines/atomizer/inPlaceModifier.js';
import { CorrelationStatus } from './dist/core-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

// Use a simpler test fixture
const FIXTURE_DIR = join(__dirname, 'src/testing/fixtures/simple-word-change');
const ORIGINAL_DOC = join(FIXTURE_DIR, 'original.docx');
const REVISED_DOC = join(FIXTURE_DIR, 'revised.docx');

const OUTPUT_DIR = join(__dirname, 'debug-output');

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('Loading simple test documents...');
  const originalBuffer = await readFile(ORIGINAL_DOC);
  const revisedBuffer = await readFile(REVISED_DOC);

  const originalArchive = await DocxArchive.load(originalBuffer);
  const revisedArchive = await DocxArchive.load(revisedBuffer);

  const originalXml = await originalArchive.getDocumentXml();
  const revisedXml = await revisedArchive.getDocumentXml();

  console.log('\nOriginal XML:');
  console.log(originalXml.slice(0, 2000) + '...');

  console.log('\nRevised XML:');
  console.log(revisedXml.slice(0, 2000) + '...');

  // Parse trees
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

  console.log(`\nOriginal atoms: ${originalAtoms.length}`);
  console.log(`Revised atoms: ${revisedAtoms.length}`);

  // List all atoms
  console.log('\nOriginal atoms:');
  for (const atom of originalAtoms) {
    const text = atom.contentElement?.textContent || '(empty)';
    console.log(`  - "${text}" hasRun=${!!atom.sourceRunElement} hasPara=${!!atom.sourceParagraphElement}`);
  }

  console.log('\nRevised atoms:');
  for (const atom of revisedAtoms) {
    const text = atom.contentElement?.textContent || '(empty)';
    console.log(`  - "${text}" hasRun=${!!atom.sourceRunElement} hasPara=${!!atom.sourceParagraphElement}`);
  }

  // Run comparison
  const lcsResult = hierarchicalCompare(originalAtoms, revisedAtoms);
  markHierarchicalCorrelationStatus(originalAtoms, revisedAtoms, lcsResult);

  const mergedAtoms = createMergedAtomList(originalAtoms, revisedAtoms, lcsResult);
  assignUnifiedParagraphIndices(originalAtoms, revisedAtoms, mergedAtoms, lcsResult);

  console.log(`\nMerged atoms: ${mergedAtoms.length}`);
  for (const atom of mergedAtoms) {
    const text = atom.contentElement?.textContent || '(empty)';
    const status = CorrelationStatus[atom.correlationStatus];
    console.log(`  [${status}] "${text}" hasRun=${!!atom.sourceRunElement}`);
  }

  // Call the real modifyRevisedDocument
  console.log('\nCalling modifyRevisedDocument...');
  const resultXml = modifyRevisedDocument(
    revisedTree,
    originalAtoms,
    revisedAtoms,
    mergedAtoms,
    { author: 'Debug', date: new Date() }
  );

  console.log('\nResult XML:');
  console.log(resultXml);

  // Count track changes
  const insCount = (resultXml.match(/<w:ins /g) || []).length;
  const delCount = (resultXml.match(/<w:del /g) || []).length;
  console.log(`\nw:ins count: ${insCount}`);
  console.log(`w:del count: ${delCount}`);

  await writeFile(join(OUTPUT_DIR, 'simple-result.xml'), resultXml);
  console.log(`\nSaved to: ${OUTPUT_DIR}/simple-result.xml`);
}

main().catch(console.error);
