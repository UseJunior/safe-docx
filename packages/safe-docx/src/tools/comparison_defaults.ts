import type { CompareOptions } from '@usejunior/docx-comparison';

/**
 * Default comparison reconstruction mode for tracked output.
 *
 * In-place mode preserves revised document structure when safe to do so.
 * The atomizer pipeline still falls back to rebuild if round-trip safety checks fail.
 */
export const DEFAULT_RECONSTRUCTION_MODE: NonNullable<CompareOptions['reconstructionMode']> = 'inplace';
