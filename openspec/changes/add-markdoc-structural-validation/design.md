# Design: Structural validation at the resolved-operation boundary

## Decision

Validators consume a resolved, read-only operation view: source paragraph, positional anchor, intended insertion level/style peer, and the ordered outline window around the anchor. This is late enough to know the actual DOCX structure and early enough to remain transactional.

The shared result is a structured diagnostic rather than harness control flow: stable `code` and `severity` (`warning` or `error`), operation and source/anchor IDs, observed and intended hierarchy levels, human/agent-facing message, and an optional deterministic `suggested_anchor_id`.

Markdoc compilation treats unsafe structural placement as fail-closed by default. Interactive editing tools return the same diagnostic as a warning or retryable error according to the tool's mutation contract. Retry counts and "warn once, then allow" policy remain application concerns and are not ported.

## Parent-child slicing

For a section-level insertion, consider the gap it lands in (after the anchor for `AFTER`, before it for `BEFORE`). Scan forward from that gap until a paragraph at or above the inserted level. If that run contains a deeper paragraph that already has a parent before the gap, the insertion would re-parent it: diagnose slicing and identify the last paragraph of the run as the corrective `AFTER` anchor. Insertion at or below the first following child's level does not slice the hierarchy.

Content-based section-header detection from the harness is not authoritative in Safe DOCX. Markdoc operation kind plus resolved numbering/style hierarchy must drive applicability; content heuristics may only provide advisory evidence.

## Rollout

1. Introduce the diagnostic/result contract and parent-child slicing validator.
2. Integrate it with Markdoc `validate` and compile preflight.
3. Expose matching diagnostics from insertion/edit tools.
4. Port level and list-renumbering rules one at a time with shared fixtures.

## Bonded run-in paragraph pairs

The NVCA form represents a run-in provision as two adjacent paragraphs with
different roles: a heading paragraph whose paragraph mark is a Word style
separator (`w:specVanish`) and a body follower that renders inline with it.
Repeated adjacent transitions from such a run-in heading to the same follower
style establish the pairing; a repeated ordinary heading-to-`Normal` transition
does not, because that is plain section structure. Validation requires both
insertions, distinct structural peers, and an application order that places
each heading immediately before its body within the insertion slot. Text casing
and punctuation are not authoritative. Pairing is one-to-one. `AFTER` operations name the body first because repeated
insertion reverses around the anchor; `BEFORE` operations name the heading
first. Multiple repeated followers for one heading style are resolved only when
the submitted body peer makes the choice unique, otherwise validation emits an
ambiguity error.

`batch_edit` keeps same-slot collisions hard by default. The sole exception is
an explicit two-step `bonded_pair_id` group that the source-derived validator
recognizes as a correctly ordered heading/body pair with distinct style peers.
Three-step groups and unrelated inserts at that slot remain conflicts.

Junior Harness's current live hooks do not enforce this exact two-paragraph
construction. Its same-paragraph regex is heuristic and its header consistency
hook checks sibling formatting. Safe DOCX therefore implements the structural
pair rule directly; harness retry state, Aspose bindings, legal-content
classification, and warn-once policy remain unported.
