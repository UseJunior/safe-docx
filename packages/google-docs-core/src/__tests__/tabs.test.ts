import { describe, it, expect } from 'vitest';
import { extractTabs, getDefaultTabId, getTabBody } from '../tabs.js';

describe('Tabs', () => {
  const mockDoc = {
    tabs: [
      {
        tabProperties: { tabId: 'tab1', title: 'Sheet 1' },
        documentTab: { body: { content: [{ paragraph: {} }] } },
      },
      {
        tabProperties: { tabId: 'tab2', title: 'Sheet 2' },
        documentTab: { body: { content: [] } },
      },
    ],
  } as any;

  describe('extractTabs', () => {
    it('extracts tab info from document', () => {
      const tabs = extractTabs(mockDoc);
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toEqual({ tabId: 'tab1', title: 'Sheet 1', index: 0 });
      expect(tabs[1]).toEqual({ tabId: 'tab2', title: 'Sheet 2', index: 1 });
    });

    it('handles document with no tabs', () => {
      expect(extractTabs({} as any)).toEqual([]);
    });
  });

  describe('getDefaultTabId', () => {
    it('returns first tab ID', () => {
      expect(getDefaultTabId(mockDoc)).toBe('tab1');
    });

    it('throws for document with no tabs', () => {
      expect(() => getDefaultTabId({ tabs: [] } as any)).toThrow('Document has no tabs');
    });
  });

  describe('getTabBody', () => {
    it('returns body for specified tab', () => {
      const body = getTabBody(mockDoc, 'tab1');
      expect(body?.content).toHaveLength(1);
    });

    it('returns first tab body when no tabId specified', () => {
      const body = getTabBody(mockDoc);
      expect(body?.content).toHaveLength(1);
    });

    it('returns null for non-existent tab', () => {
      expect(getTabBody(mockDoc, 'nonexistent')).toBeNull();
    });
  });
});
