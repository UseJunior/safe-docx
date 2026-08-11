import type { ReconstructionMode } from './compare-types.js';

/**
 * Default reconstruction mode shared by every comparison front door: the
 * `compareDocuments` library API, the `docx-comparison` / `safe-docx-compare`
 * CLI bins, and (via re-export from `@usejunior/docx-mcp`) the MCP
 * `compare_documents` tool and the `safe-docx` / `safedocx` CLIs.
 *
 * In-place mode preserves revised document structure when safe to do so; the
 * atomizer pipeline still falls back to rebuild when round-trip or ancillary
 * story safety checks fail, and reports that honestly through
 * `reconstructionModeUsed` / `fallbackReason`. Rebuild output loses rsids,
 * sectPr, fields, and content controls (issue #582), so callers should only
 * receive it by explicit request or recorded fallback — never as a silent
 * front-door divergence (issues #649, #808).
 */
export const DEFAULT_RECONSTRUCTION_MODE: ReconstructionMode = 'inplace';
