/**
 * Debug script to trace what happens with the title atoms (paragraphIndex 4 and 5)
 */
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from './dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

async function main() {
  const originalPath = join(
    projectRoot,
    'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx'
  );
  const revisedPath = join(
    projectRoot,
    'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx'
  );

  console.log('Loading ILPA documents...');
  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(originalPath),
    readFile(revisedPath),
  ]);

  // Run comparison in inplace mode
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    reconstructionMode: 'inplace',
  });

  // Get the merged atoms
  const mergedAtoms = result.debug?.mergedAtoms ?? [];

  console.log('\nTotal merged atoms: ' + mergedAtoms.length);

  // Find atoms with paragraphIndex 4 and 5 (the title content)
  console.log('\n=== Title atoms (paragraphIndex 4 and 5) ===');
  const titleAtoms = mergedAtoms.filter(a => a.paragraphIndex === 4 || a.paragraphIndex === 5);

  for (const atom of titleAtoms) {
    console.log({
      index: mergedAtoms.indexOf(atom),
      paragraphIndex: atom.paragraphIndex,
      status: atom.correlationStatus,
      text: atom.contentElement?.textContent?.slice(0, 60),
      hasSourceRun: !!atom.sourceRunElement,
      hasSourcePara: !!atom.sourceParagraphElement,
      isEmptyPara: !!atom.isEmptyParagraph,
    });
  }

  // Also show the context - atoms 0-15
  console.log('\n=== First 15 atoms (for context) ===');
  for (let i = 0; i < 15 && i < mergedAtoms.length; i++) {
    const atom = mergedAtoms[i];
    console.log({
      index: i,
      paragraphIndex: atom.paragraphIndex,
      status: atom.correlationStatus,
      text: atom.contentElement?.textContent?.slice(0, 50),
      hasSourceRun: !!atom.sourceRunElement,
      hasSourcePara: !!atom.sourceParagraphElement,
    });
  }

  // Check which paragraphIndices exist in revised
  const revisedAtoms = result.debug?.revisedAtoms ?? [];
  const revisedParaIndices = new Set();
  for (const atom of revisedAtoms) {
    if (atom.paragraphIndex !== undefined) {
      revisedParaIndices.add(atom.paragraphIndex);
    }
  }

  console.log('\n=== Revised paragraph indices (first 20) ===');
  const sortedIndices = [...revisedParaIndices].sort((a, b) => a - b);
  console.log(sortedIndices.slice(0, 20));

  // Check if paragraphIndex 4 and 5 exist in revised
  console.log('\n=== Do title paragraphs exist in revised? ===');
  console.log('paragraphIndex 4 in revised: ' + revisedParaIndices.has(4));
  console.log('paragraphIndex 5 in revised: ' + revisedParaIndices.has(5));

  // What are the first few Deleted atoms?
  console.log('\n=== All Deleted atoms (first 10) ===');
  const deletedAtoms = mergedAtoms.filter(a => a.correlationStatus === 'Deleted');
  for (let i = 0; i < 10 && i < deletedAtoms.length; i++) {
    const atom = deletedAtoms[i];
    console.log({
      mergedIndex: mergedAtoms.indexOf(atom),
      paragraphIndex: atom.paragraphIndex,
      text: atom.contentElement?.textContent?.slice(0, 60),
      hasSourceRun: !!atom.sourceRunElement,
      hasSourcePara: !!atom.sourceParagraphElement,
    });
  }
}

main().catch(console.error);
