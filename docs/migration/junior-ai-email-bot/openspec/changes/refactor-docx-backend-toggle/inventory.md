# Aspose Direct Import Inventory (Production)

This inventory lists production files that import `aspose.words` or `aspose.pydrawing` directly.

## Summary
- **Total production files importing Aspose directly**: 1
- **Single gateway**: `app/shared/document_primitives/impl/aspose/__init__.py`

## Architecture

All Aspose access is now routed through a single gateway:

```
app/shared/document_primitives/impl/aspose/__init__.py
├── import aspose.words as aw
├── import aspose.pydrawing as drawing
└── exports: aw, drawing, AsposeDocument, AsposeBackend, ...
```

Modules needing Aspose access import from `app.shared.document_primitives.impl.aspose`:
```python
from app.shared.document_primitives.impl.aspose import aw as aspose_words
from app.shared.document_primitives.impl.aspose import drawing as aspose_drawing
```

## Migration Complete

The following legacy files have been **deleted**:
- `app/shared/document_primitives/aspose_impl.py` (was 14-line re-export)
- `app/shared/document_primitives/docx_impl.py` (was 50-line re-export, originally 1853 lines)

All imports across 35+ files have been updated to use `impl.aspose` or `impl.docx` directly.
