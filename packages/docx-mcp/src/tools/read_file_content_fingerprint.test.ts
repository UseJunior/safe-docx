import { describe, expect, vi } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
} from '../testing/session-test-utils.js';
import { readFile } from './read_file.js';
import { addFootnote } from './add_footnote.js';
import { replaceText } from './replace_text.js';
import { dispatchToolCall } from '../server.js';
import { SessionManager } from '../session/manager.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';

describe('document-paragraph-id-stability-and-fingerprint — Optional Content Fingerprint on read_file JSON', () => {
  const test = testAllure.epic('Document Reading').withLabels({ feature: TEST_FEATURE });

  registerCleanup();

  test.openspec('opt-in fingerprint adds field on JSON output')(
    'opt-in fingerprint adds field on JSON output',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['First paragraph.', 'Second paragraph.'], { mgr }),
      );

      const read = await when('read_file is called with format=json and include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return result;
      });

      await then('each paragraph carries a sha256:nfkc:<32hex> fingerprint', async () => {
        const nodes = JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
          expect(typeof node.content_fingerprint).toBe('string');
          expect(String(node.content_fingerprint)).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        }
      });
    },
  );

  test.openspec('default JSON output omits fingerprint')(
    'default JSON output omits fingerprint',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Some text.'], { mgr }),
      );

      const read = await when('read_file is called with format=json and no include_fingerprint', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'json', limit: 100 });
        assertSuccess(result, 'read');
        return result;
      });

      await then('paragraph objects do not contain content_fingerprint', async () => {
        const nodes = JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
        for (const node of nodes) {
          expect(node.content_fingerprint).toBeUndefined();
        }
      });
    },
  );

  test.openspec('TOON format ignores include_fingerprint')(
    'TOON format ignores include_fingerprint',
    async ({ given, when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const { filePath } = await given('a DOCX session', () =>
        openSession(['Alpha.', 'Beta.'], { mgr }),
      );

      const baseline = await when('read_file is called with format=toon and no include_fingerprint', async () => {
        const result = await readFile(mgr, { file_path: filePath, format: 'toon', limit: 100 });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      const withFlag = await when('read_file is called with format=toon and include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: filePath,
          format: 'toon',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        return String(result.content);
      });

      await then('TOON output is byte-identical', async () => {
        expect(withFlag).toBe(baseline);
      });
    },
  );

  test.openspec('same paragraph text produces same fingerprint across documents')(
    'same paragraph text produces same fingerprint across documents',
    async ({ given, when, then }: AllureBddContext) => {
      const sharedText = 'The Company shall indemnify the Customer against all claims.';
      const mgr = createTestSessionManager();

      const docA = await given('two DOCX files containing the same paragraph text', () =>
        openSession([sharedText, 'Doc A unique tail.'], { mgr }),
      );
      const docB = await given('a second DOCX file with the same paragraph text', () =>
        openSession(['Doc B unique head.', sharedText], { mgr }),
      );

      const fingerprintsA = await when('reading doc A with include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: docA.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
        return nodes.map((n) => String(n.content_fingerprint));
      });

      const fingerprintsB = await when('reading doc B with include_fingerprint=true', async () => {
        const result = await readFile(mgr, {
          file_path: docB.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
        return nodes.map((n) => String(n.content_fingerprint));
      });

      await then('the corresponding paragraphs receive byte-identical fingerprints', async () => {
        const shared = fingerprintsA.filter((fp) => fingerprintsB.includes(fp));
        expect(shared.length).toBeGreaterThanOrEqual(1);
        for (const fp of shared) {
          expect(fp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        }
      });
    },
  );

  test('content_fingerprint matches paragraph visible text', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const { filePath } = await given('a DOCX session with one paragraph', () =>
      openSession(['Section 5: Termination clause.'], { mgr }),
    );

    const fingerprint = await when('reading with include_fingerprint=true', async () => {
      const result = await readFile(mgr, {
        file_path: filePath,
        format: 'json',
        include_fingerprint: true,
        limit: 100,
      });
      assertSuccess(result, 'read');
      const nodes = JSON.parse(String(result.content)) as Array<Record<string, unknown>>;
      return String(nodes[0].content_fingerprint);
    });

    await then('the fingerprint matches the sha256:nfkc hash of the visible text', async () => {
      const { computeContentFingerprint } = await import('@usejunior/docx-core');
      expect(fingerprint).toBe(computeContentFingerprint('Section 5: Termination clause.'));
    });
  });

  // -------------------------------------------------------------------------
  // Surface scope: list labels and footnote display markers MUST NOT be in
  // the fingerprint surface. These tests pin down that the fingerprint is
  // computed from getParagraphText (raw visible text), not from node.clean_text
  // (which has the rendered "1. " label prepended for lists and a "[^N]"
  // suffix appended for footnote-bearing paragraphs by read_file's own
  // enrichment pipeline).
  // -------------------------------------------------------------------------

  test('list label is NOT part of the fingerprint surface', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const sharedText = 'First list item text.';
    const mgr = createTestSessionManager();

    // Document A: paragraph in a numbered list with a numId reference.
    // We register a simple decimal abstractNum/num so list_labels.ts emits
    // a "1." prefix for clean_text, but getParagraphText returns the raw text.
    const numberingXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="0">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `</w:numbering>`;
    const listDocXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t>${sharedText}</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;
    const listExtraFiles = {
      '[Content_Types].xml':
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
        `</Types>`,
      'word/numbering.xml': numberingXml,
      'word/_rels/document.xml.rels':
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
        `</Relationships>`,
    };

    const listDoc = await given('a DOCX with a numbered-list paragraph', () =>
      openSession([], { mgr, xml: listDocXml, extraFiles: listExtraFiles }),
    );
    const plainDoc = await given(
      'a second DOCX with the same raw text but no list formatting',
      () => openSession([sharedText], { mgr }),
    );

    const [listFp, plainFp] = await when(
      'reading both docs with include_fingerprint=true',
      async () => {
        const readWith = async (filePath: string) => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'json',
            include_fingerprint: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          const nodes = JSON.parse(String(result.content)) as Array<
            Record<string, unknown>
          >;
          return String(nodes[0]!.content_fingerprint);
        };
        return [await readWith(listDoc.filePath), await readWith(plainDoc.filePath)];
      },
    );

    await then(
      'the fingerprints match (list label is not part of the hashed surface)',
      async () => {
        expect(listFp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        expect(listFp).toBe(plainFp);
      },
    );
  });

  test('footnote display marker is NOT part of the fingerprint surface', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const sharedText = 'This sentence has a footnote anchor.';
    const mgr = createTestSessionManager();

    const footnoteDoc = await given(
      'a DOCX where a paragraph has an attached footnote',
      async () => {
        const opened = await openSession([sharedText, 'Filler tail paragraph.'], {
          mgr,
        });
        const added = await addFootnote(mgr, {
          file_path: opened.filePath,
          target_paragraph_id: opened.firstParaId,
          text: 'Footnote body content.',
        });
        assertSuccess(added, 'add_footnote');
        return opened;
      },
    );
    const plainDoc = await given(
      'a second DOCX with the same paragraph text and no footnote',
      () => openSession([sharedText, 'Filler tail paragraph.'], { mgr }),
    );

    const [footnoteFp, plainFp] = await when(
      'reading both docs with include_fingerprint=true',
      async () => {
        const readWith = async (filePath: string) => {
          const result = await readFile(mgr, {
            file_path: filePath,
            format: 'json',
            include_fingerprint: true,
            limit: 100,
          });
          assertSuccess(result, 'read');
          const nodes = JSON.parse(String(result.content)) as Array<
            Record<string, unknown>
          >;
          return String(nodes[0]!.content_fingerprint);
        };
        return [
          await readWith(footnoteDoc.filePath),
          await readWith(plainDoc.filePath),
        ];
      },
    );

    await then(
      'the fingerprints match ([^N] display marker is not part of the hashed surface)',
      async () => {
        expect(footnoteFp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        expect(footnoteFp).toBe(plainFp);
      },
    );
  });

  test('Google Docs sessions silently ignore include_fingerprint', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    // The gdocs read_file handler does not implement include_fingerprint.
    // Spec contract: passing the flag with google_doc_id MUST NOT error and
    // MUST NOT add content_fingerprint to gdocs nodes. This test mocks the
    // gdocs path the same way packages/docx-mcp/src/tools/gdocs/__tests__/
    // gdocs_tools.test.ts does so we don't need real Google Docs credentials.

    let manager: SessionManager;

    await given('a mocked Google Docs session with three paragraphs', async () => {
      vi.doMock('@usejunior/google-docs-core', () => ({
        buildDocumentViewNodes: (paragraphs: any[]) =>
          paragraphs.map((p: any) => ({
            id: p.anchorId,
            list_label: '',
            header: '',
            style: 'body',
            text: p.text,
            clean_text: p.text,
            tagged_text: p.text,
            list_metadata: {
              list_level: -1,
              label_type: null,
              label_string: '',
              header_text: null,
              header_style: null,
              header_formatting: null,
              is_auto_numbered: false,
            },
            style_fingerprint: {
              list_level: -1,
              left_indent_pt: 0,
              first_line_indent_pt: 0,
              style_name: 'body',
              alignment: 'LEFT',
            },
            paragraph_style_id: null,
            paragraph_style_name: 'body',
            paragraph_alignment: 'LEFT',
            paragraph_indents_pt: { left: 0, first_line: 0 },
            numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
            header_formatting: null,
            body_run_formatting: null,
          })),
        buildParagraphStyleRequest: vi.fn(),
        GoogleDocsDocument: { load: vi.fn() },
        isToolSupported: (provider: string, tool: string) =>
          provider === 'gdocs' && tool === 'read_file',
        PROVIDER_CAPABILITIES: { gdocs: new Set(['read_file']) },
      }));
      vi.doMock('../gdocs_loader.js', () => ({
        loadGDocsCore: vi.fn(async () => await import('@usejunior/google-docs-core')),
      }));

      manager = new SessionManager({ ttlMs: 60_000 });
      const mockParagraphs = [
        {
          paragraphId: 'p1',
          anchorName: '_bk_0',
          anchorId: 't.0:_bk_0',
          startIndex: 1,
          endIndex: 20,
          tabId: 't.0',
          text: 'Hello world',
          inTable: false,
        },
        {
          paragraphId: 'p2',
          anchorName: '_bk_1',
          anchorId: 't.0:_bk_1',
          startIndex: 21,
          endIndex: 55,
          tabId: 't.0',
          text: 'Second paragraph here',
          inTable: false,
        },
      ];
      const mockDoc = {
        getParagraphs: vi.fn(() => mockParagraphs),
        getParagraphTextById: vi.fn(),
        getParagraphByAnchorId: vi.fn(),
        replaceText: vi.fn(),
        insertParagraph: vi.fn(),
        executeBatchUpdate: vi.fn(),
        exportAsDocx: vi.fn(),
        getDocId: vi.fn(() => 'gdocs-test-id'),
        getRevisionId: vi.fn(() => 'rev_xyz'),
        getEditCount: vi.fn(() => 0),
        getEditRevision: vi.fn(() => 0),
        getTabs: vi.fn(() => [{ tabId: 't.0', title: 'Tab 1', index: 0 }]),
        getDefaultTabId: vi.fn(() => 't.0'),
        isRevisionFresh: vi.fn(() => true),
        getCache: vi.fn(() => null),
        markEdited: vi.fn(),
        injectAnchors: vi.fn(),
      };
      manager.createGDocsSession('gdocs-test-id', mockDoc as any);
    });

    const result = await when(
      'read_file is dispatched with google_doc_id and include_fingerprint=true',
      async () => {
        return dispatchToolCall(manager!, 'read_file', {
          google_doc_id: 'gdocs-test-id',
          format: 'json',
          include_fingerprint: true,
          limit: 100,
        });
      },
    );

    await then(
      'the call succeeds and gdocs nodes do NOT carry a content_fingerprint',
      async () => {
        expect(result.success, JSON.stringify((result as any).error)).toBe(true);
        const nodes = JSON.parse(String((result as any).content)) as Array<
          Record<string, unknown>
        >;
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
          expect(node.content_fingerprint).toBeUndefined();
        }
      },
    );

    vi.doUnmock('@usejunior/google-docs-core');
    vi.doUnmock('../gdocs_loader.js');
  });

  test('editing the paragraph text changes its fingerprint (regression)', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const mgr = createTestSessionManager();
    const opened = await given(
      'a DOCX session with a single paragraph containing known text',
      () => openSession(['Original sentence that we will edit.'], { mgr }),
    );

    const beforeFp = await when(
      'reading the paragraph fingerprint before any edit',
      async () => {
        const result = await readFile(mgr, {
          file_path: opened.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
          node_ids: [opened.firstParaId],
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<
          Record<string, unknown>
        >;
        return String(nodes[0]!.content_fingerprint);
      },
    );

    const afterFp = await when(
      'replacing some text in that paragraph and reading the fingerprint again',
      async () => {
        const replaced = await replaceText(mgr, {
          file_path: opened.filePath,
          target_paragraph_id: opened.firstParaId,
          old_string: 'Original sentence',
          new_string: 'Edited line',
          instruction: 'regression: fingerprint must change with text',
        });
        assertSuccess(replaced, 'replace_text');

        const result = await readFile(mgr, {
          file_path: opened.filePath,
          format: 'json',
          include_fingerprint: true,
          limit: 100,
          node_ids: [opened.firstParaId],
        });
        assertSuccess(result, 'read');
        const nodes = JSON.parse(String(result.content)) as Array<
          Record<string, unknown>
        >;
        return String(nodes[0]!.content_fingerprint);
      },
    );

    await then(
      'the post-edit fingerprint differs from the pre-edit fingerprint',
      async () => {
        expect(beforeFp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        expect(afterFp).toMatch(/^sha256:nfkc:[0-9a-f]{32}$/);
        expect(afterFp).not.toBe(beforeFp);
      },
    );
  });
});
