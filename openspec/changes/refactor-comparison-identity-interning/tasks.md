## 1. Identity infrastructure

- [x] 1.1 Extract `elementIdentityString` from `hashElement` (pre-hash string builder)
- [x] 1.2 Add lazy `sha1Hash` accessor (compute-on-first-read, memoized) + module-private interner-key slot
- [x] 1.3 Add `IdentityInterner` (string → small int) and `assignIdentityIds`
- [x] 1.4 Keep numbering + hyperlink salts in sync across `sha1Hash` and the interner key; invalidate on run merge

## 2. Wire the comparison path

- [x] 2.1 Intern both documents' atoms through one shared interner before LCS (per compare pass)
- [x] 2.2 Select the atom comparator once per `computeAtomLcs` invocation: integer id when interned, legacy hash+text+tag otherwise
- [x] 2.3 Intern paragraph-group `textHash` / `normalizedTextHash` to integers

## 3. Verify

- [x] 3.1 Full docx-compare suite green; Lean differential harness still agrees with TS LCS
- [x] 3.2 Exactness gate: byte-identical normalized ZIP + stats on NVCA / NVCA-COI / ILPA, both reconstruction modes
- [x] 3.3 Benchmark + `createHash('sha1')` call-count drop reported
- [x] 3.4 Generated differential test: interned equality ≡ legacy `atomsEqual` over a finalized-atom cross-product
