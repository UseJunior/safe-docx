import type { SaveCacheEntry, TrackedChangesStats } from '../session/manager.js';

type CommonArtifacts = Pick<SaveCacheEntry,
  'revisedBuffer' | 'bookmarksRemoved' | 'blocksRestored' | 'exportedAtUtc'>;

/** Required outputs are narrowed together with the selected save format. */
export type SaveArtifacts = CommonArtifacts & (
  | { format: 'clean'; trackedBuffer: null; trackedStats: null }
  | { format: 'tracked'; trackedBuffer: Buffer; trackedStats: TrackedChangesStats }
  | { format: 'both'; trackedBuffer: Buffer; trackedStats: TrackedChangesStats }
);

/** Validate the legacy cache boundary before any requested file is written. */
export function artifactsFromCache(
  entry: Pick<SaveCacheEntry, keyof CommonArtifacts | 'format' | 'trackedBuffer' | 'trackedStats'>,
  format: SaveCacheEntry['format'],
): SaveArtifacts {
  if (entry.format !== format || !Buffer.isBuffer(entry.revisedBuffer)) {
    throw new Error(`Invalid ${format} save artifacts: missing clean buffer or mismatched format`);
  }
  if (format === 'clean') return { ...entry, format, trackedBuffer: null, trackedStats: null };
  const { trackedBuffer, trackedStats } = entry;
  if (!Buffer.isBuffer(trackedBuffer) || !trackedStats
    || ![trackedStats.insertions, trackedStats.deletions, trackedStats.modifications]
      .every(value => Number.isInteger(value) && value >= 0)) {
    throw new Error(`Invalid ${format} save artifacts: missing tracked buffer or statistics`);
  }
  return { ...entry, format, trackedBuffer, trackedStats };
}
