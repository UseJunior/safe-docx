import { describe, expect, vi } from 'vitest';
import { testAllure } from './testing/allure-test.js';
import { ProviderLoader } from './provider_loader.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Provider loading' });

describe('provider loading states', () => {
  test('shares the pending promise and retains the loaded module', async () => {
    let resolve!: (value: string) => void;
    const importer = vi.fn(() => new Promise<string>(done => { resolve = done; }));
    const loader = new ProviderLoader(importer);
    expect(loader.state.status).toBe('idle');
    const first = loader.load();
    expect(loader.load()).toBe(first);
    expect(loader.state.status).toBe('loading');
    await Promise.resolve();
    resolve('module');
    expect(await first).toBe('module');
    expect(loader.state).toMatchObject({ status: 'ready', value: 'module' });
    expect(loader.load()).toBe(first);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test('permanently caches failure while retaining its diagnostic cause', async () => {
    const cause = new Error('broken initialization');
    const importer = vi.fn((): Promise<string> => { throw cause; });
    const loader = new ProviderLoader(importer);
    const first = loader.load();
    const concurrent = loader.load();
    expect(concurrent).toBe(first);
    expect(await Promise.all([first, concurrent])).toEqual([null, null]);
    expect(loader.load()).toBe(first);
    expect(await loader.load()).toBeNull();
    expect(loader.state).toMatchObject({ status: 'failed', cause });
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test('shares an asynchronous rejection and retains a non-Error cause by identity', async () => {
    let reject!: (cause: unknown) => void;
    const cause = { code: 'ERR_MODULE_NOT_FOUND' };
    const importer = vi.fn(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
    const loader = new ProviderLoader(importer);
    const first = loader.load();
    const concurrent = loader.load();
    expect(concurrent).toBe(first);
    await Promise.resolve();
    reject(cause);
    expect(await Promise.all([first, concurrent])).toEqual([null, null]);
    const state = loader.state;
    expect(state.status).toBe('failed');
    if (state.status !== 'failed') throw new Error('expected failed state');
    expect(state.cause).toBe(cause);
    expect(loader.load()).toBe(first);
    expect(await loader.load()).toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test('publishes loading before an importer reenters the loader', async () => {
    let reentrant: Promise<string | null> | undefined;
    const loader: ProviderLoader<string> = new ProviderLoader(async () => {
      reentrant = loader.load();
      return 'module';
    });
    const first = loader.load();
    expect(await first).toBe('module');
    expect(reentrant).toBe(first);
  });
});
