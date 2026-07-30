import { spawnSync } from 'node:child_process';

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export function runFreshLeanAudit({
  leanDirectory,
  buildTargets,
  auditFile,
  maxBuffer = DEFAULT_MAX_BUFFER,
}) {
  const build = spawnSync(
    'lake',
    ['build', ...buildTargets],
    { cwd: leanDirectory, encoding: 'utf8', maxBuffer },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) {
    return { phase: 'build', ...build };
  }

  const audit = spawnSync(
    'lake',
    ['env', 'lean', auditFile],
    { cwd: leanDirectory, encoding: 'utf8', maxBuffer },
  );
  if (audit.error) throw audit.error;
  return {
    phase: 'audit',
    ...audit,
    stdout: `${build.stdout}${audit.stdout}`,
    stderr: `${build.stderr}${audit.stderr}`,
  };
}
