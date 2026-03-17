import type { GoogleDocsSaveMode } from './types.js';

/** Validate save mode and return normalized mode */
export function validateSaveMode(mode?: string): GoogleDocsSaveMode {
  if (!mode || mode === 'checkpoint') return 'checkpoint';
  if (mode === 'pin') return 'pin';
  if (mode === 'snapshot') return 'snapshot';
  throw new Error(`Invalid save_mode: ${mode}. Must be 'checkpoint', 'pin', or 'snapshot'.`);
}

/** Maximum pinned revisions per file */
export const MAX_PINNED_REVISIONS = 200;
