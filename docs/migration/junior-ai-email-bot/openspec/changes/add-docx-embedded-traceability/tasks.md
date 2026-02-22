## Phase 1: Metadata Models

- [ ] 1.1 Create `workflows/shared/traceability/` module directory
- [ ] 1.2 Create `workflows/shared/traceability/__init__.py`
- [ ] 1.3 Create `workflows/shared/traceability/models.py` with:
  - `RevisionMetadata` dataclass (source, instruction, timestamp)
  - `IssuesListRow` dataclass (index, status, revision_ref)
  - `TraceabilityMetadata` dataclass (version, hash, revisions, issues_list)
- [ ] 1.4 Create `workflows/shared/traceability/schema.py` with:
  - XML namespace constant
  - Schema version constant
  - XML element names

---

## Phase 2: XML Serialization

- [ ] 2.1 Create `workflows/shared/traceability/xml_serializer.py` with:
  - `serialize_metadata(metadata: TraceabilityMetadata) -> str` (to XML)
  - `deserialize_metadata(xml_str: str) -> TraceabilityMetadata` (from XML)

- [ ] 2.2 Implement XML generation using ElementTree:
  ```python
  from xml.etree import ElementTree as ET
  root = ET.Element("juniorMetadata", xmlns=NAMESPACE)
  # Build tree...
  ```

- [ ] 2.3 Implement XML parsing with error handling:
  - Handle missing elements gracefully
  - Support schema version migration

- [ ] 2.4 Add unit tests for serialization round-trip

---

## Phase 3: DOCX Integration

- [ ] 3.1 Create `workflows/shared/traceability/docx_embed.py` with:
  - `embed_metadata(doc: Document, metadata: TraceabilityMetadata)`
  - `extract_metadata(doc: Document) -> TraceabilityMetadata | None`

- [ ] 3.2 Implement embedding using Aspose custom XML parts:
  ```python
  xml_content = serialize_metadata(metadata)
  custom_part = doc.custom_xml_parts.add(
      xml_content,
      "http://junior.ai/traceability/v1"
  )
  ```

- [ ] 3.3 Implement extraction:
  ```python
  for part in doc.custom_xml_parts:
      if "junior.ai/traceability" in part.xml:
          return deserialize_metadata(part.xml)
  return None
  ```

- [ ] 3.4 Handle multiple custom XML parts (use namespace to identify)

- [ ] 3.5 Add unit tests:
  - Embed and extract round-trip
  - Extract from document without metadata (returns None)
  - Update existing metadata

---

## Phase 4: Document Hash Tracking

- [ ] 4.1 Create `workflows/shared/traceability/hash_utils.py` with:
  - `calculate_document_hash(doc_bytes: bytes) -> str`
  - `verify_hash(doc: Document) -> HashVerificationResult`

- [ ] 4.2 Implement hash calculation:
  ```python
  import hashlib
  def calculate_document_hash(doc_bytes: bytes) -> str:
      return f"sha256:{hashlib.sha256(doc_bytes).hexdigest()}"
  ```

- [ ] 4.3 Implement hash verification:
  - Extract stored hash from metadata
  - Calculate actual hash (excluding custom XML parts)
  - Return match/mismatch status

- [ ] 4.4 Handle edge cases:
  - No hash stored (return "unknown")
  - Hash calculation excludes metadata XML itself

- [ ] 4.5 Add unit tests for hash verification

---

## Phase 5: Issues List Reconstruction

- [ ] 5.1 Create `workflows/shared/traceability/issues_list.py` with:
  - `reconstruct_issues_list(doc: Document) -> list[IssueListItem]`
  - `build_metadata_from_edits(edits: list[AnchoredEdit]) -> TraceabilityMetadata`

- [ ] 5.2 Implement reconstruction from embedded metadata:
  ```python
  metadata = extract_metadata(doc)
  if metadata:
      return [
          IssueListItem(
              row_index=row.index,
              status=row.status,
              instruction=find_revision(row.revision_ref).instruction,
          )
          for row in metadata.issues_list
      ]
  return []
  ```

- [ ] 5.3 Implement metadata building from edit context:
  - Convert `EditCorrelationContext` to `RevisionMetadata`
  - Build `IssuesListRow` entries from playbook row indices

- [ ] 5.4 Add unit test: Full cycle from edits → embed → save → reload → reconstruct

---

## Phase 6: Shadow Database Fallback

- [ ] 6.1 Create `workflows/shared/traceability/shadow_db.py` with:
  - `store_shadow_metadata(doc_id: str, metadata: TraceabilityMetadata)`
  - `retrieve_shadow_metadata(doc_id: str) -> TraceabilityMetadata | None`

- [ ] 6.2 Implement SQLite-based shadow storage:
  ```python
  CREATE TABLE shadow_metadata (
      doc_id TEXT PRIMARY KEY,
      doc_hash TEXT,
      metadata_json TEXT,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
  )
  ```

- [ ] 6.3 Implement retrieval with hash matching:
  - If document hash matches, return shadow metadata
  - If hash mismatch, return None (document was modified)

- [ ] 6.4 Add cleanup job for expired shadow entries

- [ ] 6.5 Add unit tests for shadow storage

---

## Phase 7: Pipeline Integration

- [ ] 7.1 Update `draft_finalizer.py` to embed metadata after edit completion
- [ ] 7.2 Update edit pipeline to build metadata from correlation contexts
- [ ] 7.3 Add hash verification on document reload/re-edit
- [ ] 7.4 Log warnings when hash mismatch detected

---

## Phase 8: Quality Checks

- [ ] 8.1 Run `ruff check` on all new files
- [ ] 8.2 Run `mypy` on all new files
- [ ] 8.3 Run full test suite
- [ ] 8.4 Test document compatibility:
  - Open in Microsoft Word
  - Open in Google Docs
  - Verify custom XML preserved after round-trip
- [ ] 8.5 Update tasks.md to mark completion

---

## Future Phases (Out of Scope)

### Phase 9: Metadata UI
- [ ] 9.1 Display embedded metadata in review workbench
- [ ] 9.2 Show "externally modified" warning when hash mismatch
- [ ] 9.3 Allow user to view full traceability chain

### Phase 10: Migration Tool
- [ ] 10.1 Batch migrate existing documents to embedded metadata
- [ ] 10.2 Backfill from database where available
