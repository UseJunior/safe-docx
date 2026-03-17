import { describe, it, expect } from 'vitest';
import {
  generateAnchorName,
  isInternalAnchor,
  buildNamedRangeInjectionRequests,
  mapNamedRangeResponses,
  extractExistingAnchors,
  buildAnchorCleanupRequests,
  // Backward compat re-exports
  generateBookmarkName,
  isInternalBookmark,
} from '../anchors.js';
import type { CachedParagraph } from '../types.js';

describe('Anchors (Named Ranges)', () => {
  describe('generateAnchorName', () => {
    it('generates _bk_ prefixed names', () => {
      const name = generateAnchorName(0);
      expect(name).toBe('_bk_000000000000');
    });

    it('generates hex-padded names', () => {
      const name = generateAnchorName(255);
      expect(name).toBe('_bk_0000000000ff');
    });

    it('generates unique names for sequential indices', () => {
      const names = Array.from({ length: 100 }, (_, i) => generateAnchorName(i));
      const unique = new Set(names);
      expect(unique.size).toBe(100);
    });
  });

  describe('isInternalAnchor', () => {
    it('recognizes _bk_ prefixed names', () => {
      expect(isInternalAnchor('_bk_000000000001')).toBe(true);
    });

    it('rejects non-internal names', () => {
      expect(isInternalAnchor('user_bookmark')).toBe(false);
      expect(isInternalAnchor('bookmark_1')).toBe(false);
    });
  });

  describe('backward compat re-exports', () => {
    it('generateBookmarkName still works', () => {
      expect(generateBookmarkName(0)).toBe('_bk_000000000000');
    });

    it('isInternalBookmark still works', () => {
      expect(isInternalBookmark('_bk_000000000001')).toBe(true);
      expect(isInternalBookmark('other')).toBe(false);
    });
  });

  describe('buildNamedRangeInjectionRequests', () => {
    it('builds createNamedRange requests for unanchored paragraphs', () => {
      const paragraphs: CachedParagraph[] = [
        {
          paragraphId: 'p1',
          anchorName: null,
          anchorId: '',
          startIndex: 1,
          endIndex: 12,
          tabId: 'tab1',
          text: 'Hello',
          inTable: false,
        },
        {
          paragraphId: 'p2',
          anchorName: '_bk_000000000000', // already anchored
          anchorId: 'tab1:_bk_000000000000',
          startIndex: 13,
          endIndex: 25,
          tabId: 'tab1',
          text: 'World',
          inTable: false,
        },
      ];

      const requests = buildNamedRangeInjectionRequests(paragraphs, 1);
      expect(requests).toHaveLength(1);
      expect(requests[0].createNamedRange).toBeDefined();
      expect(requests[0].createNamedRange!.name).toBe('_bk_000000000001');
      expect(requests[0].createNamedRange!.range).toEqual({
        startIndex: 1,
        endIndex: 2, // startIndex + 1
        tabId: 'tab1',
      });
    });

    it('returns empty array when all paragraphs are anchored', () => {
      const paragraphs: CachedParagraph[] = [
        {
          paragraphId: 'p1',
          anchorName: '_bk_000000000000',
          anchorId: 'tab1:_bk_000000000000',
          startIndex: 1,
          endIndex: 12,
          tabId: 'tab1',
          text: 'Hello',
          inTable: false,
        },
      ];

      const requests = buildNamedRangeInjectionRequests(paragraphs, 1);
      expect(requests).toHaveLength(0);
    });

    it('omits tabId when empty', () => {
      const paragraphs: CachedParagraph[] = [
        {
          paragraphId: 'p1',
          anchorName: null,
          anchorId: '',
          startIndex: 5,
          endIndex: 15,
          tabId: '',
          text: 'Test',
          inTable: false,
        },
      ];

      const requests = buildNamedRangeInjectionRequests(paragraphs, 0);
      expect(requests[0].createNamedRange!.range).toEqual({
        startIndex: 5,
        endIndex: 6,
      });
    });
  });

  describe('mapNamedRangeResponses', () => {
    it('maps namedRangeId to _bk_ names', () => {
      const responses = [
        { createNamedRange: { namedRangeId: 'kix.abc123' } },
        { createNamedRange: { namedRangeId: 'kix.def456' } },
      ];

      const mapping = mapNamedRangeResponses(responses, 0);
      expect(mapping.size).toBe(2);
      expect(mapping.get('kix.abc123')).toBe('_bk_000000000000');
      expect(mapping.get('kix.def456')).toBe('_bk_000000000001');
    });

    it('skips responses without namedRangeId', () => {
      const responses = [
        { createNamedRange: {} },
        { createNamedRange: { namedRangeId: 'kix.abc123' } },
        {},
      ];

      const mapping = mapNamedRangeResponses(
        responses as Array<{ createNamedRange?: { namedRangeId?: string } }>,
        5,
      );
      expect(mapping.size).toBe(1);
      expect(mapping.get('kix.abc123')).toBe('_bk_000000000005');
    });
  });

  describe('extractExistingAnchors', () => {
    it('extracts _bk_ named ranges from tab-level namedRanges', () => {
      const doc = {
        tabs: [
          {
            tabProperties: { tabId: 'tab1' },
            documentTab: {
              body: { content: [] },
              namedRanges: {
                '_bk_000000000000': {
                  name: '_bk_000000000000',
                  namedRanges: [
                    {
                      namedRangeId: 'kix.abc123',
                      name: '_bk_000000000000',
                      ranges: [{ startIndex: 1, endIndex: 2 }],
                    },
                  ],
                },
                'user_range': {
                  name: 'user_range',
                  namedRanges: [
                    {
                      namedRangeId: 'kix.user1',
                      name: 'user_range',
                      ranges: [{ startIndex: 10, endIndex: 20 }],
                    },
                  ],
                },
              },
            },
          },
        ],
      };

      const anchors = extractExistingAnchors(doc as any);
      expect(anchors.size).toBe(1);
      const anchor = anchors.get('kix.abc123');
      expect(anchor).toBeDefined();
      expect(anchor!.name).toBe('_bk_000000000000');
      expect(anchor!.startIndex).toBe(1);
      expect(anchor!.tabId).toBe('tab1');
    });

    it('falls back to doc-level namedRanges when no tabs have them', () => {
      const doc = {
        tabs: [
          {
            tabProperties: { tabId: 'tab1' },
            documentTab: {
              body: { content: [] },
            },
          },
        ],
        namedRanges: {
          '_bk_000000000000': {
            name: '_bk_000000000000',
            namedRanges: [
              {
                namedRangeId: 'kix.doc123',
                name: '_bk_000000000000',
                ranges: [{ startIndex: 5, endIndex: 6 }],
              },
            ],
          },
        },
      };

      const anchors = extractExistingAnchors(doc as any);
      expect(anchors.size).toBe(1);
      expect(anchors.get('kix.doc123')!.name).toBe('_bk_000000000000');
    });

    it('ignores non-_bk_ named ranges', () => {
      const doc = {
        tabs: [
          {
            tabProperties: { tabId: 'tab1' },
            documentTab: {
              body: { content: [] },
              namedRanges: {
                'my_custom_range': {
                  name: 'my_custom_range',
                  namedRanges: [
                    {
                      namedRangeId: 'kix.custom1',
                      name: 'my_custom_range',
                      ranges: [{ startIndex: 0, endIndex: 10 }],
                    },
                  ],
                },
              },
            },
          },
        ],
      };

      const anchors = extractExistingAnchors(doc as any);
      expect(anchors.size).toBe(0);
    });
  });

  describe('buildAnchorCleanupRequests', () => {
    it('builds deleteNamedRange requests', () => {
      const requests = buildAnchorCleanupRequests(['kix.abc123', 'kix.def456']);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({ deleteNamedRange: { namedRangeId: 'kix.abc123' } });
      expect(requests[1]).toEqual({ deleteNamedRange: { namedRangeId: 'kix.def456' } });
    });

    it('returns empty array for no anchors', () => {
      const requests = buildAnchorCleanupRequests([]);
      expect(requests).toHaveLength(0);
    });
  });
});
