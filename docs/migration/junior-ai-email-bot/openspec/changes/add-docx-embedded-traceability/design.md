# Design: DOCX Embedded Traceability Metadata

## Architectural Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Traceability Data Flow                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Edit Pipeline                                                              │
│      │                                                                      │
│      ▼                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │               EditCorrelationContext                                 │   │
│  │  - edit_id: "a7f3c2"                                                │   │
│  │  - sources: [email:line:10, playbook:row:5]                         │   │
│  │  - instruction: "Change indemnity cap to $5M"                       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│      │                                                                      │
│      │  build_metadata_from_edits()                                         │
│      ▼                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │               TraceabilityMetadata                                   │   │
│  │  - version: "1.0"                                                   │   │
│  │  - document_hash: "sha256:abc123..."                                │   │
│  │  - revisions: [RevisionMetadata...]                                 │   │
│  │  - issues_list: [IssuesListRow...]                                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│      │                                                                      │
│      │  serialize_metadata() → XML                                          │
│      ▼                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     DOCX File Structure                              │   │
│  │  docx.zip/                                                          │   │
│  │  ├── [Content_Types].xml                                            │   │
│  │  ├── word/document.xml                                              │   │
│  │  ├── docProps/                                                      │   │
│  │  └── customXml/                                                     │   │
│  │      ├── item1.xml  ◄── Junior AI Traceability Metadata            │   │
│  │      └── itemProps1.xml                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  On Document Reload:                                                        │
│      │                                                                      │
│      │  extract_metadata() + verify_hash()                                  │
│      ▼                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Hash Match?                                                         │   │
│  │  ├── YES → Use embedded metadata                                    │   │
│  │  └── NO  → Warn user, fallback to shadow database                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Decision 1: Custom XML Part vs Document Properties

**Choice:** Use custom XML parts in `customXml/` folder.

**Rationale:**
- **Rich structure** - XML can represent complex nested data
- **Standard approach** - DOCX spec supports custom XML parts
- **Isolated** - Doesn't interfere with document content
- **Extensible** - Easy to add new fields

**Alternatives Considered:**
| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Custom XML Parts | Rich structure, standard | Requires XML handling | **Selected** |
| Document Properties | Simple, visible in Word | Limited to key-value | Rejected |
| Comments/Annotations | Visible inline | Not meant for metadata | Rejected |
| External file | No size limit | Requires separate storage | Rejected |

**Implementation:**
```python
# Aspose.Words custom XML part API
def embed_metadata(doc: Document, metadata: TraceabilityMetadata) -> None:
    xml_content = serialize_metadata(metadata)

    # Remove existing Junior metadata if present
    for part in list(doc.custom_xml_parts):
        if JUNIOR_NAMESPACE in str(part.xml):
            doc.custom_xml_parts.remove(part)

    # Add new metadata
    doc.custom_xml_parts.add(xml_content)
```

### Decision 2: Metadata Schema Design

**Choice:** Hierarchical XML with versioning and namespacing.

**Rationale:**
- **Version field** - Enables schema evolution
- **Namespace** - Prevents collision with other tools
- **Hierarchical** - Natural fit for revision → source → details

**Schema:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<juniorMetadata xmlns="http://junior.ai/traceability/v1">
  <version>1.0</version>
  <documentHash>sha256:abc123def456...</documentHash>
  <createdAt>2025-01-15T10:30:00Z</createdAt>
  <updatedAt>2025-01-15T14:45:00Z</updatedAt>

  <revisions>
    <revision id="rev_001" paragraphId="para-42">
      <source type="email" id="AAMkAGI2...">
        <location type="line" index="10"/>
        <author>user@client.com</author>
        <timestamp>2025-01-15T10:30:00Z</timestamp>
      </source>
      <source type="playbook" id="review_abc123">
        <location type="row" index="5"/>
      </source>
      <precedent name="ACME_SPA_2024" paragraph="15"/>
      <instruction>Change indemnity cap to $5M</instruction>
      <appliedAt>2025-01-15T10:35:00Z</appliedAt>
    </revision>

    <revision id="rev_002" paragraphId="para-58">
      <!-- ... -->
    </revision>
  </revisions>

  <issuesList>
    <row index="1" status="applied" revisionRef="rev_001">
      <description>Reduce indemnity cap per term sheet</description>
    </row>
    <row index="2" status="pending">
      <description>Add consequential damages carve-out</description>
    </row>
    <row index="3" status="skipped" reason="Not applicable">
      <description>IP assignment clause</description>
    </row>
  </issuesList>
