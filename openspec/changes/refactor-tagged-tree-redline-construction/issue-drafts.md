# De-identified successor issue drafts

These de-identified drafts were filed on 2026-08-14 after duplicate review and
explicit human approval:

- formatting divergence: https://github.com/UseJunior/safe-docx/issues/836
- successor B, production default: https://github.com/UseJunior/safe-docx/issues/837
- successor C, legacy deletion: https://github.com/UseJunior/safe-docx/issues/838
- successor D, rebuild-mode contract: https://github.com/UseJunior/safe-docx/issues/839
- retracted residual-axiom narrowing: https://github.com/UseJunior/safe-docx/issues/840
  (closed as not planned because PR #826 removed the formal verifier)

The first filing of issue 836 omitted the opaque fixture identifier and score
because shell command substitution consumed backtick-delimited text. Immediate
read-back caught the error, and the body was corrected in place using an exact
body file. This is why public-write automation must read back the created
artifact and use body files rather than inline shell text.

## Tagged-tree shadow: preserve direct paragraph formatting in tracked serialization

Stage-A shadow comparison for #814 preserves accept/reject text on a synthetic
paragraph replacement, but its serialized tracked tree does not match the
legacy candidate's direct-formatting projection. The pinned synthetic case
changes paragraph justification and run emphasis and reports `formatting`
divergence with fidelity below 1. The same divergence class blocks opaque
fixture `cd2f69960d5f13cc6292a138` (score `0.6287170885149017`).

Completion gate: the synthetic case and opaque corpus fixture reach fidelity 1
while accept/reject projections remain exact. Keep the legacy pipeline
authoritative until the separate default-flip gate is met.

## Tagged-tree successor B: production default flip

Make tagged-tree redline construction authoritative only after all blocking
shadow divergences and accept/reject, structural, formatting, move, field,
multi-author, ancillary-story, and cross-reader gates pass. Preserve the legacy
output for an explicit rollback window; do not delete it in this issue.

## Tagged-tree successor C: delete legacy reconstruction

After successor B completes its rollback window, remove legacy reconstruction,
suppression, and coalescing machinery one concern per PR. Keep the field and
move-range regression cases as behavior contracts.

## Tagged-tree successor D: decide the public rebuild mode

Decide whether `rebuild` remains public once tagged serialization supports
original- and revised-side package skeletons. Inventory callers, compare
fidelity and package preservation, and publish the migration path before
changing the option.

## Retracted: narrow the Lean output-text residual axiom

This draft was filed as #840 from stale language predating PR #826. PR #826 had
already removed the Lean verifier and replaced it with independent artifact
checks, so the issue had no live implementation target. It was closed as not
planned and retained here only to preserve the correction trail.
