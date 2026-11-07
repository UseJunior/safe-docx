/**
 * Shared provider loader with promise sharing, typed diagnostics, and process-lifetime negative caching.
 * Part of #1295 (Planning ID: L, issue #1307).
 */

export type ProviderLoadState = 'idle' | 'pending' | 'success' | 'failed';

export type ProviderLoadDiagnostic<T> =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'success'; module: T }
  | { state: 'failed'; cause: unknown };

export interface ProviderLoader<T> {
  readonly state: ProviderLoadState;
  readonly cause: unknown | null;
  load(customImporter?: () => Promise<T>): Promise<T | null>;
  loadDiagnostic(customImporter?: () => Promise<T>): Promise<ProviderLoadDiagnostic<T>>;
  getDiagnostic(): ProviderLoadDiagnostic<T>;
  resetForTesting(): void;
}

export function createProviderLoader<T>(defaultImporter: () => Promise<T>): ProviderLoader<T> {
  let state: ProviderLoadState = 'idle';
  let cachedModule: T | null = null;
  let cachedCause: unknown | null = null;
  let inFlightPromise: Promise<T | null> | null = null;

  function executeLoad(importer: () => Promise<T>): Promise<T | null> {
    if (state === 'success') {
      return Promise.resolve(cachedModule);
    }
    if (state === 'failed') {
      return Promise.resolve(null);
    }
    if (inFlightPromise) {
      return inFlightPromise;
    }

    state = 'pending';
    let resolvePromise!: (val: T | null) => void;
    inFlightPromise = new Promise<T | null>((resolve) => {
      resolvePromise = resolve;
    });

    (async () => {
      try {
        const result = await importer();
        cachedModule = result;
        cachedCause = null;
        state = 'success';
        resolvePromise(result);
      } catch (err: unknown) {
        cachedModule = null;
        cachedCause = err;
        state = 'failed';
        resolvePromise(null);
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  }

  return {
    get state() {
      return state;
    },
    get cause() {
      return cachedCause;
    },
    load(customImporter?: () => Promise<T>): Promise<T | null> {
      return executeLoad(customImporter ?? defaultImporter);
    },
    async loadDiagnostic(customImporter?: () => Promise<T>): Promise<ProviderLoadDiagnostic<T>> {
      await executeLoad(customImporter ?? defaultImporter);
      return this.getDiagnostic();
    },
    getDiagnostic(): ProviderLoadDiagnostic<T> {
      if (state === 'success') {
        return { state: 'success', module: cachedModule as T };
      }
      if (state === 'failed') {
        return { state: 'failed', cause: cachedCause };
      }
      if (state === 'pending') {
        return { state: 'pending' };
      }
      return { state: 'idle' };
    },
    resetForTesting(): void {
      state = 'idle';
      cachedModule = null;
      cachedCause = null;
      inFlightPromise = null;
    },
  };
}
