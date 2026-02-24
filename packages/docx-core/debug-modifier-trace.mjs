#!/usr/bin/env node
/**
 * Debug script to trace the inplace modifier processing.
 * This adds manual instrumentation to understand why wraps aren't working.
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
  serializeToXml,
} from './dist/baselines/atomizer/xmlToWmlElement.js';
import { createMergedAtomList, assignUnifiedParagraphIndices } from './dist/baselines/atomizer/atomLcs.js';
import { hierarchicalCompare, markHierarchicalCorrelationStatus } from './dist/baselines/atomizer/hierarchicalLcs.js';
import { CorrelationStatus } from './dist/core-types.js';
import { wrapElement, createElement, findAllByTagName } from './dist/baselines/atomizer/wmlElementUtils.js';

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

  // Manual trace of wrap operations
  console.log('\n=== TRACING WRAP OPERATIONS ===');

  const wrappedRuns = new Set();
  let wrapSuccess = 0;
  let wrapFailed = 0;
  let wrapSkippedAlreadyWrapped = 0;
  let atomsWithoutRun = 0;

  // Process first 100 inserted atoms to trace what happens
  let insertedProcessed = 0;
  const insertedAtoms = mergedAtoms.filter(a => a.correlationStatus === CorrelationStatus.Inserted);

  console.log(`Total inserted atoms: ${insertedAtoms.length}`);

  for (const atom of insertedAtoms.slice(0, 100)) {
    const run = atom.sourceRunElement;

    if (!run) {
      atomsWithoutRun++;
      continue;
    }

    if (wrappedRuns.has(run)) {
      wrapSkippedAlreadyWrapped++;
      continue;
    }

    // Try to wrap
    const wrapper = createElement('w:ins', {
      'w:id': String(insertedProcessed + 1),
      'w:author': 'Test',
      'w:date': '2024-01-01T00:00:00Z',
    });

    const parent = run.parent;
    const text = atom.contentElement?.textContent?.slice(0, 30) || '(no text)';

    if (!parent) {
      console.log(`  FAIL: No parent - "${text}"`);
      wrapFailed++;
      continue;
    }

    if (!parent.children) {
      console.log(`  FAIL: Parent has no children - "${text}"`);
      wrapFailed++;
      continue;
    }

    const idx = parent.children.indexOf(run);
    if (idx === -1) {
      console.log(`  FAIL: Run not in parent's children - "${text}"`);
      console.log(`    Parent tag: ${parent.tagName}`);
      console.log(`    Run tag: ${run.tagName}`);
      console.log(`    Parent children count: ${parent.children.length}`);
      wrapFailed++;
      continue;
    }

    const result = wrapElement(run, wrapper);
    if (result) {
      wrappedRuns.add(run);
      wrapSuccess++;
      if (insertedProcessed < 5) {
        console.log(`  SUCCESS: Wrapped "${text}"`);
      }
    } else {
      console.log(`  FAIL: wrapElement returned false - "${text}"`);
      wrapFailed++;
    }

    insertedProcessed++;
  }

  console.log('\n=== WRAP TRACE SUMMARY ===');
  console.log(`Successful wraps: ${wrapSuccess}`);
  console.log(`Failed wraps: ${wrapFailed}`);
  console.log(`Skipped (already wrapped): ${wrapSkippedAlreadyWrapped}`);
  console.log(`Atoms without run: ${atomsWithoutRun}`);

  // Count w:ins in modified tree
  const insElements = findAllByTagName(revisedTree, 'w:ins');
  console.log(`\nw:ins elements in tree after wrapping: ${insElements.length}`);

  // Check if the serialized XML has the wraps
  const xml = serializeToXml(revisedTree);
  const insCount = (xml.match(/<w:ins /g) || []).length;
  console.log(`w:ins elements in serialized XML: ${insCount}`);

  // Save the result
  await writeFile(join(OUTPUT_DIR, 'trace-result.xml'), xml);
  console.log(`\nSaved traced result to: ${OUTPUT_DIR}/trace-result.xml`);
}

main().catch(console.error);
