import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { errorCode, errorMessage } from '../error_utils.js';

export type SaveOutput = { destination: string; buffer: Buffer };
export type RecoveryFailure = {
  path: string;
  operation: string;
  error: string;
  backup_path?: string;
  staging_path?: string;
};

export class SavePublicationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly rollbackFailures: RecoveryFailure[] = [],
    options?: ErrorOptions,
  ) { super(message, options); }
}

type Entry = SaveOutput & {
  original: Stats | null;
  state: 'prepared' | 'staged' | 'backed-up' | 'published' | 'restored' | 'recovery-needed';
  directory?: string;
  stage?: string;
  backup?: string;
};
type AliasProbeGroup = {
  ancestor: string;
  entries: { destination: string; original: Stats | null; suffix: string }[];
};

async function statOrMissing(destination: string): Promise<Stats | null> {
  try { return await fs.lstat(destination); }
  catch (e) { if (errorCode(e) === 'ENOENT') return null; throw e; }
}

async function checkParent(destination: string): Promise<{ path: string; info: Stats }> {
  let parent = path.dirname(destination);
  while (true) {
    const info = await statOrMissing(parent);
    if (info) {
      if (!info.isDirectory()) throw new Error(`Output parent is not a directory: ${parent}`);
      await fs.access(parent, constants.W_OK | constants.X_OK);
      return { path: parent, info };
    }
    parent = path.dirname(parent);
  }
}

/** Observe name equivalence on the target filesystem, including missing parents.
 * Mirror only missing suffixes in a private directory under their actual existing
 * ancestor. Exclusive creation detects case/normalization aliases without assuming
 * that every volume (or directory) has the same name comparison rules.
 */
async function checkMissingAliases(groups: Map<string, AliasProbeGroup>): Promise<void> {
  for (const { ancestor, entries } of groups.values()) {
    if (entries.length < 2 || entries.every(entry => entry.original)) continue;
    const directory = await fs.mkdtemp(path.join(ancestor, '.safe-docx-probe-'));
    const files: string[] = [];
    const directories = [directory];
    const failures: RecoveryFailure[] = [];
    let cause: unknown;
    try {
      for (const entry of entries) {
        const parts = entry.suffix.split(path.sep);
        let parent = directory;
        for (const part of parts.slice(0, -1)) {
          parent = path.join(parent, part);
          try { await fs.mkdir(parent); directories.push(parent); }
          catch (e) {
            if (errorCode(e) !== 'EEXIST' || !(await fs.lstat(parent)).isDirectory()) throw e;
          }
        }
        const probe = path.join(parent, parts[parts.length - 1]!);
        let handle;
        try { handle = await fs.open(probe, 'wx'); }
        catch (e) {
          if (errorCode(e) === 'EEXIST') {
            throw new SavePublicationError(`Save outputs alias on the destination filesystem: ${entries.map(item => item.destination).join(', ')}`, 'ALIASED_OUTPUT_PATHS');
          }
          throw e;
        }
        files.push(probe);
        await handle.close();
      }
    } catch (e) { cause = e; }
    // Only remove names this probe created. Never recursively remove a path.
    for (const file of files.reverse()) {
      try { await fs.unlink(file); }
      catch (e) { failures.push({ path: file, staging_path: file, operation: 'remove-alias-probe', error: errorMessage(e) }); }
    }
    for (const dir of directories.reverse()) {
      try { await fs.rmdir(dir); }
      catch (e) { failures.push({ path: dir, operation: 'remove-alias-probe-directory', error: errorMessage(e) }); }
    }
    if (failures.length) {
      throw new SavePublicationError(`${cause ? errorMessage(cause) : 'Alias probe cleanup failed'}; recovery needed: ${JSON.stringify(failures)}`, 'SAVE_ERROR', failures, { cause });
    }
    if (cause) throw cause;
  }
}

/**
 * Inputs are canonical write targets from path policy. Preflight is observational:
 * external writers can still race these checks. Each rename stays on its target
 * filesystem; the pair is NOT crash atomic, including across filesystems.
 */
