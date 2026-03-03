export const DEFAULT_CONTENT_TOKEN_BUDGET = 14_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PaginationMeta {
  has_more: boolean;
  next_offset?: number;
  pagination_hint?: string;
}

export function buildPaginationMeta(
  total: number,
  returned: number,
  startOffset: number,
): PaginationMeta {
  const hasMore = startOffset + returned < total;
  if (!hasMore) return { has_more: false };
  const nextOffset = startOffset + returned + 1; // convert to 1-based
  return {
    has_more: true,
    next_offset: nextOffset,
    pagination_hint: `Showing ${returned} of ${total} paragraphs. Use offset=${nextOffset} to see next page.`,
  };
}
