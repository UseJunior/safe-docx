# Change: Add Google Docs core library

## Why
Google Docs support needs a core library parallel to docx-core that provides read/write primitives via the Google Docs API v1. This enables the MCP server to operate on Google Docs documents with the same anchor-based editing model used for DOCX files.

## What Changes
- New `@usejunior/google-docs-core` package with:
  - Service account + OAuth2 authentication with domain-wide delegation
  - Tab-aware document model (`GoogleDocsDocument`) with structure caching
  - Named range anchors (`_bk_` prefix) for stable paragraph addressing
  - Text replacement and paragraph insertion with UTF-16 index math
  - Table cell parsing with full metadata (row/col indices, header detection, multi-paragraph cells)
  - Document view builder for rendering paragraph lists
  - Concurrency control via revision-based write control
  - Error mapping from Google API HTTP codes to MCP error codes
  - Index tracker for UTF-16 surrogate pair accounting
  - Save semantics (checkpoint, pin, snapshot)
  - Write operations builder with reverse-index ordering
- New `googleapis` dependency (scoped to this package only)

## Impact
- Affected specs: none (new capability)
- Affected code: `packages/google-docs-core/` (new package)
- No existing specs affected — this is purely additive
- The `googleapis` dependency is isolated to this package
