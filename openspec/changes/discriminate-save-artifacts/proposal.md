# Change: Discriminate save artifacts by selected format

## Why
Issue #1304 (I in #1295) remains applicable after serialization isolation #1318:
nullable cached redline buffers/statistics can silently omit a requested output,
and asynchronous export can mix generations or repopulate an invalidated cache.

## What Changes
- Narrow clean/tracked/both artifacts together; validate the legacy cache boundary.
- Start isolated serialization calls together before yielding, capturing revision,
  author, selective policy and package-change manifest with the outputs.
- Validate and summarize captured bytes and publish cache entries only while their
  document/revision/policy is still current. An in-flight save returns its captured
  revision, even if another operation edits the live session before it finishes.
- Preserve format precedence, aliases, paths, fields, bookmark behavior and the
  legacy clean serialization used for tracked-only `blocks_restored` metadata.

## Impact
- Affected spec: mcp-server. No MCP schema or response field changes.
- Production changes confined to save.ts and a dedicated artifact type/helper;
  session manager/cache storage remains compatible with concurrent work.
- Credit: cocvn157's #1341 identified the union and corrupt-cache test approach.
  This implementation avoids its manager edits and duplicated response branches,
  and adds generation correlation and race evidence absent from that contribution.
- Implementation follows the detailed remediation plan already approved by the
  user with “Implement the plan”; no new architectural decision is requested.
