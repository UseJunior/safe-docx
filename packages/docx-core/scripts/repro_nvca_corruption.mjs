
import { compareDocumentsAtomizer } from '../dist/index.js';
import fs from 'fs';
import path from 'path';

const sourcePath = process.argv[2];
const revisedPath = process.argv[3];
const outputPath = process.argv[4] || 'tmp-repro-redline.docx';

if (!sourcePath || !revisedPath) {
  console.error('Usage: node repro_nvca_corruption.mjs <source.docx> <revised.docx> [output.docx]');
  process.exit(1);
}

async function run() {
  const sourceBuf = fs.readFileSync(sourcePath);
  const revisedBuf = fs.readFileSync(revisedPath);

  console.log(`Comparing ${sourcePath} vs ${revisedPath} (FORCED INPLACE)`);
  
  const res = await compareDocumentsAtomizer(sourceBuf, revisedBuf, {
    reconstructionMode: 'inplace',
    author: 'Repro'
  });

  console.log('Mode used:', res.reconstructionModeUsed);
  if (res.fallbackReason) {
    console.log('Fallback reason:', res.fallbackReason);
    console.log('First diff summary:', JSON.stringify(res.fallbackDiagnostics?.attempts?.[0]?.firstDiffSummary, null, 2));
  }

  fs.writeFileSync(outputPath, res.document);
  console.log(`Saved FORCED INPLACE redline to ${outputPath}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