</juniorMetadata>
```

### Decision 3: Hash Calculation Strategy

**Choice:** SHA-256 hash of document content, excluding metadata XML.

**Rationale:**
- **SHA-256** - Secure, standard, fast
- **Exclude metadata** - Hash shouldn't change when metadata updates
- **Content-based** - Detects any text changes

**Implementation:**
```python
import hashlib
from io import BytesIO

def calculate_document_hash(doc: Document) -> str:
    """Calculate hash of document content, excluding custom XML parts."""
    # Create temporary copy without custom XML
    temp_doc = doc.clone()
    temp_doc.custom_xml_parts.clear()

    # Save to bytes
    buffer = BytesIO()
    temp_doc.save(buffer, SaveFormat.DOCX)

    # Calculate hash
    content = buffer.getvalue()
    return f"sha256:{hashlib.sha256(content).hexdigest()}"
```

**Hash Verification Flow:**
```python
def verify_document_integrity(doc: Document) -> HashVerificationResult:
    metadata = extract_metadata(doc)

    if metadata is None:
        return HashVerificationResult(
            status="no_metadata",
            message="Document has no embedded traceability metadata"
        )

    if metadata.document_hash is None:
        return HashVerificationResult(
            status="no_hash",
            message="Metadata exists but no hash stored"
        )

    actual_hash = calculate_document_hash(doc)

    if actual_hash == metadata.document_hash:
        return HashVerificationResult(
            status="valid",
            message="Document integrity verified"
        )
    else:
        return HashVerificationResult(
            status="mismatch",
            message="Document was modified outside the system",
            stored_hash=metadata.document_hash,
            actual_hash=actual_hash,
        )
```

### Decision 4: Shadow Database Fallback

**Choice:** SQLite shadow storage keyed by document hash.

**Rationale:**
- **Resilience** - Handles stripped metadata or schema issues
- **Performance** - Fast local lookup
- **Privacy** - Can be cleared independently of logs

**Schema:**
```sql
CREATE TABLE shadow_metadata (
    doc_hash TEXT PRIMARY KEY,          -- Hash of document content
    doc_filename TEXT,                  -- Original filename
    metadata_json TEXT NOT NULL,        -- Serialized TraceabilityMetadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP                -- Optional TTL
);

CREATE INDEX idx_shadow_expires ON shadow_metadata(expires_at);
```

**Lookup Strategy:**
```python
def get_metadata_with_fallback(doc: Document) -> TraceabilityMetadata | None:
    # Try embedded metadata first
    embedded = extract_metadata(doc)

    if embedded is not None:
        verification = verify_document_integrity(doc)
        if verification.status == "valid":
            return embedded
        # If mismatch, embedded metadata may be stale

    # Fallback to shadow database
    doc_hash = calculate_document_hash(doc)
    shadow = retrieve_shadow_metadata(doc_hash)

    if shadow is not None:
        logger.info(f"Using shadow metadata for document hash {doc_hash[:16]}...")
        return shadow

    logger.warning("No traceability metadata available for document")
    return None
```

### Decision 5: Compatibility Strategy

**Choice:** Use standard DOCX custom XML that survives Word/Google Docs round-trips.

**Rationale:**
- **Standard compliance** - Following OOXML spec
- **Tested compatibility** - Custom XML commonly used by add-ins
- **Graceful degradation** - If stripped, document still works

**Compatibility Testing Plan:**
| Application | Expected Behavior |
|-------------|-------------------|
| Microsoft Word | Custom XML preserved |
| Google Docs | Custom XML may be stripped |
| LibreOffice | Custom XML preserved |
| macOS Preview | Read-only, XML preserved |

**Fallback for stripped metadata:**
```python
# On document load
metadata = extract_metadata(doc)
if metadata is None:
    logger.warning("Custom XML metadata not found, using shadow database")
    metadata = retrieve_shadow_metadata(calculate_document_hash(doc))
