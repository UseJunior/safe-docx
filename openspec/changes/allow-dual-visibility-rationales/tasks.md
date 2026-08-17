## 1. Validation

- [x] 1.1 Key rationale uniqueness by operation and visibility.
- [x] 1.2 Test allowed cross-visibility pairs and rejected same-visibility duplicates.

## 2. Disclosure safety

- [x] 2.1 Test that external-only output contains the external rationale and no internal rationale bytes.
- [x] 2.2 Run strict OpenSpec validation and repository pre-submit gates.

## 3. Paired consumers

- [x] 3.1 Render both visibility records as distinct comments when dangerous internal export is explicitly enabled.
- [x] 3.2 Preserve both visibility records in structured edit export without a lossy operation-only map.
