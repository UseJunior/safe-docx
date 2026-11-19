import { afterEach, describe, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { testAllure } from './testing/allure-test.js';
import { assertFailure, openSession, registerCleanup } from './testing/session-test-utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Provider loading' });

const providers = [
  {
    name: 'Google Docs',
    module: '@usejunior/google-docs-core',
    load: async () => {
      const { loadGDocsCore, gdocsProviderLoader } = await import('./gdocs_loader.js');
      return { load: loadGDocsCore, loader: gdocsProviderLoader };
    },
  },
  {
    name: 'ODF',
    module: '@usejunior/odf-core',
    load: async () => {
      const { loadOdfCore, odfProviderLoader } = await import('./odf_loader.js');
      return { load: loadOdfCore, loader: odfProviderLoader };
    },
  },
];

afterEach(() => {
  vi.doUnmock('@usejunior/google-docs-core');
  vi.doUnmock('@usejunior/odf-core');
  vi.resetModules();
});

describe('provider loader wiring', () => {
  registerCleanup();

  for (const provider of providers) {
    test(`${provider.name} callers share the pending and cached successful import`, async () => {
      vi.resetModules();
      let resolve!: (value: { marker: string }) => void;
      const imported = new Promise<{ marker: string }>(done => { resolve = done; });
      const factory = vi.fn(() => imported);
      vi.doMock(provider.module, factory);
      const { load, loader } = await provider.load();
      const first = load();
      const concurrent = load();
      expect(concurrent).toBe(first);
      expect(loader.state.status).toBe('loading');
      resolve({ marker: provider.name });
      const [one, two] = await Promise.all([first, concurrent]);
      expect(one === two).toBe(true);
      expect((one as unknown as { marker: string }).marker).toBe(provider.name);
      const state = loader.state;
      expect(state.status).toBe('ready');
      if (state.status !== 'ready') throw new Error('expected ready state');
      expect(state.value === one).toBe(true);
      expect(load()).toBe(first);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    test(`${provider.name} callers share a permanently cached failed import`, async () => {
      vi.resetModules();
      const factory = vi.fn(() => { throw new Error('synthetic provider initialization failure'); });
      vi.doMock(provider.module, factory);
      const { load, loader } = await provider.load();
      const first = load();
      const concurrent = load();
      expect(concurrent).toBe(first);
      expect(await Promise.all([first, concurrent])).toEqual([null, null]);
      expect(load()).toBe(first);
      expect(await load()).toBeNull();
      expect(loader.state).toMatchObject({ status: 'failed', cause: expect.any(Error) });
      expect(factory).toHaveBeenCalledTimes(1);
    });
  }

  test('failed Google Docs imports preserve MISSING_DEPENDENCY for concurrent documents', async () => {
    vi.resetModules();
    vi.doMock('@usejunior/google-docs-core', () => { throw new Error('synthetic missing provider'); });
    const { resolveGDocsSessionForTool } = await import('./tools/session_resolution.js');
    const { SessionManager } = await import('./session/manager.js');
    const manager = new SessionManager();
    const results = await Promise.all(['synthetic-doc-one', 'synthetic-doc-two'].map(google_doc_id =>
      resolveGDocsSessionForTool(manager, { google_doc_id }, { toolName: 'read_file' }),
    ));
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failed session resolution');
      assertFailure(result.response, 'MISSING_DEPENDENCY');
    }
  });

  test('failed ODF imports preserve editing and conversion error codes without writing output', async () => {
    const opened = await openSession(['Synthetic provider failure regression.']);
    vi.resetModules();
    vi.doMock('@usejunior/odf-core', () => { throw new Error('synthetic broken provider'); });
    const { convertToOdt } = await import('./tools/convert_to_odt.js');
    const { openDocument } = await import('./tools/open_document.js');
    const target = path.join(opened.tmpDir, 'never-written.odt');
    try {
      const results = await Promise.all([1, 2].map(() => convertToOdt(opened.mgr, {
        file_path: opened.inputPath, output_path: target,
      })));
      for (const result of results) assertFailure(result, 'ODF_UNAVAILABLE');
      expect(await fs.access(target).then(() => true, () => false)).toBe(false);
      const input = path.join(opened.tmpDir, 'synthetic.odt');
      await fs.writeFile(input, 'provider fails before archive parsing');
      assertFailure(await openDocument(opened.mgr, { file_path: input }), 'MISSING_DEPENDENCY');
    } finally {
      await opened.mgr.clearAllSessions();
    }
  });
});
