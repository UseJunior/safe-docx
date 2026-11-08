## Decisions

Maintain ordered blocks separately from element-to-ID and ID-to-element maps. Initial blocks receive `p0..pN-1`; insertion registers only new elements with a monotonic counter. Rebuilding order cannot retarget existing IDs.

A transaction fork clones XML, pairs cloned blocks with source blocks in the same traversal order, and transfers their current IDs plus the next-ID counter. It is not a reopen. No identity attributes or bookmarks are serialized. A true `fromContentXml` reopen assigns fresh IDs in stored order.

Comment enumeration takes an optional identity callback. OdfDocument supplies its session mapping; standalone `readAnnotations` calls keep the positional default. Existing MCP names, parameters and response keys stay intact; only the approved ODF insertion invalidation values change.

## Risks / Trade-offs

Session IDs are intentionally not durable across reopen. Consumers must use IDs read in the newly opened session. Fork identity transfer relies on the same block collector traversing an exact DOM clone; tests cover headings, table cells, duplicate text, comments and later mutations. Failed transaction candidates must not publish allocator state.
