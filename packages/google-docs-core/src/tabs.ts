import type { GDocsDocument, GDocsBody } from './google-api-types.js';
import type { TabInfo } from './types.js';
import type { DocumentWithTabs, TabSchema } from './google-api-types.js';

/** Extract tab information from a Google Docs document */
export function extractTabs(doc: GDocsDocument): TabInfo[] {
  const docWithTabs = doc as DocumentWithTabs;
  const tabs: TabInfo[] = [];
  const rawTabs: TabSchema[] = docWithTabs.tabs ?? [];
  for (let i = 0; i < rawTabs.length; i++) {
    const tab = rawTabs[i]!;
    tabs.push({
      tabId: tab.tabProperties?.tabId ?? '',
      title: tab.tabProperties?.title ?? `Tab ${i + 1}`,
      index: i,
    });
  }
  return tabs;
}

/** Get the default (first) tab ID */
export function getDefaultTabId(doc: GDocsDocument): string {
  const docWithTabs = doc as DocumentWithTabs;
  const tabs = docWithTabs.tabs ?? [];
  if (tabs.length === 0) {
    throw new Error('Document has no tabs');
  }
  return tabs[0]!.tabProperties?.tabId ?? '';
}

/** Get the content body for a specific tab */
export function getTabBody(
  doc: GDocsDocument,
  tabId?: string,
): GDocsBody | null {
  const docWithTabs = doc as DocumentWithTabs;
  const tabs = docWithTabs.tabs ?? [];
  if (tabs.length === 0) return null;

  if (!tabId) {
    return tabs[0]?.documentTab?.body ?? null;
  }

  for (const tab of tabs) {
    if (tab.tabProperties?.tabId === tabId) {
      return tab.documentTab?.body ?? null;
    }
  }
  return null;
}
