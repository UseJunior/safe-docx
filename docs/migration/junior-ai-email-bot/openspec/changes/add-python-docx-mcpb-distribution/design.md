# Design: Strangler Fig Migration from Aspose.Words to python-docx/lxml

## Context

The document editing system uses Aspose.Words for all document operations. The high-level algorithms (surgeon.py, bookmark_manager.py) are library-agnostic - only the low-level primitives are Aspose-specific.

**Constraints:**
- Must achieve full feature parity (no degradation)
- Must support both backends during transition
- Must work standalone for MCPB distribution
- Must use only open-source libraries for MCPB

## Goals / Non-Goals

**Goals:**
- Replace Aspose primitives with python-docx/lxml equivalents
- Maintain same behavior for all document editing operations
- Enable MCPB distribution without commercial dependencies
- Comprehensive equivalence testing proving v2 matches v1

**Non-Goals:**
- Rewriting high-level algorithms (they stay unchanged)
- Supporting features we don't currently use
- Immediate removal of Aspose (gradual rollout)

## Architecture Overview

```
app/shared/document_primitives/           # Primitives abstraction layer
├── __init__.py                           # Public exports
├── protocol.py                           # typing.Protocol definitions
├── types.py                              # NodeType, UnderlineType, Color
├── utils.py                              # Shared helpers (stateless functions)
├── factory.py                            # get_backend() with env var
├── aspose_impl.py                        # Thin Aspose wrapper
├── docx_impl.py                          # python-docx/lxml implementation
├── ooxml/                                # Generic lxml OOXML layer
│   ├── namespaces.py                     # W_P, W_R, W_T constants
│   ├── bookmark_ops.py                   # Insert/remove/find bookmarks
│   ├── node_ops.py                       # insert_before, clone_node
│   └── bookmark_id_allocator.py          # Unique ID management
└── field_parser.py                       # XPath-based field traversal
```

## Decisions

### Decision 1: Single Factory with Environment Variable

**What:** A single `get_backend()` function returns the configured implementation based on `DOCUMENT_BACKEND` env var.

```python
# factory.py
def get_backend() -> Backend:
    env_val = os.environ.get("DOCUMENT_BACKEND", "aspose")  # Default: aspose
    return Backend(env_val)
```

**Rationale:** Simple, explicit, startup-only configuration. No mid-session surprises.

**Alternatives considered:**
- Per-module configurable imports: More complex, harder to track
- Per-operation selection: Over-engineered for our use case

### Decision 2: Composed typing.Protocol Hierarchy

**What:** Multiple small protocols composed together for granularity.

```python
class NodeProtocol(Protocol):
    @property
    def node_type(self) -> NodeType: ...
    def remove(self) -> None: ...

class CompositeNodeProtocol(NodeProtocol, Protocol):
    def get_child_nodes(self, node_type: NodeType, recursive: bool) -> Iterator[NodeProtocol]: ...
    def insert_before(self, new_child, ref_child) -> None: ...
    def append_child(self, child) -> None: ...

class FormattableProtocol(Protocol):
    @property
    def font(self) -> FontProtocol: ...

class RunProtocol(NodeProtocol, FormattableProtocol, Protocol):
    @property
    def text(self) -> str: ...
    @text.setter
    def text(self, value: str) -> None: ...

class ParagraphProtocol(CompositeNodeProtocol, Protocol):
    @property
    def runs(self) -> Iterator[RunProtocol]: ...
    def clone(self, deep: bool) -> ParagraphProtocol: ...
```

**Rationale:** typing.Protocol provides structural subtyping - implementations don't need to inherit. Composed protocols are more granular than a monolithic interface.

### Decision 3: Strict Protocol with Optional Fields

**What:** Protocol defines all methods; some return None when feature unavailable.

```python
class ParagraphProtocol(Protocol):
    @property
    def list_label(self) -> str | None:
        """Returns list label text, or None if not a list item or unavailable."""
        ...
```

**Rationale:** Callers check for None instead of catching NotImplementedError. Cleaner control flow.

### Decision 4: Pure Python Types (Independent Enums)

**What:** Define our own enums/dataclasses independent of Aspose or OOXML.

