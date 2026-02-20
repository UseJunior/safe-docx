#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type DiscoveryCandidate = {
  source_path: string;
  source_type: 'local_repo' | 'open_agreements_optional';
  category: string;
  provenance: string;
  size_bytes: number;
  sha256: string;
};

type DiscoveryReport = {
  schema_version: 'safe-docx-fixture-discovery/v1';
  generated_at: string;
  repo_root: string;
  open_agreements_root?: string;
  candidates: DiscoveryCandidate[];
};

type CliArgs = {
  outPath?: string;
  repoRoot: string;
  openAgreementsRoot?: string;
};

function parseArgs(argv: string[]): CliArgs {
  let outPath: string | undefined;
  let repoRoot = '';
  let openAgreementsRoot = process.env.SAFE_DOCX_CONFORMANCE_OPEN_AGREEMENTS_ROOT;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '--out' && next) {
      outPath = next;
      i += 1;
      continue;
    }
    if (arg === '--repo-root' && next) {
      repoRoot = next;
      i += 1;
      continue;
    }
    if (arg === '--open-agreements-root' && next) {
      openAgreementsRoot = next;
      i += 1;
      continue;
    }
  }

  if (!repoRoot) {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    repoRoot = path.resolve(packageRoot, '../..');
  }

  return { outPath, repoRoot, openAgreementsRoot };
}

async function walkDocxFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

async function fileSha256(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function inferCategory(relPath: string): string {
  if (relPath.startsWith('packages/docx-comparison/src/testing/fixtures/')) return 'docx_comparison_fixture';
  if (relPath.startsWith('tests/golden/document_editing/scenarios/')) return 'golden_document_editing';
  if (relPath.startsWith('test_contracts/')) return 'contract_sample';
  if (relPath.startsWith('templates/')) return 'openagreements_template';
  if (relPath.startsWith('external/')) return 'openagreements_external_template';
  return 'misc_docx';
}

async function gatherRepoCandidates(repoRoot: string): Promise<DiscoveryCandidate[]> {
  const roots = [
    'packages/docx-comparison/src/testing/fixtures',
    'tests/golden/document_editing/scenarios',
    'test_contracts',
  ];
  const candidates: DiscoveryCandidate[] = [];

  for (const relRoot of roots) {
    const absRoot = path.resolve(repoRoot, relRoot);
    try {
      const files = await walkDocxFiles(absRoot);
      for (const absFile of files) {
        const stat = await fs.stat(absFile);
        const sourcePath = path.relative(repoRoot, absFile).replaceAll(path.sep, '/');
        candidates.push({
          source_path: sourcePath,
          source_type: 'local_repo',
          category: inferCategory(sourcePath),
          provenance: `repo:${relRoot}`,
          size_bytes: stat.size,
          sha256: await fileSha256(absFile),
        });
      }
    } catch {
      // Skip missing roots.
    }
  }
  return candidates;
}

async function gatherOpenAgreementsCandidates(openAgreementsRoot: string): Promise<DiscoveryCandidate[]> {
  const roots = ['templates', 'external'];
  const candidates: DiscoveryCandidate[] = [];
  for (const relRoot of roots) {
    const absRoot = path.resolve(openAgreementsRoot, relRoot);
    try {
      const files = await walkDocxFiles(absRoot);
      for (const absFile of files) {
        const stat = await fs.stat(absFile);
        const sourcePath = path.relative(openAgreementsRoot, absFile).replaceAll(path.sep, '/');
        candidates.push({
          source_path: sourcePath,
          source_type: 'open_agreements_optional',
          category: inferCategory(sourcePath),
          provenance: `open_agreements:${relRoot}`,
          size_bytes: stat.size,
          sha256: await fileSha256(absFile),
        });
      }
    } catch {
      // Skip missing roots.
    }
  }
  return candidates;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const localCandidates = await gatherRepoCandidates(args.repoRoot);
  const externalCandidates = args.openAgreementsRoot
    ? await gatherOpenAgreementsCandidates(args.openAgreementsRoot)
    : [];

  const report: DiscoveryReport = {
    schema_version: 'safe-docx-fixture-discovery/v1',
    generated_at: new Date().toISOString(),
    repo_root: args.repoRoot,
    open_agreements_root: args.openAgreementsRoot,
    candidates: [...localCandidates, ...externalCandidates],
  };

  const serialized = JSON.stringify(report, null, 2);
  if (args.outPath) {
    const out = path.resolve(args.outPath);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, `${serialized}\n`, 'utf8');
  }
  process.stdout.write(`${serialized}\n`);
}

main().catch((err) => {
  process.stderr.write(`fixture discovery failed: ${String(err?.message ?? err)}\n`);
  process.exit(1);
});
