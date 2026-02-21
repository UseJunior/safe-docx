import { describe, expect } from 'vitest';

import { hasTrackedChanges_tool } from './has_tracked_changes.js';
import { MCP_TOOLS } from '../server.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  createTestSessionManager,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('has_tracked_changes tool', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: 'has_tracked_changes tool' });
  registerCleanup();

  test('detects insertion/deletion revision wrappers in body content', async () => {
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

    const result = await allureStep('When has_tracked_changes is called', () =>
      hasTrackedChanges_tool(mgr, { session_id: sessionId }),
    );
    assertSuccess(result, 'has_tracked_changes');
    await allureJsonAttachment('result', result);

    await allureStep('Then tracked changes are reported with content marker counts', () => {
      expect(result.has_tracked_changes).toBe(true);
      expect(result.scope).toBe('document_body');
      expect((result.marker_stats as any).insertions).toBe(1);
      expect((result.marker_stats as any).deletions).toBe(1);
      expect((result.marker_stats as any).content_markers).toBe(2);
      expect((result.marker_stats as any).total_markers).toBe(2);
    });
  });

  test('detects property-only tracked changes', async () => {
    const docXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:rPr><w:rPrChange w:author="Editor" w:date="2026-01-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Text</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId } = await openSession([], { xml: docXml });

    const result = await allureStep('When has_tracked_changes is called', () =>
      hasTrackedChanges_tool(mgr, { session_id: sessionId }),
    );
    assertSuccess(result, 'has_tracked_changes');

    await allureStep('Then tracked changes are reported from property markers', () => {
      expect(result.has_tracked_changes).toBe(true);
      expect((result.marker_stats as any).property_markers).toBe(1);
      expect((result.marker_stats as any).rpr_changes).toBe(1);
      expect((result.marker_stats as any).total_markers).toBe(1);
    });
  });

  test('returns false for a clean document', async () => {
    const { mgr, sessionId } = await openSession(['No revisions here.']);

    const result = await allureStep('When has_tracked_changes is called', () =>
      hasTrackedChanges_tool(mgr, { session_id: sessionId }),
    );
    assertSuccess(result, 'has_tracked_changes');

    await allureStep('Then no tracked changes are reported', () => {
      expect(result.has_tracked_changes).toBe(false);
      expect((result.marker_stats as any).total_markers).toBe(0);
      expect((result.marker_stats as any).content_markers).toBe(0);
      expect((result.marker_stats as any).property_markers).toBe(0);
    });
  });

  test('is read-only and preserves edit_revision', async () => {
    const docXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body><w:p><w:r><w:t>Base</w:t></w:r><w:ins w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t> plus</w:t></w:r></w:ins></w:p></w:body>` +
      `</w:document>`;

    const { mgr, sessionId } = await openSession([], { xml: docXml });
    const revisionBefore = mgr.getSession(sessionId).editRevision;

    const result = await allureStep('When has_tracked_changes is called', () =>
      hasTrackedChanges_tool(mgr, { session_id: sessionId }),
    );
    assertSuccess(result, 'has_tracked_changes');

    await allureStep('Then session revision remains unchanged', () => {
      const revisionAfter = mgr.getSession(sessionId).editRevision;
      expect(revisionAfter).toBe(revisionBefore);
      expect(result.edit_revision).toBe(revisionBefore);
    });
  });

  test('requires session context', async () => {
    const mgr = createTestSessionManager();
    const result = await allureStep('When called without session_id or file_path', () =>
      hasTrackedChanges_tool(mgr, {}),
    );

    assertFailure(result, 'MISSING_SESSION_CONTEXT', 'has_tracked_changes');
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
