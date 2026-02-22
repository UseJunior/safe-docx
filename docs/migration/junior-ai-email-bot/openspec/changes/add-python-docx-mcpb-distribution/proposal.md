# Change: Strangler Fig Migration from Aspose.Words to python-docx/lxml

## Why

The current document editing system uses Aspose.Words, a commercial library (~$1,499/developer/year) with complex distribution licensing. This creates barriers for:
1. **MCPB submission** - Anthropic may reject extensions with commercial dependencies
2. **User adoption** - Users cannot easily "bring their own license"
3. **Scaling** - License limits could be exceeded if the extension becomes popular

**Key Insight**: Our existing Edit Surgeon achieves 100% formatting preservation through sophisticated run manipulation. The algorithms in surgeon.py are library-agnostic - only the low-level primitives are Aspose-specific.

## What Changes

### Strategy: Strangler Fig Pattern

Instead of creating a "degraded" version with reduced capabilities, we replace ONLY the low-level Aspose primitives with python-docx/lxml equivalents. The high-level algorithms (surgeon.py, bookmark_manager.py) remain unchanged.

### New: Primitives Abstraction Layer

Create `app/shared/document_primitives/` containing:
- **Protocols**: DocumentProtocol, ParagraphProtocol, RunProtocol, FontProtocol (typing.Protocol)
- **Types**: Pure Python enums/dataclasses (NodeType, UnderlineType, Color)
- **Implementations**: `aspose_impl.py` (thin wrapper) and `docx_impl.py` (python-docx/lxml)
- **Factory**: `get_backend()` selects implementation via `DOCUMENT_BACKEND` env var

### New: lxml OOXML Manipulation Layer

Generic XML operations for bookmark and node manipulation:
- **ooxml_namespaces.py**: Central constants (W_P, W_R, W_T)
- **ooxml_bookmark_ops.py**: Insert/remove/find bookmarks via lxml
- **ooxml_node_ops.py**: insert_before, clone_node, remove_node
- **bookmark_id_allocator.py**: Eager ID allocation at document load

### Migration: All High-Level Modules

Update existing modules to use primitives instead of direct Aspose imports:
- surgeon.py (all at once with feature flag)
- bookmark_manager.py
- formatted_text.py
- field_utils.py (redesigned for lxml, full field parity for fields we use)
- match_location.py

### Testing: Equivalence Verification

pytest.mark.parametrize runs both backends against all test documents:
- Text + formatting comparison (not XML diff)
- Targeted XML structure assertions for bookmarks
- python-docx reload test + LibreOffice headless validation
- 100% of existing tests must pass before switching default

## Feature Parity

| Feature | Current (Aspose) | After Migration (docx) |
|---------|------------------|------------------------|
| Load/save documents | ✅ | ✅ |
| Enumerate paragraphs | ✅ | ✅ |
| Get paragraph text | ✅ | ✅ |
| Insert bookmarks | ✅ | ✅ (via lxml) |
| Find/replace text | ✅ Preserves formatting | ✅ Preserves formatting |
| Run manipulation | ✅ | ✅ (via lxml) |
| Field handling | ✅ | ✅ (fields we use: TOC, cross-refs, is_dirty) |
| Insert paragraphs | ✅ | ✅ |
| Copy paragraph styles | ✅ | ✅ |

**No degradation** - full feature parity with Aspose implementation.

## Impact

- Affected specs: mcp-distribution
- Affected code:
  - `app/shared/document_primitives/` (new abstraction layer)
  - `workflows/shared/function_calling/functions/document_edit_utils/` (migrate to primitives)
  - `app/mcp_server/` (migrate to primitives)
- Dependencies: Removes `aspose-words` from MCPB, adds `python-docx`, `lxml`
- CI: New check to flag Aspose imports outside allowed files

## Rollout

Aggressive 2-week rollout:
1. **Week 1**: Build primitives layer, unit tests, equivalence tests
2. **Week 2**: Migrate modules, integration tests, MCPB release
