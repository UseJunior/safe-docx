import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareDocuments } from './dist/index.js';
import { rejectAllChanges, extractTextWithParagraphs } from './dist/baselines/atomizer/trackChangesAcceptorAst.js';
import { DocxArchive } from './dist/shared/docx/DocxArchive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');
const outputDir = join(__dirname, 'src/testing/outputs');

const ORIGINAL_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');
const REVISED_DOC = join(projectRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');

async function main() {
  console.log('Loading ILPA documents...');
  const [originalBuffer, revisedBuffer] = await Promise.all([
    readFile(ORIGINAL_DOC),
    readFile(REVISED_DOC),
  ]);

  console.log('Running comparison with REBUILD mode...');
  const result = await compareDocuments(originalBuffer, revisedBuffer, {
    engine: 'atomizer',
    reconstructionMode: 'rebuild',
  });

  console.log('\nExtracting text after rejecting changes...');
  const resultArchive = await DocxArchive.load(result.document);
  const resultXml = await resultArchive.getDocumentXml();
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'rebuild_comparison_result.xml'), resultXml);

  const rejectedXml = rejectAllChanges(resultXml);
  await writeFile(join(outputDir, 'rebuild_rejected.xml'), rejectedXml);

  const rejectedText = extractTextWithParagraphs(rejectedXml);
  await writeFile(join(outputDir, 'rebuild_rejected_text.txt'), rejectedText);

  console.log('Done. Checking line 170-180:');
}

main().catch(console.error);