```python
class NodeType(Enum):
    PARAGRAPH = "paragraph"
    RUN = "run"
    BOOKMARK_START = "bookmark_start"
    BOOKMARK_END = "bookmark_end"
    FIELD_START = "field_start"
    FIELD_SEPARATOR = "field_separator"
    FIELD_END = "field_end"

class UnderlineType(Enum):
    NONE = "none"
    SINGLE = "single"
    DOUBLE = "double"
    # ... others as needed

@dataclass
class Color:
    r: int
    g: int
    b: int
```

**Rationale:** Implementations translate to/from native types. Our code is library-agnostic.

### Decision 5: Separate Utils Module (Composition Over Inheritance)

**What:** Shared helpers live in a stateless `utils.py` module.

```python
# utils.py
def parse_hex_color(hex_str: str) -> tuple[int, int, int]:
    """Parse #FFFFFF -> (255, 255, 255)"""
    ...

def normalize_font_name(name: str) -> str:
    """Normalize font names for comparison."""
    ...
```

**Rationale:**
- Pure functions are easier to test
- Avoids "Fragile Base Class" problem
- Both implementations import from utils

**Alternatives considered:**
- Base classes with shared methods: Forces inheritance, leaky abstractions
- Duplicate in each impl: Violates DRY

### Decision 6: Thin Wrappers for OOXML Layer

**What:** Two layers - generic lxml operations + thin protocol wrappers.

```python
# Layer 1: Generic lxml (ooxml/bookmark_ops.py)
def insert_bookmark_xml(body_elem: Element, para_elem: Element, name: str, id: int) -> None:
    """Insert w:bookmarkStart and w:bookmarkEnd around paragraph."""
    ...

# Layer 2: Protocol wrapper (docx_impl.py)
class DocxParagraph(ParagraphProtocol):
    def insert_bookmark(self, name: str) -> str:
        bookmark_id = self._allocator.allocate_id()
        insert_bookmark_xml(self._body, self._elem, name, bookmark_id)
        return name
```

**Rationale:**
- Layer 1 is testable in isolation (just XML in, XML out)
- Layer 2 stays clean, delegates dirty work to XML utils
- Future-proof if libraries change

### Decision 7: Eager Bookmark ID Allocation

**What:** Scan all existing bookmarks at document load time.

```python
class BookmarkIdAllocator:
    def __init__(self, body_elem: Element):
        self._used_ids = self._scan_existing_ids(body_elem)
        self._next_id = max(self._used_ids, default=0) + 1

    @classmethod
    def from_document(cls, body_elem: Element) -> "BookmarkIdAllocator":
        return cls(body_elem)

    def allocate_id(self) -> int:
        id = self._next_id
        self._next_id += 1
        return id
```

**Rationale:** O(n) scan once at load, O(1) allocation thereafter. Simple and predictable.

### Decision 8: Central Namespace Constants

**What:** All OOXML namespaces defined once in `ooxml/namespaces.py`.

```python
# namespaces.py
NSMAP = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

W_P = f"{{{NSMAP['w']}}}p"
W_R = f"{{{NSMAP['w']}}}r"
W_T = f"{{{NSMAP['w']}}}t"
W_RPR = f"{{{NSMAP['w']}}}rPr"
W_B = f"{{{NSMAP['w']}}}b"
W_BOOKMARK_START = f"{{{NSMAP['w']}}}bookmarkStart"
W_BOOKMARK_END = f"{{{NSMAP['w']}}}bookmarkEnd"
# ... etc
```

**Rationale:** Single source of truth. No typos in namespace URIs. Easy to find all XML tag references.

### Decision 9: Lazy Type Mapping in Aspose Wrapper

**What:** Convert Aspose types to our types on property access, not construction.

```python
class AsposeRun(RunProtocol):
    def __init__(self, aspose_run):
        self._raw = aspose_run  # Store raw, don't convert

    @property
    def font(self) -> FontProtocol:
        return AsposeFont(self._raw.font)  # Convert on access

    @property
    def text(self) -> str:
        return self._raw.text  # Direct passthrough
```

**Rationale:** Lighter construction, properties converted only when needed.

### Decision 10: Field Handling - Redesign for lxml

**What:** Redesign `build_clean_text()` from scratch using XPath, supporting arbitrary nesting.

```python
# field_parser.py
def extract_visible_text(para_elem: Element) -> str:
    """Extract visible text, handling fields correctly."""
    # Use XPath to find all text nodes
    # Handle FIELD_START/SEPARATOR/END hierarchy
    # Support arbitrary depth nesting
    ...

def is_field_dirty(field_start: Element) -> bool:
    """Check if field needs recalculation."""
    ...
```

