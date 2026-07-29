#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFreshLeanAudit } from './lean_audit_runner.mjs';

const directory = mkdtempSync(join(tmpdir(), 'safe-docx-lean-audit-freshness-'));
const toolchain = readFileSync(fileURLToPath(
  new URL('../verification/lean/lean-toolchain', import.meta.url),
), 'utf8');

try {
  writeFileSync(join(directory, 'lean-toolchain'), toolchain);
  writeFileSync(join(directory, 'lakefile.lean'), [
    'import Lake',
    'open Lake DSL',
    'package freshness',
    'lean_lib FreshnessFixture',
    '',
  ].join('\n'));
  writeFileSync(
    join(directory, 'FreshnessFixture.lean'),
    'theorem freshnessProbe : True := by trivial\n',
  );
  writeFileSync(
    join(directory, 'Audit.lean'),
    'import FreshnessFixture\n#check freshnessProbe\n',
  );

  const initial = runFreshLeanAudit({
    leanDirectory: directory,
    buildTargets: ['FreshnessFixture'],
    auditFile: 'Audit.lean',
  });
  if (initial.status !== 0) {
    throw new Error(
      `fresh audit fixture failed during ${initial.phase}:\n` +
      `${initial.stderr}${initial.stdout}`,
    );
  }

  const source = join(directory, 'FreshnessFixture.lean');
  writeFileSync(source, 'theorem freshnessProbe : False := by trivial\n');
  const future = new Date(Date.now() + 2000);
  utimesSync(source, future, future);

  const staleDirectAudit = spawnSync(
    'lake',
    ['env', 'lean', 'Audit.lean'],
    { cwd: directory, encoding: 'utf8' },
  );
  if (staleDirectAudit.status !== 0) {
    throw new Error(
      'regression fixture did not demonstrate stale direct-import acceptance',
    );
  }

  const guarded = runFreshLeanAudit({
    leanDirectory: directory,
    buildTargets: ['FreshnessFixture'],
    auditFile: 'Audit.lean',
  });
  if (guarded.phase !== 'build' || guarded.status === 0) {
    throw new Error(
      'freshness-safe audit certified source modified after its imported .olean',
    );
  }

  console.log(
    'Lean audit freshness regression passed: stale direct import was accepted ' +
    'and the mandatory source build rejected it',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
