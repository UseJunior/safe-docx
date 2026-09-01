# Corpus differential-testing harness

Opt-in machinery for running safe-docx's identity, self-comparison, metamorphic, and
package/parser-fuzz checks over a large, SHA-256-pinned corpus of real and synthetic
`.docx` files. Nothing here runs in default CI — it is developer-invoked and gated on a
local corpus cache, exactly like `SAFE_DOCX_REAL_CORPUS_DIR`.

## What is committed vs. what is not

**Committed (redistributable):**
- `differential-corpus-manifest.json` — `{ id, sha256, url, source, license, strata[], features, counts, parts }` per document. This is the corpus's entire committed content.
- `classify_docx_features.mjs` — the OOXML feature classifier that produced the derived `features`/`strata`/`counts` fields. That derived index is this repo's own work product.
- `fetch_differential_corpus.mjs` — pins-and-fetches the corpus into a local cache directory, SHA-256-verifying every file.
- `generate_oom_repro.mjs` — deterministic synthetic reproduction for issue #874.

**Never committed:** any document *bytes*, and any identifier, path, filename, hash, or
extracted text from a private or customer document. The manifest lists only public-source
hashes and URLs.

## Provenance & licensing determination (per source)

| Source | License | Redistribution of the documents? | Use |
|---|---|---|---|
| `open-agreements` (local clone, 134 docs) | CC-BY-4.0 | Yes (attribution) | full |
| `docx-platform-tests` (local clone, 28 docs) | Apache-2.0 | Yes | full |
| `open-xml-sdk` (dotnet, MIT, 117 docs: 55 ISO-Strict + 62 comment/commentsEx) | MIT | Yes (cleanest external provenance) | full |
| `superdoc-docx-corpus` (docxcorp.us, 240 docs) | **ODC-BY** (database) | **No** — ODC-BY covers the *database*, not the underlying Common-Crawl documents | local testing only; hash+URL+derived flags only |
| `libreoffice-fuzzer-seeds` (dev-www.libreoffice.org) | published fuzzing corpus (MPL source headers) | **No** — MPL covers LibreOffice source, not the scraped/Bugzilla attachment documents | local testing only |

The MIT/CC-BY/Apache sources grant rights in the documents themselves and are safe to
redistribute. The SuperDoc and LibreOffice collections carry a collection license that does
**not** establish rights in the underlying third-party documents, so for those sources the
repository holds only the manifest hash, URL, and derived feature flags — never bytes.

The SuperDoc README (MIT) and its HuggingFace card / site (ODC-BY) disagree on the data
license; ODC-BY is treated as controlling (the more restrictive of the two).

## Usage

```bash
export SAFE_DOCX_DIFF_CORPUS_DIR=~/.cache/safe-docx-diff-corpus
export DOCX_PLATFORM_TESTS_DIR=~/Projects/docx-platform-tests   # local clone (not fetchable)
node scripts/corpus/fetch_differential_corpus.mjs "$SAFE_DOCX_DIFF_CORPUS_DIR"
node scripts/corpus/classify_docx_features.mjs "$SAFE_DOCX_DIFF_CORPUS_DIR" --json /tmp/index.json
```

The run drivers used during the investigation (`drive_smoke.mjs`, `drive_mutate.mjs`,
`drive_fuzz.mjs`, and their per-file workers) are intentionally **not** committed — they
live under `.tmp/` (gitignored) as throwaway machinery. Re-derive them from the report if a
future run is needed, or promote a single opt-in harness once the findings below are fixed.
