import { describe, expect, afterEach } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  enforceReadPathPolicy,
  enforceWritePathPolicy,
  getPlatformTempDefaults,
} from './path_policy.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Path Policy' });

const tmpDirs: string[] = [];

afterEach(async () => {
  // Restore env
  delete process.env.SAFE_DOCX_ALLOWED_ROOTS;
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('enforceReadPathPolicy', () => {
  test('allows paths within home directory', async () => {
    // Create a real temp file under a default allowed root (tmpdir)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-test-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, 'test');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(true);
  });

  test('rejects non-existent paths with PATH_RESOLUTION_ERROR', async () => {
    const result = await enforceReadPathPolicy('/nonexistent/path/to/file.docx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_RESOLUTION_ERROR');
      }
    }
  });

  test('rejects paths outside allowed roots with PATH_NOT_ALLOWED', async () => {
    // Configure a specific allowed root
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-allowed-'));
    tmpDirs.push(tmpDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = tmpDir;

    // Create a file in a different temp dir
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-other-'));
    tmpDirs.push(otherDir);
    const filePath = path.join(otherDir, 'test.docx');
    await fs.writeFile(filePath, 'test');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
      }
    }
  });

  test('allows paths under tmpdir by default', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-tmp-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'data');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalizedPath).toBeTruthy();
      expect(result.resolvedPath).toBeTruthy();
      expect(result.allowedRoots.length).toBeGreaterThan(0);
    }
  });

  test('allows paths under the common POSIX /tmp directory by default', async () => {
    if (process.platform === 'win32') return;

    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'policy-system-tmp-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, 'data');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.allowedRoots).toContain(await fs.realpath('/tmp'));
    }
  });

  test('explicit allowed roots override the default POSIX /tmp allowance', async () => {
    if (process.platform === 'win32') return;

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-explicit-allowed-'));
    tmpDirs.push(allowedDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedDir;

    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'policy-explicit-tmp-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.docx');
    await fs.writeFile(filePath, 'data');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
      }
    }
  });

  test('PATH_NOT_ALLOWED hint omits the $VAR prefix when SAFE_DOCX_ALLOWED_ROOTS is unset', async () => {
    delete process.env.SAFE_DOCX_ALLOWED_ROOTS;

    // Reject by pointing at a path under the root which is outside every default
    // root (HOME, os.tmpdir(), platform temp). On macOS '/private/etc' is real
    // but not a default; on Linux '/etc' suffices. realpath must succeed for
    // the read path policy to reach the policy-error branch.
    const candidate = process.platform === 'darwin' ? '/private/etc/hosts' : '/etc/hosts';

    const result = await enforceReadPathPolicy(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
        const hint = result.response.error.hint ?? '';
        expect(hint).toContain('SAFE_DOCX_ALLOWED_ROOTS=');
        expect(hint).not.toContain('$SAFE_DOCX_ALLOWED_ROOTS');
      }
    }
  });

  test('PATH_NOT_ALLOWED hint includes a delimiter-aware SAFE_DOCX_ALLOWED_ROOTS fix', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-hint-allowed-'));
    tmpDirs.push(allowedDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedDir;

    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-hint-other-'));
    tmpDirs.push(otherDir);
    const filePath = path.join(otherDir, 'test.docx');
    await fs.writeFile(filePath, 'test');

    const result = await enforceReadPathPolicy(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        const realOtherDir = await fs.realpath(otherDir);
        expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
        expect(result.response.error.hint).toContain('SAFE_DOCX_ALLOWED_ROOTS=');
        expect(result.response.error.hint).toContain(`$SAFE_DOCX_ALLOWED_ROOTS${path.delimiter}${realOtherDir}`);
      }
    }
  });

  test('expands tilde in path', async () => {
    // This test verifies tilde expansion works; the actual resolution
    // may fail if file doesn't exist, but the normalization should work
    const result = await enforceReadPathPolicy('~/nonexistent-test-file.docx');
    // It should either succeed (if home is allowed and something happens)
    // or fail with PATH_RESOLUTION_ERROR (file doesn't exist)
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_RESOLUTION_ERROR');
      }
    }
  });

  test('allows access when allowed root and file path differ only by symlink (e.g. /tmp vs /private/tmp)', async () => {
    if (process.platform === 'win32') return;

    // Create a real backing directory and a sibling symlink that points at it.
    // This mirrors macOS's `/tmp` → `/private/tmp` topology in miniature so the
    // assertion holds on Linux too.
    const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-real-'));
    tmpDirs.push(realDir);
    const symlinkRoot = path.join(os.tmpdir(), `policy-symlink-${process.pid}-${Date.now()}`);
    await fs.symlink(realDir, symlinkRoot);
    tmpDirs.push(symlinkRoot);

    const filePath = path.join(realDir, 'doc.docx');
    await fs.writeFile(filePath, 'data');

    // Allowed root = the symlink form. File access path = the real form.
    process.env.SAFE_DOCX_ALLOWED_ROOTS = symlinkRoot;
    const viaReal = await enforceReadPathPolicy(filePath);
    expect(viaReal.ok).toBe(true);

    // And the inverse: allowed root = real form, access via symlink form.
    process.env.SAFE_DOCX_ALLOWED_ROOTS = realDir;
    const viaSymlink = await enforceReadPathPolicy(path.join(symlinkRoot, 'doc.docx'));
    expect(viaSymlink.ok).toBe(true);
  });
});

