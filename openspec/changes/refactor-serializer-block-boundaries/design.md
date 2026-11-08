## Context

The document view flattens tables into paragraph nodes and lists into items.
Serialization needs document-order runs, never global grouping by table ID.

## Decisions

Use a generator over readonly input with a discriminated table/heading/list/paragraph
union. Preserve node references and allocate only run arrays. Tables take precedence
over all other metadata. Default heading/list classification matches HTML/Markdown;
ODF injects its existing heading policy, auto-list predicate and spacing boundary.
Nesting and table grids remain in each renderer. A collector supports consumers
that need indexed blocks; pagination #1317 can use the same public exports.

No FSM dependency, format unification, document mutation, or inline parser changes.
Callbacks are synchronous, side-effect-free predicates/resolvers; callers must not
mutate the view during iteration. Arrays in emitted blocks are independent of the
input array, while nodes retain their identity.

## Risks and verification

Grouping can accidentally absorb headings, blanks or a later table run. Test
classification precedence, repeated table IDs, exact HTML/Markdown boundaries,
ODF empty spacing, manual labels, level jumps, and package-root exports. Compare
real NVCA outputs with the pre-refactor renderer and smoke merged package exports.
