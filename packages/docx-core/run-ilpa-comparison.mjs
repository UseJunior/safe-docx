import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { compareDocuments } from './dist/index.js';

const projectRoot = process.env.ILPA_FIXTURE_ROOT ?? process.cwd();
const ORIGINAL_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
const REVISED_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');

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

  const outputPath = join(process.cwd(), 'ILPA-comparison-result.docx');
  await writeFile(outputPath, result.document);
  console.log(`\nSaved comparison result to: ${outputPath}`);
}

main().catch(console.error);
