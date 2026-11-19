# ODF paragraph IDs

ODF sessions initially assign `p0..pN-1` in document order, including headings and table-cell paragraphs. These are session identities: inserting before or after an anchor changes order while every existing paragraph retains its ID. New paragraphs receive monotonically increasing IDs. Reads, grep, comments and edits share this mapping, including across internal mutation forks.

The insertion response keeps `new_paragraph_id`, `new_paragraph_ids`, `invalidates_paragraph_ids_after`, `requires_reread_before_next_edit` and `ids_note`. The invalidation fields now contain `null` and `false`, respectively: existing IDs can be used immediately for the next edit. No names or parameters change.

Saving preserves the current session's mapping. Opening the saved file in a new session deterministically assigns IDs in its stored order. For example, inserting before `p0:A, p1:B` produces `p2:New, p0:A, p1:B` in the active session; reopening yields `p0:New, p1:A, p2:B`. IDs are held in memory, never written as new ODF attributes or bookmarks.

An ID-targeted edit that implicitly reopens a closed or expired session can already apply an old ID to a different paragraph before returning `session_resolution: 'opened'`. This metadata reports reopening after execution; it is not a pre-mutation stale-ID guard. When session continuity is uncertain, obtain fresh IDs with `read_file` or `grep` on the newly opened file before an ID-targeted edit.

## Revalidation and contributor reconciliation

Current main at `650bd0b9` still indexed anchors positionally and rebuilt positional identities on transaction forks. The initial candidate was preserved before integrating main's atomic mutation boundary (#1368 / #1301). The fork must transfer stable IDs: insertion followed by another MCP mutation would otherwise silently renumber them.

Credit: cocvn157's [PR #1336](https://github.com/UseJunior/safe-docx/pull/1336) implements the same approved bidirectional-map and monotonic-allocation direction, with core insertion/reopen tests. Its source diff was inspected rather than relying on its reported test counts. This focused implementation preserves the provided candidate and additionally transfers fork identities, stabilizes comment anchors, updates MCP response/catalog documentation, and tests failed transactions plus later mutations through dispatch. The contributor's branch and PR remain unchanged; their reported checks are not evidence for this branch.