describe('enforceWritePathPolicy', () => {
  test('allows write to path within allowed roots', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-write-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'output.docx');

    const result = await enforceWritePathPolicy(filePath);
    expect(result.ok).toBe(true);
  });

  test('allows write paths under the common POSIX /tmp directory by default', async () => {
    if (process.platform === 'win32') return;

    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'policy-system-write-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'output.docx');

    const result = await enforceWritePathPolicy(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.allowedRoots).toContain(await fs.realpath('/tmp'));
    }
  });

  test('allows write to non-existent file in existing directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-write-'));
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'does-not-exist.docx');

    const result = await enforceWritePathPolicy(filePath);
    expect(result.ok).toBe(true);
  });

  test('rejects write to path outside allowed roots', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-allowed-'));
    tmpDirs.push(tmpDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = tmpDir;

    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-other-'));
    tmpDirs.push(otherDir);
    const filePath = path.join(otherDir, 'output.docx');

    const result = await enforceWritePathPolicy(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
      }
    }
  });

  test('resolves path through existing ancestor directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-ancestor-'));
    tmpDirs.push(tmpDir);
    // The nested dir doesn't exist yet, but the ancestor does
    const filePath = path.join(tmpDir, 'nonexistent-sub', 'output.docx');

    const result = await enforceWritePathPolicy(filePath);
    expect(result.ok).toBe(true);
  });

  // Issue #313: the final path component must be canonicalized too, not just its existing ancestor.
  // Otherwise an in-root symlink output is policy-checked at the link's location while `fs.writeFile`
  // follows it and writes outside the allowed roots. Both an *existing*-target and a *dangling* link
  // must be caught — the dangling case is the one a naive `realpath(full path)` fix misses.

  test('rejects write through an existing symlink whose target is outside allowed roots', async () => {
    if (process.platform === 'win32') return;

    const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-symlink-allowed-'));
    tmpDirs.push(allowedRoot);
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-symlink-outside-'));
    tmpDirs.push(outsideDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

    // An existing file outside the root, and an in-root symlink pointing at it.
    const outsideTarget = path.join(outsideDir, 'target.docx');
    await fs.writeFile(outsideTarget, 'outside');
    const link = path.join(allowedRoot, 'link.docx');
    await fs.symlink(outsideTarget, link);

    const result = await enforceWritePathPolicy(link);
    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.success) {
      expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
    }
  });

  test('rejects write through a dangling symlink whose target is outside allowed roots, and never creates it', async () => {
    if (process.platform === 'win32') return;

    const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-dangling-allowed-'));
    tmpDirs.push(allowedRoot);
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-dangling-outside-'));
    tmpDirs.push(outsideDir);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

    // The parent dir exists, but the target file does not — a dangling link. `fs.realpath(link)`
    // throws here, so the fix must `readlink` + follow it manually.
    const outsideTarget = path.join(outsideDir, 'created-by-write.docx');
    const link = path.join(allowedRoot, 'dangling-link.docx');
    await fs.symlink(outsideTarget, link);

    const result = await enforceWritePathPolicy(link);
    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.success) {
      expect(result.response.error.code).toBe('PATH_NOT_ALLOWED');
    }
    // The policy check must not have created the target through the link.
    await expect(fs.access(outsideTarget)).rejects.toThrow();
  });

  test('allows write through a dangling symlink whose target is inside an allowed root', async () => {
    if (process.platform === 'win32') return;

    const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-dangling-inside-'));
    tmpDirs.push(allowedRoot);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

    const inRootTarget = path.join(allowedRoot, 'created-inside.docx');
    const link = path.join(allowedRoot, 'inside-link.docx');
    await fs.symlink(inRootTarget, link);

    const result = await enforceWritePathPolicy(link);
    expect(result.ok).toBe(true);
  });

  test('reports a resolution error for a symlink cycle rather than hanging', async () => {
    if (process.platform === 'win32') return;

    const allowedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-cycle-'));
    tmpDirs.push(allowedRoot);
    process.env.SAFE_DOCX_ALLOWED_ROOTS = allowedRoot;

    const a = path.join(allowedRoot, 'a.docx');
    const b = path.join(allowedRoot, 'b.docx');
    await fs.symlink(b, a);
    await fs.symlink(a, b);

    const result = await enforceWritePathPolicy(a);
    expect(result.ok).toBe(false);
    if (!result.ok && !result.response.success) {
      expect(result.response.error.code).toBe('PATH_RESOLUTION_ERROR');
    }
  });
});

describe('getPlatformTempDefaults', () => {
  test('darwin includes /tmp and /private/tmp (canonical form of /tmp on macOS)', () => {
    expect(getPlatformTempDefaults('darwin')).toEqual(['/tmp', '/private/tmp']);
  });

  test('linux includes /tmp only — /private/tmp is not a real Linux path and would leave a ghost root', () => {
    expect(getPlatformTempDefaults('linux')).toEqual(['/tmp']);
  });

  test('win32 is empty — os.tmpdir() already covers %TEMP%/%TMP%', () => {
    expect(getPlatformTempDefaults('win32')).toEqual([]);
  });
});
