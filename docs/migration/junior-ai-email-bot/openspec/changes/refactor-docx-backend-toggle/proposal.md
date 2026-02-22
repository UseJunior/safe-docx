# Change: Refactor docx backend toggle into a global, agnostic abstraction

## Why
Direct Aspose usage is scattered across workflows and services, which makes the backend toggle brittle and forces conditional logic into every module. This has already caused runtime errors when passing protocol-wrapped nodes into Aspose-only APIs. A stricter abstraction boundary is needed so the backend toggle is truly global and DRY.

## What Changes
- Introduce a hardened backend-agnostic contract for docx operations (document primitives as the single entry point).
- Migrate direct Aspose calls in workflows/services to primitives or backend-gated adapters.
- Add explicit capability checks for Aspose-only operations (e.g., layout collector, track changes).
- **BREAKING (internal):** modules should no longer import `aspose.words` directly outside backend-specific implementations.

## Impact
- Affected specs: new capability `document-backend-abstraction` (proposal), existing `document-editing` (behavioral alignment)
- Affected code: workflows/shared/function_calling/**, workflows/shared/report_generation/**, workflows/*_pipeline/**, app/services/**, tool_router/**, secure_file_manager/**
