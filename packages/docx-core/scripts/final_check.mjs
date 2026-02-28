
import { compareDocuments } from '../dist/index.js';
import fs from 'fs';

const sourcePath = process.argv[2];
const revisedPath = process.argv[3];

async function run() {
  const sourceBuf = fs.readFileSync(sourcePath);
  const revisedBuf = fs.readFileSync(revisedPath);

  console.log(`Comparing ${sourcePath} vs ${revisedPath}`);
  
  const res = await compareDocuments(sourceBuf, revisedBuf, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
    author: 'FinalCheck',
    includeFallbackDiagnostics: true
  });

  console.log(JSON.stringify({
    modeUsed: res.reconstructionModeUsed,
    fallbackReason: res.fallbackReason,
    stats: res.stats,
    attempts: res.fallbackDiagnostics?.attempts?.map(a => ({
      pass: a.pass,
      failedChecks: a.failedChecks,
      firstDiff: a.checks?.rejectText?.diffs?.[0]
    }))
  }, null, 2));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
