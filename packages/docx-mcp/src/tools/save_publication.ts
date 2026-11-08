import fs, { type FileHandle } from 'node:fs/promises';
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
  state: 'prepared' | 'staged' | 'backed-up' | 'publishing' | 'published' | 'restored' | 'recovery-needed';
  directory?: string;
  stage?: string;
  backup?: string;
  backupVerified?: boolean;
  originalBytes?: Buffer;
  stagedBytes?: Buffer;
  handle?: FileHandle;
  created?: Stats;
  createdByUs?: boolean;
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
 * external writers can still race these checks. Existing inodes are written
 * through to retain their security metadata; new outputs use exclusive creation.
 * The pair is NOT crash atomic, including across filesystems.
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
  // their specific diagnostic. Keep the conservative unrelated-hardlink refusal:
  // changing one name would also change every other linked consumer's contents.
  const groups = new Map<string, AliasProbeGroup>();
  for (const entry of entries) {
    if (entry.original) {
      if (!entry.original.isFile()) throw new Error(`Output is not a regular file: ${entry.destination}`);
      if (entry.original.nlink > 1) {
        throw new SavePublicationError(`Refusing to change output with unrelated hardlinks: ${entry.destination}`, 'HARDLINK_OUTPUT_UNSUPPORTED');
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
      ...(entry.backupVerified && entry.backup ? { backup_path: entry.backup } : {}),
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

  const sameInode = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
  const checkIdentity = async (entry: Entry) => {
    const info = await fs.lstat(entry.destination);
    const expected = entry.original ?? entry.created;
    if (!expected || !info.isFile() || !sameInode(info, expected)) {
      throw new Error(`Output identity changed: ${entry.destination}`);
    }
  };
  const writeThrough = async (entry: Entry, bytes: Buffer) => {
    let position = 0;
    while (position < bytes.length) {
      const { bytesWritten } = await entry.handle!.write(bytes, position, bytes.length - position, position);
      if (bytesWritten <= 0) throw new Error(`No write progress: ${entry.destination}`);
      position += bytesWritten;
    }
    await entry.handle!.truncate(bytes.length);
  };
  const closeHandle = async (entry: Entry) => {
    if (!entry.handle) return;
    const handle = entry.handle;
    try { await handle.close(); entry.handle = undefined; }
    finally { if (handle.fd === -1) entry.handle = undefined; }
  };
  const closeDuringRecovery = async (entry: Entry) => {
    try { await closeHandle(entry); }
    catch (e) { entry.state = 'recovery-needed'; report(entry, 'close-output-handle', entry.destination, e); }
  };
  const removeBackup = async (entry: Entry) => {
    if (!entry.backup) return;
    const backup = entry.backup;
    try { await fs.unlink(backup); entry.backup = undefined; }
    catch (e) { report(entry, entry.backupVerified ? 'remove-backup' : 'remove-incomplete-backup', backup, e); }
  };

  try {
    for (const entry of entries) {
      await fs.mkdir(path.dirname(entry.destination), { recursive: true });
      entry.directory = await fs.mkdtemp(path.join(path.dirname(entry.destination), '.safe-docx-save-'));
      // Register the stage before writeFile: a partial write must also be cleaned.
      entry.stage = path.join(entry.directory, 'staged');
      await fs.writeFile(entry.stage, entry.buffer, { flag: 'wx', mode: 0o600 });
      entry.stagedBytes = await fs.readFile(entry.stage);
      if (!entry.stagedBytes.equals(entry.buffer)) throw new Error(`Incomplete staged bytes: ${entry.stage}`);
      entry.state = 'staged';
    }
    for (const entry of entries) {
      if (entry.original) {
        // Open without truncation, then check the opened inode before relying on
        // its bytes. Keeping this handle lets publication and rollback preserve
        // ownership, ACLs, xattrs and inode identity without metadata cloning.
        entry.handle = await fs.open(entry.destination, 'r+');
        const opened = await entry.handle.stat();
        if (!opened.isFile() || !sameInode(opened, entry.original) || opened.nlink > 1) {
          throw new Error(`Output identity changed before backup: ${entry.destination}`);
        }
        const bytes = await entry.handle.readFile();
        entry.backup = path.join(entry.directory!, 'original');
        await fs.writeFile(entry.backup, bytes, { flag: 'wx', mode: 0o600 });
        const verified = await fs.readFile(entry.backup);
        if (!verified.equals(bytes)) throw new Error(`Incomplete backup bytes: ${entry.backup}`);
        entry.originalBytes = verified;
        entry.backupVerified = true;
        entry.state = 'backed-up';
      }
    }
    for (const entry of entries) {
      if (entry.original) await checkIdentity(entry);
      else {
        // An unexpected file created after preflight belongs to its creator.
        // Never truncate it, and never remove it if exclusive open fails.
        entry.handle = await fs.open(entry.destination, 'wx');
        entry.createdByUs = true;
        entry.created = await entry.handle.stat();
      }
      // A rejected write/truncate may already have changed bytes. Register the
      // start, not merely successful completion, so this very target rolls back.
      entry.state = 'publishing';
      await writeThrough(entry, entry.stagedBytes!);
      entry.state = 'published';
    }
    // Closing a writable handle can itself fail. Keep verified backups until
    // every output has closed successfully; only then is the pair committed.
    for (const entry of entries) await closeHandle(entry);
  } catch (cause) {
    for (const entry of [...entries].reverse()) {
      if (entry.original && (entry.state === 'publishing' || entry.state === 'published')) {
        try {
          if (!entry.backupVerified || !entry.originalBytes) throw new Error('Missing verified original bytes');
          await checkIdentity(entry);
          if (!entry.handle) {
            entry.handle = await fs.open(entry.destination, 'r+');
            if (!sameInode(await entry.handle.stat(), entry.original)) throw new Error(`Output identity changed during recovery: ${entry.destination}`);
          }
          await writeThrough(entry, entry.originalBytes);
          entry.state = 'restored';
        } catch (e) { entry.state = 'recovery-needed'; report(entry, 'restore-original', entry.destination, e); }
      } else if (entry.createdByUs) {
        try {
          entry.created ??= await entry.handle!.stat();
          await checkIdentity(entry);
          try { await closeHandle(entry); }
          catch (e) { if (entry.handle) throw e; }
          if (entry.handle) throw new Error(`Cannot remove new output with unclosed handle: ${entry.destination}`);
          await fs.unlink(entry.destination);
          entry.state = 'restored';
        }
        catch (e) { entry.state = 'recovery-needed'; report(entry, 'remove-new-output', entry.destination, e); }
      }
      await closeDuringRecovery(entry);
      if (entry.state !== 'recovery-needed' && !entry.handle) await removeBackup(entry);
      await cleanup(entry);
    }
    throw new SavePublicationError(
      `${errorMessage(cause)}${failures.length ? `; recovery needed: ${JSON.stringify(failures)}` : ''}`,
      failures.length ? 'SAVE_ERROR' : String(errorCode(cause) ?? 'SAVE_ERROR'), failures, { cause },
    );
  }

  // Commit boundary: both files now contain requested bytes. Cleanup errors are
  // diagnostics; a failed restore's verified backup is never discarded.
  for (const entry of entries) {
    if (!entry.handle) await removeBackup(entry);
    await cleanup(entry);
  }
  return failures;
}