```

## Data Models

### TraceabilityMetadata

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class SourceInfo:
    """Source of an edit instruction."""
    type: str  # "email", "playbook", "precedent"
    id: str    # Source identifier
    location_type: str | None = None  # "line", "row", "paragraph"
    location_index: int | None = None
    author: str | None = None
    timestamp: str | None = None

@dataclass
class RevisionMetadata:
    """Metadata for a single document revision."""
    id: str                          # Unique revision ID
    paragraph_id: str | None         # Target paragraph
    sources: list[SourceInfo]        # Where instruction came from
    precedent_name: str | None       # Precedent used (if any)
    precedent_location: str | None   # Location in precedent
    instruction: str                 # Edit instruction text
    applied_at: str                  # ISO timestamp

@dataclass
class IssuesListRow:
    """A row in the Issues List."""
    index: int                       # Row number (1-based)
    status: str                      # "applied", "pending", "skipped"
    revision_ref: str | None         # Reference to revision ID
    description: str | None          # Row description
    skip_reason: str | None          # If skipped, why

@dataclass
class TraceabilityMetadata:
    """Complete traceability metadata for a document."""
    version: str = "1.0"
    document_hash: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    revisions: list[RevisionMetadata] = field(default_factory=list)
    issues_list: list[IssuesListRow] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "version": self.version,
            "document_hash": self.document_hash,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "revisions": [asdict(r) for r in self.revisions],
            "issues_list": [asdict(r) for r in self.issues_list],
        }
```

### HashVerificationResult

```python
@dataclass
class HashVerificationResult:
    """Result of document hash verification."""
    status: str  # "valid", "mismatch", "no_metadata", "no_hash"
    message: str
    stored_hash: str | None = None
    actual_hash: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.status == "valid"

    @property
    def was_modified_externally(self) -> bool:
        return self.status == "mismatch"
```

## Integration Points

### With Edit Pipeline

```python
# In draft_finalizer.py
async def finalize_draft(
    doc: Document,
    edit_contexts: list[EditCorrelationContext],
    issues_list: list[IssuesListRow],
) -> Document:
    # Build metadata from edit contexts
    metadata = build_metadata_from_edits(edit_contexts, issues_list)

    # Calculate and store document hash
    metadata.document_hash = calculate_document_hash(doc)
    metadata.updated_at = datetime.utcnow().isoformat()

    # Embed in document
    embed_metadata(doc, metadata)

    # Store shadow copy
    store_shadow_metadata(metadata.document_hash, metadata)

    return doc
```

### With EditCorrelationContext

```python
def build_revision_metadata(context: EditCorrelationContext) -> RevisionMetadata:
    """Convert EditCorrelationContext to RevisionMetadata for embedding."""
    return RevisionMetadata(
        id=context.edit_id,
        paragraph_id=context.target_paragraph_id,
        sources=[
            SourceInfo(
                type=s.type,
                id=s.identifier,
                location_type=s.location.type if s.location else None,
                location_index=s.location.index if s.location else None,
                author=s.author,
                timestamp=s.timestamp,
            )
            for s in context.sources
        ],
        instruction=context.instruction,
        applied_at=datetime.utcnow().isoformat(),
    )
```

## Testing Strategy

### Unit Tests

1. **XML round-trip** - Serialize → Deserialize preserves data
2. **Hash calculation** - Deterministic, excludes metadata
3. **Embed/extract** - Aspose integration works
4. **Shadow storage** - CRUD operations

### Integration Tests

1. **Full cycle** - Edit → Embed → Save → Reload → Extract → Verify
2. **Compatibility** - Open in Word, save, reopen, verify metadata
3. **Hash mismatch** - Edit in Word, detect modification

### Test Fixtures

```python
# Sample metadata for testing
SAMPLE_METADATA = TraceabilityMetadata(
    version="1.0",
    document_hash="sha256:abc123...",
    revisions=[
        RevisionMetadata(
            id="rev_001",
            paragraph_id="para-42",
            sources=[SourceInfo(type="email", id="AAMk...")],
            instruction="Change cap to $5M",
            applied_at="2025-01-15T10:30:00Z",
        )
    ],
    issues_list=[
        IssuesListRow(index=1, status="applied", revision_ref="rev_001"),
    ],
)
```

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Custom XML stripped by apps | Medium | High | Shadow database fallback |
| Large metadata slows saves | Low | Medium | Limit revision history depth |
| Schema changes break parsing | Medium | Medium | Version field, backwards compat |
| Privacy exposure | Low | High | Encrypt sensitive fields if needed |
| Hash collision | Very Low | Medium | SHA-256 has 2^256 space |
