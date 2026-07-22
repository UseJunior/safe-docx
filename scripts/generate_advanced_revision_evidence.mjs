import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = path.join(root, 'spec-compliance/evidence/ecma-376-advanced-revisions.json');
const testFiles = [
  'src/integration/advanced-revision-classification.test.ts',
  'src/primitives/layout.test.ts',
  'src/primitives/text.test.ts',
  'test-primitives/validate_ai_revisions.test.ts',
  'src/testing/revision-evidence.test.ts',
];

function canonicalize(lines) {
  const rows = lines.filter(Boolean).map((line) => JSON.parse(line));
  const keys = new Set();
  for (const row of rows) {
    const key = `${row.id}\u0000${row.element}\u0000${row.operation}\u0000${row.story}`;
    if (keys.has(key)) throw new Error(`Duplicate executed evidence row: ${key.replaceAll('\u0000', ' ')}`);
    keys.add(key);
  }
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return `${JSON.stringify({ schemaVersion: 2, generatedBy: 'npm run generate:advanced-revision-evidence', cases: rows }, null, 2)}\n`;
}

const tempDir = await mkdtemp(path.join(tmpdir(), 'safe-docx-revision-evidence-'));
const resultsPath = path.join(tempDir, 'results.jsonl');
try {
  const run = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      ...testFiles,
      '--testNamePattern', '\\[ADV-',
      '--maxWorkers', '1',
      '--no-file-parallelism',
    ],
    {
      cwd: path.join(root, 'packages/docx-core'),
      env: { ...process.env, SDX_REVISION_EVIDENCE_RESULTS: resultsPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.status !== 0) process.exit(run.status ?? 1);

  const generated = canonicalize((await readFile(resultsPath, 'utf8')).trim().split('\n'));
  if (process.argv.includes('--check')) {
    const committed = await readFile(artifactPath, 'utf8');
    if (committed !== generated) {
      console.error('Advanced-revision evidence artifact is stale; run npm run generate:advanced-revision-evidence');
      process.exit(1);
    }
    console.log('generate_advanced_revision_evidence: artifact is current');
  } else {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, generated);
    console.log(`generate_advanced_revision_evidence: wrote ${artifactPath}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
