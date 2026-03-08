import { describe, expect } from 'vitest';

import { getDocumentView } from './get_document_view.js';
import { PREVIEW_RESOURCE_URI, PREVIEW_MIME_TYPE } from './mcp-app-resources.js';
import { GET_DOCUMENT_VIEW_TOOL } from './app_tools.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { getPreviewHtml } from './preview-html.js';

describe('MCP App Preview', () => {
  const test = testAllure.epic('MCP Apps').withLabels({ feature: 'Document Preview' });
  registerCleanup();

  test('get_document_view returns nodes, styles, session_id, and edit_revision', async () => {
    const { mgr, sessionId } = await openSession(['Hello World', 'Second paragraph']);

    const result = await allureStep('When get_document_view is called', () =>
      getDocumentView(mgr, { session_id: sessionId }),
    );
    assertSuccess(result, 'get_document_view');
    await allureJsonAttachment('result', result);

    await allureStep('Then response contains structured document view data', () => {
      expect(result.session_id).toBe(sessionId);
      expect(result.edit_revision).toBe(0);
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(typeof result.styles).toBe('object');

      const nodes = result.nodes as Array<Record<string, unknown>>;
      expect(nodes.length).toBe(2);
      expect(nodes[0]!.id).toBeTruthy();
      expect(nodes[0]!.clean_text).toBe('Hello World');
      expect(nodes[0]!.tagged_text).toBeTruthy();
      expect(nodes[1]!.clean_text).toBe('Second paragraph');
    });
  });

  test('get_document_view works with file_path (auto-open)', async () => {
    const { mgr, inputPath } = await openSession(['Test content']);

    const result = await allureStep('When get_document_view is called with file_path', () =>
      getDocumentView(mgr, { file_path: inputPath }),
    );
    assertSuccess(result, 'get_document_view');

    await allureStep('Then nodes contain the document content', () => {
      const nodes = result.nodes as Array<Record<string, unknown>>;
      expect(nodes.length).toBeGreaterThan(0);
      expect(result.session_id).toBeTruthy();
    });
  });

  test('get_document_view tool is registered with _meta.ui', async () => {
    await allureStep('Then get_document_view tool has _meta.ui in catalog', () => {
      expect(GET_DOCUMENT_VIEW_TOOL).toBeTruthy();
      expect(GET_DOCUMENT_VIEW_TOOL.annotations.readOnlyHint).toBe(true);

      const meta = GET_DOCUMENT_VIEW_TOOL._meta;
      expect(meta).toBeTruthy();
      expect(meta.ui).toBeTruthy();
      expect(meta.ui.resourceUri).toBe('ui://safe-docx/preview');
      expect(meta.ui.visibility).toEqual(['app']);
    });
  });

  test('ListResources includes preview resource with correct URI and MIME type', async () => {
    await allureStep('Then preview resource constants are correctly defined', () => {
      expect(PREVIEW_RESOURCE_URI).toBe('ui://safe-docx/preview');
      expect(PREVIEW_MIME_TYPE).toBe('text/html;profile=mcp-app');
    });
  });

  test('preview HTML resource returns valid HTML with mcp-app content', async () => {
    const html = await allureStep('When getPreviewHtml is called', () => getPreviewHtml());

    await allureStep('Then returned HTML is valid', () => {
      expect(html).toBeTruthy();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Document Preview');
      expect(html).toContain('contentEditable');
      expect(html).toContain('callServerTool');
      expect(html).toContain('get_document_view');
      expect(html).toContain('replace_text');
    });
  });
});
