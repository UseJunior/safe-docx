## 1. Discovery
- [x] 1.1 Inventory direct Aspose imports and classify by capability (see `inventory.md`)
- [x] 1.2 Identify Aspose-only features without docx equivalents

## 2. Abstraction Surface
- [x] 2.1 Define adapter APIs for Aspose-only operations (layout collector, track changes, comments, get_ancestor)
- [x] 2.2 Extend BackendCapabilities and document_primitives adapters to cover new APIs

## 3. Migration (by subsystem)
- [x] 3.1 Migrate document_edit_utils to primitives (NodeType, DocumentProtocol, adapter helpers)
- [x] 3.2 Migrate smart_edit/smart_insert pipelines to primitives
- [x] 3.3 Migrate report_generation and pipeline processors to primitives
- [x] 3.4 Migrate app/services and tool_router docx paths to primitives
- [x] 3.5 Fix adapter.py functions to handle raw backend objects via ensure_document()/ensure_paragraph()

## 4. Enforcement & Tests
- [ ] 4.1 Add regression tests for protocol wrapper compatibility in hot paths
- [ ] 4.2 Add parity tests for backend toggle on read/grep/edit paths
- [ ] 4.3 Add CI check to block new `aspose.words` imports outside allowed modules

## 5. Validation
- [ ] 5.1 Run backend parity test suite (Aspose + docx)
- [ ] 5.2 Validate proposal with `openspec validate refactor-docx-backend-toggle --strict`
