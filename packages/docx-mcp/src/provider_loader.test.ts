import { describe, expect, vi } from 'vitest';
import { testAllure } from './testing/allure-test.js';
import { createProviderLoader } from './provider_loader.js';
import { loadGDocsCore, resetGDocsCoreLoaderForTesting, getGDocsCoreDiagnostic } from './gdocs_loader.js';
import { loadOdfCore, resetOdfCoreLoaderForTesting, getOdfCoreDiagnostic } from './odf_loader.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Provider Loader' });

describe('provider_loader', () => {
  test('pending state while import is in flight', async () => {
    let resolveImport!: (val: { name: string }) => void;
    const importer = () =>
      new Promise<{ name: string }>((resolve) => {
        resolveImport = resolve;
      });

    const loader = createProviderLoader(importer);
    expect(loader.state).toBe('idle');
    expect(loader.getDiagnostic()).toEqual({ state: 'idle' });

    const loadPromise = loader.load();
    expect(loader.state).toBe('pending');
    expect(loader.getDiagnostic()).toEqual({ state: 'pending' });

    resolveImport({ name: 'mock-provider' });
    const result = await loadPromise;
    expect(result).toEqual({ name: 'mock-provider' });
    expect(loader.state).toBe('success');
  });

  test('success state caches resolved module and clears in-flight promise', async () => {
    const mockModule = { id: 1, helper: () => true };
    const importer = vi.fn(async () => mockModule);

    const loader = createProviderLoader(importer);
    const first = await loader.load();
    const second = await loader.load();

    expect(first).toBe(mockModule);
    expect(second).toBe(mockModule);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.state).toBe('success');
    expect(loader.cause).toBeNull();
    expect(loader.getDiagnostic()).toEqual({ state: 'success', module: mockModule });
  });

  test('failed state caches null and retains failure cause', async () => {
    const error = new Error('Package missing');
    const importer = vi.fn(async () => {
      throw error;
    });

    const loader = createProviderLoader(importer);
    const result = await loader.load();

    expect(result).toBeNull();
    expect(loader.state).toBe('failed');
    expect(loader.cause).toBe(error);
    expect(loader.getDiagnostic()).toEqual({ state: 'failed', cause: error });
  });

  test('permanent negative caching: subsequent calls after failure immediately return null without retrying importer', async () => {
    const importer = vi.fn(async () => {
      throw new Error('Permanent failure');
    });

    const loader = createProviderLoader(importer);
    const r1 = await loader.load();
    const r2 = await loader.load();
    const r3 = await loader.load();

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.state).toBe('failed');
  });

  test('shares in-flight promise across concurrent callers', async () => {
    let resolveImport!: (val: { key: string }) => void;
    const importer = vi.fn(
      () =>
        new Promise<{ key: string }>((resolve) => {
          resolveImport = resolve;
        }),
    );

    const loader = createProviderLoader(importer);
    const p1 = loader.load();
    const p2 = loader.load();

    expect(p1).toBe(p2);
    expect(importer).toHaveBeenCalledTimes(1);

    resolveImport({ key: 'value' });
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toEqual({ key: 'value' });
    expect(res2).toEqual({ key: 'value' });
  });

  test('concurrent callers observe same success outcome [module, module] when second attempt would have failed', async () => {
    let attempts = 0;
    const moduleInstance = { provider: 'candidate' };
    const importer = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return moduleInstance;
      }
      throw new Error('Second attempt failed');
    });

    const loader = createProviderLoader(importer);
    const [out1, out2] = await Promise.all([loader.load(), loader.load()]);

    expect(out1).toBe(moduleInstance);
    expect(out2).toBe(moduleInstance);
    expect(attempts).toBe(1);
  });

  test('concurrent callers observe same failure outcome [null, null]', async () => {
    const error = new Error('Concurrent failure');
    const importer = vi.fn(async () => {
      throw error;
    });

    const loader = createProviderLoader(importer);
    const [out1, out2] = await Promise.all([loader.load(), loader.load()]);

    expect(out1).toBeNull();
    expect(out2).toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.cause).toBe(error);
  });

  test('catches synchronous throws from importer and transitions to failed state without crashing', async () => {
    const syncError = new TypeError('Synchronous importer crash');
    const importer = () => {
      throw syncError;
    };

    const loader = createProviderLoader(importer);
    const result = await loader.load();

    expect(result).toBeNull();
    expect(loader.state).toBe('failed');
    expect(loader.cause).toBe(syncError);
  });

  test('preserves asynchronous non-Error rejection identity', async () => {
    const nonErrorCause = { customErrorPayload: 404, detail: 'not found' };
    const importer = vi.fn(async () => {
      throw nonErrorCause;
    });

    const loader = createProviderLoader(importer);
    const result = await loader.load();

    expect(result).toBeNull();
    expect(loader.state).toBe('failed');
    expect(loader.cause).toBe(nonErrorCause);
  });

  test('handles reentrant loading by returning the active in-flight promise', async () => {
    let loader!: ReturnType<typeof createProviderLoader<{ ok: boolean }>>;
    let capturedReentrantPromise: Promise<unknown> | null = null;
    const importer = async () => {
      capturedReentrantPromise = loader.load();
      return { ok: true };
    };

    loader = createProviderLoader(importer);
    const mainPromise = loader.load();
    expect(capturedReentrantPromise).toBe(mainPromise);
    const res = await mainPromise;
    expect(res).toEqual({ ok: true });
    expect(capturedReentrantPromise).toBe(mainPromise);
  });

  test('loadDiagnostic returns typed status and module/cause', async () => {
    const mockModule = { test: true };
    const loader = createProviderLoader(async () => mockModule);

    const diag = await loader.loadDiagnostic();
    expect(diag).toEqual({ state: 'success', module: mockModule });

    const failedLoader = createProviderLoader(async () => {
      throw 'string rejection';
    });
    const failedDiag = await failedLoader.loadDiagnostic();
    expect(failedDiag).toEqual({ state: 'failed', cause: 'string rejection' });
  });

  test('resetForTesting resets state to idle and clears cached module and cause', async () => {
    let callCount = 0;
    const loader = createProviderLoader(async () => {
      callCount++;
      return { callCount };
    });

    const first = await loader.load();
    expect(first?.callCount).toBe(1);

    loader.resetForTesting();
    expect(loader.state).toBe('idle');
    expect(loader.cause).toBeNull();
    expect(loader.getDiagnostic()).toEqual({ state: 'idle' });

    const second = await loader.load();
    expect(second?.callCount).toBe(2);
  });

  test('gdocs_loader wrapper shares in-flight promise, caches module, and handles failure', async () => {
    resetGDocsCoreLoaderForTesting();
    try {
      const mockGdocs = { mock: 'gdocs' } as any;
      let attempts = 0;
      const importer = vi.fn(async () => {
        attempts++;
        if (attempts === 1) return mockGdocs;
        throw new Error('second should not be called');
      });

      const [res1, res2] = await Promise.all([loadGDocsCore(importer), loadGDocsCore(importer)]);
      expect(res1).toBe(mockGdocs);
      expect(res2).toBe(mockGdocs);
      expect(attempts).toBe(1);

      // Reset and verify failure cause retention
      resetGDocsCoreLoaderForTesting();
      const failError = new Error('gdocs load failure');
      const failRes = await loadGDocsCore(async () => {
        throw failError;
      });
      expect(failRes).toBeNull();
      const diag = getGDocsCoreDiagnostic();
      expect(diag).toEqual({ state: 'failed', cause: failError });

      // Negative caching
      const failRes2 = await loadGDocsCore();
      expect(failRes2).toBeNull();
    } finally {
      resetGDocsCoreLoaderForTesting();
    }
  });

  test('odf_loader wrapper shares in-flight promise, caches module, and handles failure', async () => {
    resetOdfCoreLoaderForTesting();
    try {
      const mockOdf = { mock: 'odf' } as any;
      let attempts = 0;
      const importer = vi.fn(async () => {
        attempts++;
        if (attempts === 1) return mockOdf;
        throw new Error('second should not be called');
      });

      const [res1, res2] = await Promise.all([loadOdfCore(importer), loadOdfCore(importer)]);
      expect(res1).toBe(mockOdf);
      expect(res2).toBe(mockOdf);
      expect(attempts).toBe(1);

      // Reset and verify failure cause retention
      resetOdfCoreLoaderForTesting();
      const failError = new Error('odf load failure');
      const failRes = await loadOdfCore(async () => {
        throw failError;
      });
      expect(failRes).toBeNull();
      const diag = getOdfCoreDiagnostic();
      expect(diag).toEqual({ state: 'failed', cause: failError });

      // Negative caching
      const failRes2 = await loadOdfCore();
      expect(failRes2).toBeNull();
    } finally {
      resetOdfCoreLoaderForTesting();
    }
  });
});