export async function publishSaveOutputs(outputs: SaveOutput[]): Promise<RecoveryFailure[]> {
  const entries: Entry[] = [];
  for (const output of outputs) {
    const destination = path.resolve(output.destination);
    const original = await statOrMissing(destination);
    if (entries.some(entry => entry.destination === destination
      || (original && entry.original && original.dev === entry.original.dev && original.ino === entry.original.ino))) {
      throw new SavePublicationError(`Save outputs alias the same file: ${entries.map(e => e.destination).join(', ')}; ${destination}`, 'ALIASED_OUTPUT_PATHS');
    }
    entries.push({ ...output, destination, original, state: 'prepared' });
  }
  // Check aliases before rejecting multiply linked files to give paired aliases
  // their specific diagnostic. Reject other hardlinks rather than splitting them.
  const groups = new Map<string, AliasProbeGroup>();
  for (const entry of entries) {
    if (entry.original) {
      if (!entry.original.isFile()) throw new Error(`Output is not a regular file: ${entry.destination}`);
      if (entry.original.nlink > 1) {
        throw new SavePublicationError(`Cannot replace hardlinked output without changing link semantics: ${entry.destination}`, 'HARDLINK_OUTPUT_UNSUPPORTED');
      }
      await fs.access(entry.destination, constants.W_OK);
    }
    const parent = await checkParent(entry.destination);
    const key = `${parent.info.dev}:${parent.info.ino}`;
    const group = groups.get(key) ?? { ancestor: parent.path, entries: [] };
    // Compute the suffix using this entry's own ancestor spelling. Two existing
    // ancestor spellings may have one inode; relative paths between their lexical
    // spellings could contain '..' and escape a private probe directory.
    group.entries.push({ destination: entry.destination, original: entry.original,
      suffix: path.relative(parent.path, entry.destination) });
    groups.set(key, group);
  }
  await checkMissingAliases(groups);

  const failures: RecoveryFailure[] = [];
  const report = (entry: Entry, operation: string, filePath: string, e: unknown) => {
    failures.push({ path: filePath, operation, error: errorMessage(e),
      ...(entry.backup ? { backup_path: entry.backup } : {}),
      ...(operation === 'remove-stage' && entry.stage ? { staging_path: entry.stage } : {}) });
  };
  const cleanup = async (entry: Entry) => {
    if (entry.stage) {
      const stage = entry.stage;
      try { await fs.unlink(stage); entry.stage = undefined; }
      catch (e) {
        if (errorCode(e) === 'ENOENT') entry.stage = undefined;
        else report(entry, 'remove-stage', stage, e);
      }
    }
    if (entry.directory && !entry.stage && !entry.backup) {
      try { await fs.rmdir(entry.directory); }
      catch (e) { report(entry, 'remove-staging-directory', entry.directory, e); }
    }
  };

  try {
    for (const entry of entries) {
      await fs.mkdir(path.dirname(entry.destination), { recursive: true });
      entry.directory = await fs.mkdtemp(path.join(path.dirname(entry.destination), '.safe-docx-save-'));
      // Register the stage before writeFile: a partial write must also be cleaned.
      entry.stage = path.join(entry.directory, 'staged');
      await fs.writeFile(entry.stage, entry.buffer, { flag: 'wx' });
      if (entry.original) await fs.chmod(entry.stage, entry.original.mode & 0o7777);
      entry.state = 'staged';
    }
    for (const entry of entries) {
      if (entry.original) {
        const backup = path.join(entry.directory!, 'original');
        await fs.rename(entry.destination, backup);
        entry.backup = backup;
        entry.state = 'backed-up';
      }
    }
    for (const entry of entries) {
      await fs.rename(entry.stage!, entry.destination);
      entry.stage = undefined;
      entry.state = 'published';
    }
  } catch (cause) {
    for (const entry of [...entries].reverse()) {
      if (entry.backup) {
        try {
          await fs.rename(entry.backup, entry.destination);
          entry.backup = undefined;
          entry.state = 'restored';
        } catch (e) { entry.state = 'recovery-needed'; report(entry, 'restore-original', entry.destination, e); }
      } else if (entry.state === 'published') {
        try { await fs.unlink(entry.destination); entry.state = 'restored'; }
        catch (e) { entry.state = 'recovery-needed'; report(entry, 'remove-new-output', entry.destination, e); }
      }
      await cleanup(entry);
    }
    throw new SavePublicationError(
      `${errorMessage(cause)}${failures.length ? `; recovery needed: ${JSON.stringify(failures)}` : ''}`,
      failures.length ? 'SAVE_ERROR' : String(errorCode(cause) ?? 'SAVE_ERROR'), failures, { cause },
    );
  }

  // Commit boundary: both files now contain requested bytes. Cleanup failure
  // cannot be called a rolled-back save after some backups have been discarded.
  for (const entry of entries) {
    if (entry.backup) {
      const backup = entry.backup;
      try { await fs.unlink(backup); entry.backup = undefined; }
      catch (e) { report(entry, 'remove-backup', backup, e); }
    }
    await cleanup(entry);
  }
  return failures;
}
