/**
 * Debug script to test ILPA inplace mode reject-all-changes
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from './dist/index.js';
import { rejectAllChanges, extractTextWithParagraphs, compareTexts } from './dist/baselines/atomizer/trackChangesAcceptorAst.js';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');
const outputDir = join(__dirname, 'src/testing/outputs');

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
  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(ORIGINAL_DOC),
    readFile(REVISED_DOC),
  ]);

  console.log('Running comparison with INPLACE mode...');
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });

  console.log('\nExtracting text after rejecting changes...');
  const resultArchive = await DocxArchive.load(result.document);
  const resultXml = await resultArchive.getDocumentXml();

  // Save the comparison result XML
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'inplace_comparison_result.xml'), resultXml);

  const rejectedXml = rejectAllChanges(resultXml);
  await writeFile(join(outputDir, 'inplace_rejected.xml'), rejectedXml);

  const rejectedText = extractTextWithParagraphs(rejectedXml);

  // Get original text
  const originalArchive = await DocxArchive.load(originalBuffer);
  const originalXml = await originalArchive.getDocumentXml();
  const originalText = extractTextWithParagraphs(originalXml);

  // Save texts for comparison
  await writeFile(join(outputDir, 'inplace_rejected_text.txt'), rejectedText);
  await writeFile(join(outputDir, 'inplace_original_text.txt'), originalText);

  // Compare
  const comparison = compareTexts(originalText, rejectedText);

  console.log('\n=== ILPA INPLACE Reject Changes Comparison ===');
  console.log(`Original text length: ${comparison.expectedLength}`);
  console.log(`Rejected text length: ${comparison.actualLength}`);
  console.log(`Match percentage: ${((comparison.actualLength / comparison.expectedLength) * 100).toFixed(2)}%`);
  console.log(`Identical: ${comparison.identical}`);
  console.log(`Normalized identical: ${comparison.normalizedIdentical}`);

  if (!comparison.normalizedIdentical) {
    console.log('\nFirst differences:');
    comparison.differences.forEach(d => console.log(`  ${d}`));

    // Show a text diff (first 50 differing lines)
    console.log('\n=== Text Diff (first 50 lines) ===');
    const originalLines = originalText.split('\n');
    const rejectedLines = rejectedText.split('\n');

    let diffCount = 0;
    const maxDiffs = 50;

    for (let i = 0; i < Math.max(originalLines.length, rejectedLines.length) && diffCount < maxDiffs; i++) {
      const orig = originalLines[i] ?? '<missing>';
      const rej = rejectedLines[i] ?? '<missing>';

      if (orig !== rej) {
        diffCount++;
        console.log(`\nLine ${i + 1}:`);
        console.log(`  ORIGINAL: "${orig.slice(0, 100)}${orig.length > 100 ? '...' : ''}"`);
        console.log(`  REJECTED: "${rej.slice(0, 100)}${rej.length > 100 ? '...' : ''}"`);
      }
    }

    console.log(`\n\nTotal differing lines shown: ${diffCount}`);
    console.log(`Total original lines: ${originalLines.length}`);
    console.log(`Total rejected lines: ${rejectedLines.length}`);
  }
}

main().catch(console.error);
