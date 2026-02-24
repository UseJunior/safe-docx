/**
 * Debug script to check the unified paragraph indices for the "Gross Asset Value" atoms
 */
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from './dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

const ORIGINAL_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
const REVISED_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');

async function main() {
  console.log('Loading ILPA documents...');
  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(ORIGINAL_DOC),
    readFile(REVISED_DOC),
  ]);

  console.log('Running comparison...');
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  const mergedAtoms = result.debug?.mergedAtoms ?? [];
  const revisedAtoms = result.debug?.revisedAtoms ?? [];

  console.log(`\nTotal merged atoms: ${mergedAtoms.length}`);
  console.log(`Total revised atoms: ${revisedAtoms.length}`);

  // Find atoms containing "contributed by a Limited Partner"
  console.log('\n=== Atoms containing "contributed by a Limited Partner" ===');
  const contributedAtoms = mergedAtoms.filter(a =>
    a.contentElement?.textContent?.includes('contributed by a Limited Partner')
  );
  for (const atom of contributedAtoms) {
    console.log({
      index: mergedAtoms.indexOf(atom),
      paragraphIndex: atom.paragraphIndex,
      status: atom.correlationStatus,
      text: atom.contentElement?.textContent?.slice(0, 50),
    });
  }

  // Find atoms containing "all Fund assets shall be adjusted"
  console.log('\n=== Atoms containing "all Fund assets shall be adjusted" ===');
  const allFundsAtoms = mergedAtoms.filter(a =>
    a.contentElement?.textContent?.includes('all Fund assets shall be adjusted')
  );
  for (const atom of allFundsAtoms) {
    console.log({
      index: mergedAtoms.indexOf(atom),
      paragraphIndex: atom.paragraphIndex,
      status: atom.correlationStatus,
      text: atom.contentElement?.textContent?.slice(0, 50),
      moveName: atom.moveName,
    });
  }

  // Check the paragraph indices around these atoms
  // Find unique paragraph indices near the atoms
  if (contributedAtoms.length > 0) {
    const idx = contributedAtoms[0].paragraphIndex;
    console.log(`\n=== Atoms with paragraphIndex near ${idx} ===`);
    const nearbyAtoms = mergedAtoms.filter(a =>
      a.paragraphIndex !== undefined &&
      Math.abs(a.paragraphIndex - idx) <= 3
    );

    // Group by paragraphIndex
    const byIndex = {};
    for (const atom of nearbyAtoms) {
      const pi = atom.paragraphIndex;
      if (!byIndex[pi]) byIndex[pi] = [];
      byIndex[pi].push({
        status: atom.correlationStatus,
        text: atom.contentElement?.textContent?.slice(0, 40),
      });
    }

    for (const [pi, atoms] of Object.entries(byIndex).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      console.log(`\nParagraph ${pi} (${atoms.length} atoms):`);
      for (const a of atoms.slice(0, 3)) {
        console.log(`  ${a.status}: "${a.text}"`);
      }
      if (atoms.length > 3) {
        console.log(`  ... and ${atoms.length - 3} more`);
      }
    }
  }

  // Check revised atoms for the same paragraph indices
  console.log('\n=== Revised atoms mapping ===');
  const revisedParaIndices = {};
  for (const atom of revisedAtoms) {
    if (atom.paragraphIndex !== undefined && atom.sourceParagraphElement) {
      if (!revisedParaIndices[atom.paragraphIndex]) {
        // Get first text content of the paragraph
        const textContent = atom.contentElement?.textContent?.slice(0, 50);
        revisedParaIndices[atom.paragraphIndex] = textContent;
      }
    }
  }

  // Show paragraph indices around the contributed atoms
  if (contributedAtoms.length > 0) {
    const idx = contributedAtoms[0].paragraphIndex;
    console.log(`\nRevised paragraphs near index ${idx}:`);
    for (let i = idx - 2; i <= idx + 3; i++) {
      if (revisedParaIndices[i] !== undefined) {
        console.log(`  ${i}: "${revisedParaIndices[i]}"`);
      } else {
        console.log(`  ${i}: [not in revised]`);
      }
    }
  }
}

main().catch(console.error);
