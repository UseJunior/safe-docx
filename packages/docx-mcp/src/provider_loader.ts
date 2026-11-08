export type ProviderLoadState<T> =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<T | null> }
  | { status: 'ready'; value: T; promise: Promise<T | null> }
  | { status: 'failed'; cause: unknown; promise: Promise<T | null> };

/** One process-lifetime attempt, including a shared in-flight promise. */
export class ProviderLoader<T> {
  private current: ProviderLoadState<T> = { status: 'idle' };

  constructor(private readonly importer: () => Promise<T>) {}

  get state(): Readonly<ProviderLoadState<T>> { return this.current; }

  load(): Promise<T | null> {
    if (this.current.status !== 'idle') return this.current.promise;
    // Defer the importer until after the loading state is published, including
    // synchronous throws or reentrant calls made by an importer.
    const promise = Promise.resolve().then(this.importer).then(
      value => { this.current = { status: 'ready', value, promise }; return value; },
      cause => { this.current = { status: 'failed', cause, promise }; return null; },
    );
    this.current = { status: 'loading', promise };
    return promise;
  }
}
