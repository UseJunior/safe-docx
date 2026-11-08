import { allocateRevisionId, type RevisionIdState } from './track-changes-emitter.js';

type Readiness =
  | { status: 'unseeded' }
  | { status: 'seeding'; pending: Promise<RevisionIdState> }
  | { status: 'ready'; state: RevisionIdState };

/**
 * Async readiness boundary for managed editors. Emitters still receive plain,
 * synchronous RevisionIdState; promises and controllers never enter that data.
 */
export class RevisionIdAllocator {
  private readiness: Readiness;
  private parent?: RevisionIdAllocator;
  private checkpoint?: RevisionIdState;

  constructor(
    private readonly seed: () => Promise<RevisionIdState>,
    readyState?: RevisionIdState,
  ) {
    this.readiness = readyState ? { status: 'ready', state: readyState } : { status: 'unseeded' };
  }

  get status(): Readiness['status'] { return this.readiness.status; }

  /** Non-allocating inspection for session fork/publication bookkeeping. */
  get readyState(): RevisionIdState | null {
    return this.readiness.status === 'ready' ? this.readiness.state : null;
  }

  /** Throw rather than issue an ID before a successful seed. */
  allocate(): number {
    const state = this.readyState;
    if (!state) throw new Error(`Revision ID allocator is not ready (${this.status})`);
    return allocateRevisionId(state);
  }

  ensureReady(): Promise<RevisionIdState> {
    if (this.readiness.status === 'ready') return Promise.resolve(this.readiness.state);
    if (this.readiness.status === 'seeding') return this.readiness.pending;
    // Schedule the seeder after installing the pending state, including when
    // it throws synchronously. Only this attempt may transition readiness.
    const pending = Promise.resolve().then(this.seed).then(
      state => {
        this.readiness = { status: 'ready', state };
        return state;
      },
      error => {
        this.readiness = { status: 'unseeded' };
        throw error;
      },
    );
    this.readiness = { status: 'seeding', pending };
    return pending;
  }

  /**
   * Fork allocation data, never a promise/prototype via structuredClone.
   * An unready fork shares the parent's seed, then checkpoints before editing.
   */
  fork(): RevisionIdAllocator {
    const child = new RevisionIdAllocator(async () => {
      const state = await this.ensureReady();
      child.checkpoint = structuredClone(state);
      return structuredClone(state);
    });
    child.parent = this;
    if (this.readyState) {
      child.checkpoint = structuredClone(this.readyState);
      child.readiness = { status: 'ready', state: structuredClone(this.readyState) };
    }
    return child;
  }

  /**
   * Publish synchronously alongside the candidate document. Keep the active
   * data identity so contexts issued before publication cannot reuse old IDs.
   * Return false if direct callers advanced the active counter after the fork.
   */
  publish(child: RevisionIdAllocator): boolean {
    if (child.parent !== this) throw new Error('Revision allocator is not a fork of this allocator');
    if (child.status === 'unseeded') return true;
    const state = this.readyState;
    const next = child.readyState;
    const checkpoint = child.checkpoint;
    if (!state || !next || !checkpoint || !sameState(state, checkpoint)) return false;
    state.nextId = next.nextId;
    state.moveRangeIds.clear();
    for (const [key, pair] of next.moveRangeIds) state.moveRangeIds.set(key, { ...pair });
    return true;
  }
}

function sameState(left: RevisionIdState, right: RevisionIdState): boolean {
  if (left.nextId !== right.nextId || left.moveRangeIds.size !== right.moveRangeIds.size) return false;
  for (const [key, pair] of left.moveRangeIds) {
    const other = right.moveRangeIds.get(key);
    if (!other || pair.sourceRangeId !== other.sourceRangeId || pair.destRangeId !== other.destRangeId) return false;
  }
  return true;
}
