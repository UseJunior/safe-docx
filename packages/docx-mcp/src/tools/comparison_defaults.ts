/**
 * Default comparison reconstruction mode for tracked output.
 *
 * Re-exported from `@usejunior/docx-compare` so every front door — the MCP
 * `compare_documents` tool, the `safe-docx`/`safedocx` CLIs, the
 * `docx-comparison`/`safe-docx-compare` bins, and the library API — shares
 * one default (issues #649, #808).
 *
 * In-place mode preserves revised document structure when safe to do so.
 * The atomizer pipeline still falls back to rebuild if round-trip safety checks fail.
 */
export { DEFAULT_RECONSTRUCTION_MODE } from '@usejunior/docx-compare';
