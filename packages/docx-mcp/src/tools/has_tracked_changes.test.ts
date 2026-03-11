import { describe, expect } from 'vitest';

import { hasTrackedChanges_tool } from './has_tracked_changes.js';
import { MCP_TOOLS } from '../server.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type MarkerStats = {
  insertions?: number;
  deletions?: number;
  content_markers?: number;
  property_markers?: number;
  rpr_changes?: number;
  total_markers?: number;
};

describe('has_tracked_changes tool', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'Tracked Changes Detection' });
  registerCleanup();

  test('detects insertion/deletion revision wrappers in body content', async ({ when, then, attachPrettyJson }: AllureBddContext) => {
    const docXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Base</w:t></w:r>` +
      `<w:ins w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t> plus</w:t></w:r></w:ins>` +
      `<w:del w:author="B" w:date="2026-01-01T00:00:00Z"><w:r><w:delText> minus</w:delText></w:r></w:del>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId } = await openSession([], { xml: docXml });

    let result: Awaited<ReturnType<typeof hasTrackedChanges_tool>>;
    await when('has_tracked_changes is called', async () => {
      result = await hasTrackedChanges_tool(mgr, { session_id: sessionId });
    });
    assertSuccess(result!, 'has_tracked_changes');
    await attachPrettyJson('result', result!);

    await then('tracked changes are reported with content marker counts', () => {
      const markerStats = result!.marker_stats as MarkerStats;
      expect(result!.has_tracked_changes).toBe(true);
      expect(result!.scope).toBe('document_body');
      expect(markerStats.insertions).toBe(1);
      expect(markerStats.deletions).toBe(1);
      expect(markerStats.content_markers).toBe(2);
      expect(markerStats.total_markers).toBe(2);
    });
  });

  test('detects property-only tracked changes', async ({ when, then }: AllureBddContext) => {
    const docXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:rPr><w:rPrChange w:author="Editor" w:date="2026-01-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Text</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId } = await openSession([], { xml: docXml });

    let result: Awaited<ReturnType<typeof hasTrackedChanges_tool>>;
    await when('has_tracked_changes is called', async () => {
      result = await hasTrackedChanges_tool(mgr, { session_id: sessionId });
    });
    assertSuccess(result!, 'has_tracked_changes');

    await then('tracked changes are reported from property markers', () => {
      const markerStats = result!.marker_stats as MarkerStats;
      expect(result!.has_tracked_changes).toBe(true);
      expect(markerStats.property_markers).toBe(1);
      expect(markerStats.rpr_changes).toBe(1);
      expect(markerStats.total_markers).toBe(1);
    });
  });

  test('returns false for a clean document', async ({ when, then }: AllureBddContext) => {
    const { mgr, sessionId } = await openSession(['No revisions here.']);

    let result: Awaited<ReturnType<typeof hasTrackedChanges_tool>>;
    await when('has_tracked_changes is called', async () => {
      result = await hasTrackedChanges_tool(mgr, { session_id: sessionId });
    });
    assertSuccess(result!, 'has_tracked_changes');

    await then('no tracked changes are reported', () => {
      const markerStats = result!.marker_stats as MarkerStats;
      expect(result!.has_tracked_changes).toBe(false);
      expect(markerStats.total_markers).toBe(0);
      expect(markerStats.content_markers).toBe(0);
      expect(markerStats.property_markers).toBe(0);
    });
  });

  test('is read-only and preserves edit_revision', async ({ when, then }: AllureBddContext) => {
    const docXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body><w:p><w:r><w:t>Base</w:t></w:r><w:ins w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t> plus</w:t></w:r></w:ins></w:p></w:body>` +
      `</w:document>`;

    const { mgr, sessionId } = await openSession([], { xml: docXml });
    const revisionBefore = mgr.getSession(sessionId).editRevision;

    let result: Awaited<ReturnType<typeof hasTrackedChanges_tool>>;
    await when('has_tracked_changes is called', async () => {
      result = await hasTrackedChanges_tool(mgr, { session_id: sessionId });
    });
    assertSuccess(result!, 'has_tracked_changes');

    await then('session revision remains unchanged', () => {
      const revisionAfter = mgr.getSession(sessionId).editRevision;
      expect(revisionAfter).toBe(revisionBefore);
      expect(result!.edit_revision).toBe(revisionBefore);
    });
  });

  test('requires session context', async ({ when }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    let result: Awaited<ReturnType<typeof hasTrackedChanges_tool>>;
    await when('called without session_id or file_path', async () => {
      result = await hasTrackedChanges_tool(mgr, {});
    });

    assertFailure(result!, 'MISSING_SESSION_CONTEXT', 'has_tracked_changes');
  });

  test('is registered in MCP_TOOLS as read-only', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'has_tracked_changes');
    expect(tool).toBeTruthy();
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
    expect(tool!.inputSchema.properties).toHaveProperty('session_id');
    expect(tool!.inputSchema.properties).toHaveProperty('file_path');
  });
});
