import { describe, expect, afterEach } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { enforceReadPathPolicy, enforceWritePathPolicy } from './path_policy.js';
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
});