**Scope:** Full parity for fields we actually use:
- Cross-references
- Table of contents
- is_dirty flag

**Rationale:** Fresh XPath-based implementation is cleaner than porting Aspose state machine.

### Decision 11: python-docx + lxml Hybrid for Run Creation

**What:** Use python-docx API where available, lxml for advanced font properties.

```python
class DocxRun(RunProtocol):
    def __init__(self, run_elem: Element, docx_run=None):
        self._elem = run_elem
        self._docx_run = docx_run  # May be None for lxml-only runs

    @property
    def font(self) -> FontProtocol:
        return DocxFont(self._elem, self._docx_run)

class DocxFont(FontProtocol):
    @property
    def bold(self) -> bool | None:
        if self._docx_run:
            return self._docx_run.bold  # Use python-docx
        # Fallback to lxml
        b_elem = self._rPr.find(W_B)
        return b_elem is not None
```

**Rationale:** Best of both worlds - python-docx handles common cases cleanly, lxml for edge cases.

### Decision 12: Return Degraded Result on Failure

**What:** When operation cannot be performed, return result with success=False instead of raising.

```python
@dataclass
class OperationResult:
    success: bool
    warning: str | None = None

# Usage
result = paragraph.insert_text(text)
if not result.success:
    logger.warning(f"Insert failed: {result.warning}")
```

**Rationale:** Callers can handle gracefully without try/except. Better UX than crashing.

### Decision 13: Session Manager Handles Concurrency

**What:** Primitives are stateless per call; session manager owns document lifecycle.

```python
class SessionManager:
    def __init__(self, adapter_factory: Callable[[], DocumentProtocol]):
        self._adapter_factory = adapter_factory
        self._lock = asyncio.Lock()

    async def with_document(self, session_id: str):
        async with self._lock:
            doc = self._documents[session_id]
            yield doc
```

**Rationale:** Keeps primitives simple. Session manager already handles lifecycle.

## Testing Strategy

### Equivalence Tests (Primary)

```python
@pytest.fixture(params=["aspose", "docx"])
def backend(request):
    os.environ["DOCUMENT_BACKEND"] = request.param
    return get_backend()

class TestEquivalence:
    def test_paragraph_text_extraction(self, backend, doc_fixture):
        doc = backend.load(doc_fixture)
        paras = list(doc.get_child_nodes(NodeType.PARAGRAPH, True))
        texts = [p.text for p in paras]
        # Compare against expected (same for both backends)
```

### XML Structure Assertions

```python
def assert_bookmark_structure(doc_elem: Element, name: str):
    """Assert bookmark XML is valid and balanced."""
    starts = doc_elem.findall(f".//{W_BOOKMARK_START}[@w:name='{name}']")
    ends = doc_elem.findall(f".//{W_BOOKMARK_END}[@w:id='{starts[0].get(W_ID)}']")
    assert len(starts) == 1
    assert len(ends) == 1
```

### Document Validation (Defense in Depth)

1. **python-docx reload**: Save, reload, verify no corruption
2. **LibreOffice headless**: Convert to PDF, verify renders correctly

## CI Enforcement

```yaml
# .github/workflows/check-aspose-imports.yml
- name: Check Aspose imports
  run: |
    # Allowed files
    ALLOWED="aspose_impl.py|tests/.*"

    # Find violations
    if rg "import aspose" --type py | grep -vE "$ALLOWED"; then
      echo "ERROR: Aspose imported outside allowed files"
      exit 1
    fi
```

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Field handling differences | High | Extensive testing with field-heavy documents |
| Clone behavior differences | Medium | Deep test clone(True) vs clone(False) |
| Namespace handling errors | Medium | Central constants, comprehensive tests |
| Performance regression | Low | Benchmark critical paths; accept if acceptable |

## Migration Path

1. **Phase 1**: Create primitives layer, Aspose wrapper passes all tests
2. **Phase 2**: Create docx implementation, equivalence tests pass
3. **Phase 3**: Migrate high-level modules to primitives (surgeon.py all-at-once)
4. **Phase 4**: Integration tests with docx backend
5. **Phase 5**: MCPB release with docx backend
6. **Phase 6**: (Optional) Remove Aspose from main product
