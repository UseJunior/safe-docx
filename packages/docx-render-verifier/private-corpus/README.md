# Private renderer corpus

Real completed matters stay outside this repository. Create a local,
gitignored `manifest.json` from `manifest.example.json`; each case points to a
DOCX and a separately maintained expected-markup text file in place. Paths are
resolved relative to the manifest. Keep its output as `output/` (already
gitignored) and keep both input paths outside the Safe DOCX worktree. A fully
local manifest outside the worktree is also accepted because it cannot be
committed to this repository.

The runner rejects a manifest or output directory that Git does not ignore,
and rejects outputs under public `fixtures/`. Its committed summary format
contains only a caller label, SHA-256, verdict, and bounded reason—never DOCX,
PDF, or extracted substantive text.
