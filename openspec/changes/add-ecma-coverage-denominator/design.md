## Context

The repository already vendors extracted normative schemas for registry
lookups. The official ZIP publications must become the immutable upstream
without invalidating those existing paths.

## Goals / Non-Goals

- Goals: preserve exact official artifacts, verify identity, generate raw
  vocabulary from a source ZIP, classify initial semantic references, and fail
  CI on drift.
- Non-goals: enumerate every prose requirement or claim full ECMA-376 coverage.

## Decisions

- Official ZIPs are authoritative source artifacts; existing `schemas/` files
  remain derived declaration-resolution surfaces for the current registry.
- The vocabulary seed chooses the initial declarations, while the generator
  verifies each declaration against the XSD nested in the official Part 4 ZIP.
- Semantic groups remain hand-authored and import generated raw QName entries.
- Generated outputs record the source artifact SHA-256 and are drift checked.

## Risks / Trade-offs

- The repository grows by approximately 52 MiB. This is intentional because
  durability requires preserving exact publications rather than relying on
  mutable download URLs.
- The initial reference manifest is a seed, not a complete prose denominator;
  the report states this limitation explicitly.

## Migration Plan

Existing constants remain supported. Additional handwritten OOXML names can be
migrated incrementally by extending the seed and importing generated entries.
