import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseXml, serializeXml } from '@usejunior/docx-core';

import { acceptChanges as acceptChangesTool } from './accept_changes.js';
import { type DocxSession } from '../session/manager.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'guard-row-level-revision-resolution';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function serializeDoc(session: DocxSession): string {
  const documentXml = (session.doc as unknown as { documentXml: Document }).documentXml;
  return serializeXml(documentXml);
}

async function writeTestDocx(dir: string, name: string, bodyXml: string): Promise<string> {
  const docXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`;
  const buf = await makeDocxWithDocumentXml(docXml);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, new Uint8Array(buf));
  return filePath;
}

describe('Traceability: row-level revision guard (MCP surface)', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  test.openspec('[SDX-ROWREV-MCP-01] accept_changes reports unresolved row revisions instead of claiming a clean document')(
    'a row marked deleted survives the tool call, and the response says so',
    async ({ when, then, attachPrettyJson }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      // A row marked DELETED plus an ordinary content insertion. The insertion
      // proves the tool still does its job; the row marker proves it stops
      // short of claiming a clean document.
      const bodyXml =
        `<w:tbl><w:tr><w:trPr>`
        + `<w:del w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/>`
        + `</w:trPr><w:tc><w:p><w:r><w:t>ROWTEXT</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
        + `<w:p><w:ins w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">`
        + `<w:r><w:t>new text</w:t></w:r></w:ins></w:p>`;
      const filePath = await writeTestDocx(dir, 'row-revision.docx', bodyXml);
      await attachPrettyJson('input-body-xml', bodyXml);

      const result = await when('Call accept_changes on a document with a row-level revision', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await attachPrettyJson('result', result);

      await then('The response reports the unresolved row revision', () => {
        expect(result.unresolvedRowRevisions).toBe(1);
      });

      await then('The row marker and its row survive in the document', async () => {
        const session = (await mgr.getSessionByFilePath(filePath)) as DocxSession;
        const dom = parseXml(serializeDoc(session));

        const rows = dom.getElementsByTagNameNS(W_NS, 'tr');
        expect(rows.length).toBe(1);

        const dels = dom.getElementsByTagNameNS(W_NS, 'del');
        let rowMarker: Element | null = null;
        for (let i = 0; i < dels.length; i++) {
          const parent = dels.item(i)!.parentNode as Element | null;
          if (parent && parent.namespaceURI === W_NS && parent.localName === 'trPr') {
            rowMarker = dels.item(i)!;
          }
        }
        expect(rowMarker).not.toBeNull();
        expect(rowMarker!.getAttributeNS(W_NS, 'id') ?? rowMarker!.getAttribute('w:id')).toBe('7');
      });

      await then('Ordinary content revisions were still accepted', async () => {
        const session = (await mgr.getSessionByFilePath(filePath)) as DocxSession;
        const dom = parseXml(serializeDoc(session));

        // The inserted run survives unwrapped, and no w:ins wrapper is left.
        // (Asserting on w:id is not safe here: opening a session mints _bk_*
        // bookmarks that reuse low w:id values.)
        expect(serializeDoc(session)).toContain('new text');
        expect(dom.getElementsByTagNameNS(W_NS, 'ins').length).toBe(0);
        expect(result.insertionsAccepted).toBeGreaterThanOrEqual(1);
      });
    },
  );

  // The MODIFIED `Accept Tracked Changes Tool` requirement carries three
  // pre-existing scenarios. They are re-verified here against the new
  // preserve-and-report behavior, each with a fixture that actually matches
  // what the scenario claims — resolvable-only input where the scenario is
  // about a clean result, not a row-marker fixture standing in for one.

  test.openspec('accept_changes produces clean document body with no revision markup')(
    'a document without row-level markers still yields a body with no revision markup',
    async ({ when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p><w:ins w:id="60" w:author="A"><w:r><w:t>ins</w:t></w:r></w:ins>`
        + `<w:del w:id="61" w:author="A"><w:r><w:delText>del</w:delText></w:r></w:del></w:p>`;
      const filePath = await writeTestDocx(dir, 'clean.docx', bodyXml);

      const result = await when('Call accept_changes', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      await then('No revision markup remains and nothing is reported unresolved', async () => {
        const session = (await mgr.getSessionByFilePath(filePath)) as DocxSession;
        const dom = parseXml(serializeDoc(session));
        for (const local of ['ins', 'del', 'delText', 'trPrChange', 'rPrChange', 'pPrChange']) {
          expect(dom.getElementsByTagNameNS(W_NS, local).length).toBe(0);
        }
        expect(result.unresolvedRowRevisions).toBe(0);

        // Inserted text survives unwrapped; deleted text is gone.
        const texts: string[] = [];
        const tEls = dom.getElementsByTagNameNS(W_NS, 't');
        for (let i = 0; i < tEls.length; i++) texts.push(tEls[i]!.textContent ?? '');
        expect(texts.join('')).toBe('ins');
      });
    },
  );

  test.openspec('accepted document opens cleanly in Microsoft Word')(
    'resolvable-only input leaves no revision markup at all (well-formed XML proxy)',
    async ({ when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      // This scenario is about a document Word can open with an EMPTY review
      // pane, so the fixture must contain only resolvable revisions. A
      // row-level marker would legitimately survive and is covered by
      // [SDX-ROWREV-MCP-02] instead.
      const bodyXml =
        `<w:p>`
        + `<w:ins w:id="60" w:author="A"><w:r><w:t>ins</w:t></w:r></w:ins>`
        + `<w:del w:id="61" w:author="A"><w:r><w:delText>del</w:delText></w:r></w:del></w:p>`
        + `<w:p><w:pPr><w:pPrChange w:id="62" w:author="A"><w:pPr/></w:pPrChange></w:pPr>`
        + `<w:r><w:t>para</w:t></w:r></w:p>`;
      const filePath = await writeTestDocx(dir, 'resolvable-only.docx', bodyXml);

      const result = await when('Call accept_changes', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      await then('Output parses and holds no revision markup for the review pane to show', async () => {
        const session = (await mgr.getSessionByFilePath(filePath)) as DocxSession;
        const dom = parseXml(serializeDoc(session));
        expect(dom).toBeTruthy();

        for (const local of [
          'ins', 'del', 'delText', 'moveFrom', 'moveTo',
          'rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange',
        ]) {
          expect(dom.getElementsByTagNameNS(W_NS, local).length).toBe(0);
        }
        expect(result.unresolvedRowRevisions).toBe(0);
      });
    },
  );

  test.openspec('[SDX-ROWREV-MCP-02] a document holding unresolved row revisions stays structurally valid')(
    'the preserved marker stays in the only position the schema admits',
    async ({ when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:tbl><w:tr><w:trPr>`
        + `<w:del w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/>`
        + `</w:trPr><w:tc><w:p><w:r><w:t>ROWTEXT</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
        + `<w:p><w:r><w:t>body</w:t></w:r></w:p>`;
      const filePath = await writeTestDocx(dir, 'unresolved-structural.docx', bodyXml);

      const result = await when('Call accept_changes', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      await then('The marker survives as a w:trPr child and the output is well-formed', async () => {
        const session = (await mgr.getSessionByFilePath(filePath)) as DocxSession;
        const dom = parseXml(serializeDoc(session));
        expect(dom).toBeTruthy();

        // A stray w:del anywhere else in the row would be schema-invalid.
        const dels = dom.getElementsByTagNameNS(W_NS, 'del');
        expect(dels.length).toBe(1);
        expect((dels.item(0)!.parentNode as Element).localName).toBe('trPr');
        expect(result.unresolvedRowRevisions).toBe(1);
      });
    },
  );

  test.openspec('original document is not mutated')(
    'the source file on disk is untouched when a row marker is preserved',
    async ({ when, then }: AllureBddContext) => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:tbl><w:tr><w:trPr>`
        + `<w:del w:id="7" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/>`
        + `</w:trPr><w:tc><w:p><w:r><w:t>ROWTEXT</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const filePath = await writeTestDocx(dir, 'immutable.docx', bodyXml);
      const before = await fs.readFile(filePath);

      const result = await when('Call accept_changes', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      await then('The bytes on disk are unchanged', async () => {
        const after = await fs.readFile(filePath);
        expect(Buffer.compare(before, after)).toBe(0);
      });
    },
  );
});
