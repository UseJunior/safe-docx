# Proposal: Add DOCX Embedded Traceability Metadata

## Summary

Embed traceability metadata directly in DOCX files using custom XML parts, enabling Issues List reconstruction from the document alone. This removes dependency on external databases for traceability and ensures data persists when documents are shared or the system changes.

## Problem Statement

Current traceability relies on external database storage. When documents are shared, reopened, or the system evolves:

1. **No standalone traceability** - Metadata lives in database, not document
2. **Sharing breaks links** - Recipients can't access our database
3. **No integrity checking** - Can't detect when document was edited externally
4. **Database dependency** - Schema changes could orphan historical data

**User Story:**
> "I sent the redlined document to opposing counsel. A week later, I opened it and couldn't remember which email instructed each change. The Issues List in our system didn't match because someone edited the document in Word."

## Existing Implementation (~60%)

- ✅ `AttachmentInfo` tracks `original_attachment_id`
- ✅ `persist_workflow_state()` serializes state
- ✅ Version numbering via `_v{N}` suffix
- ✅ `EditCorrelationContext` tracks source provenance
- ❌ No embedded metadata in DOCX
- ❌ No document hash tracking
- ❌ No reconstruction from document alone

## Proposed Solution

### 1. Custom XML Part Injection

Embed metadata in DOCX using Aspose's custom XML part API:
```python
# Create custom XML part
xml_content = create_traceability_xml(revisions)
doc.custom_xml_parts.add(xml_content)
```

### 2. Traceability Schema

```xml
<juniorMetadata xmlns="http://junior.ai/traceability/v1">
  <version>1.0</version>
  <documentHash>sha256:abc123...</documentHash>
  <createdAt>2025-01-15T10:30:00Z</createdAt>

  <revisions>
    <revision id="rev_001" paragraphId="para-42">
      <source type="email" id="AAMkAGI2...">
        <line>10</line>
        <author>user@client.com</author>
      </source>
      <precedent name="ACME_SPA" paragraph="15"/>
      <instruction>Change indemnity cap to $5M</instruction>
      <timestamp>2025-01-15T10:35:00Z</timestamp>
    </revision>
  </revisions>

  <issuesList>
    <row index="1" status="applied" revisionRef="rev_001"/>
    <row index="2" status="pending"/>
  </issuesList>
</juniorMetadata>
```

### 3. Document Hash Integrity

Calculate hash after each AI edit, store in metadata:
```python
content_hash = hashlib.sha256(doc_bytes).hexdigest()
metadata.document_hash = f"sha256:{content_hash}"
```

On reload, detect external modifications:
```python
stored_hash = extract_metadata(doc).document_hash
actual_hash = calculate_hash(doc)
if stored_hash != actual_hash:
    warn_user("Document modified outside system")
```

## Scope

### In Scope

- `TraceabilityMetadata` dataclass for embedded data
- Aspose custom XML part injection/extraction
- Document hash calculation and verification
- Issues List reconstruction from embedded metadata
- Unit tests for embed/extract cycle

### Out of Scope (Future Enhancements)

- UI for viewing embedded metadata
- Metadata migration from existing documents
- Cross-document reference tracking
- Conflict resolution for external edits

## Success Criteria

1. Issues List reconstructable from DOCX metadata alone
2. Metadata survives save/reopen cycle in Word
3. Hash mismatch detected when document edited externally
4. Shadow database provides fallback when metadata missing
5. No impact on document compatibility (opens normally in Word/Google Docs)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Custom XML stripped by some apps | Fallback to shadow database |
| Large metadata bloats document | Limit to essential fields, compress |
| Schema versioning complexity | Version field, backwards-compatible parsing |
| Privacy concerns (email IDs visible) | Encrypt sensitive fields if needed |

## Dependencies

- Aspose.Words custom XML part API
- Existing `EditCorrelationContext` models

## Affected Capabilities

- **NEW CAPABILITY**: `document-traceability` - Embedded metadata for redline source tracking
