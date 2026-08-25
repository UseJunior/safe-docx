## 1. Implementation

- [x] 1.1 Extend canonical annotation runs with named style and half-point size fields.
- [x] 1.2 Validate named style inheritance and fail closed for missing or cyclic chains.
- [x] 1.3 Preserve admitted style data through Markdoc parsing and serialization.
- [x] 1.4 Re-emit admitted style data in comment and footnote projections.

## 2. Verification

- [x] 2.1 Cover inherited, missing, and cyclic named styles with focused tests.
- [x] 2.2 Verify comment and footnote projection output retains style and size elements.
- [x] 2.3 Exercise the two real ILPA fixtures and pin the next unsupported boundary.
- [x] 2.4 Run all repository pre-submit gates.
