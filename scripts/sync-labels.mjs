#!/usr/bin/env node
// Sync repository labels with .github/labels.json.
//
//   node scripts/sync-labels.mjs                  # dry run: print planned changes
//   node scripts/sync-labels.mjs --apply          # create and update labels
//   node scripts/sync-labels.mjs --apply --prune  # also delete labels listed as retired
//
// Idempotent: a second --apply run plans no changes. Labels that exist on
// GitHub but are neither declared nor retired are reported and left alone.
// Requires an authenticated `gh` CLI.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, '.github/labels.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const prune = process.argv.includes('--prune');
const repoFlag = process.argv.find((a) => a.startsWith('--repo='));
const repoArgs = repoFlag ? ['--repo', repoFlag.slice('--repo='.length)] : [];

const gh = (args) => execFileSync('gh', [...args, ...repoArgs], { encoding: 'utf8' });

const existing = new Map(
  JSON.parse(gh(['label', 'list', '--limit', '500', '--json', 'name,color,description'])).map((l) => [
    l.name.toLowerCase(),
    l,
  ]),
);

const declared = new Set(config.labels.map((l) => l.name.toLowerCase()));
const retired = new Set(config.retired.map((l) => l.name.toLowerCase()));
const plan = [];

for (const label of config.labels) {
  const current = existing.get(label.name.toLowerCase());
  const want = { color: label.color.toLowerCase(), description: label.description ?? '' };
  if (!current) {
    plan.push({ op: 'create', label, args: ['label', 'create', label.name, '--color', want.color, '--description', want.description] });
  } else if (current.name !== label.name || current.color.toLowerCase() !== want.color || (current.description ?? '') !== want.description) {
    plan.push({ op: 'update', label, args: ['label', 'edit', current.name, '--name', label.name, '--color', want.color, '--description', want.description] });
  }
}

for (const label of config.retired) {
  if (existing.has(label.name.toLowerCase())) {
    plan.push({ op: prune ? 'delete' : 'retired (kept; pass --prune to delete)', label, args: prune ? ['label', 'delete', label.name, '--yes'] : null });
  }
}

const unknown = [...existing.values()].filter((l) => !declared.has(l.name.toLowerCase()) && !retired.has(l.name.toLowerCase()));

for (const step of plan) console.log(`${apply && step.args ? '' : '[dry-run] '}${step.op}: ${step.label.name}`);
for (const l of unknown) console.log(`undeclared (left alone): ${l.name}`);
if (plan.length === 0) console.log('Labels already match .github/labels.json.');

if (apply) {
  for (const step of plan) if (step.args) gh(step.args);
  console.log(`Applied ${plan.filter((s) => s.args).length} change(s).`);
}
