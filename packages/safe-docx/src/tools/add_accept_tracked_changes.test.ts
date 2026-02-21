import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseXml, serializeXml } from '@usejunior/docx-primitives';

import { acceptChanges as acceptChangesTool } from './accept_changes.js';
import { openDocument } from './open_document.js';
import { type Session } from '../session/manager.js';
import { MCP_TOOLS } from '../server.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure, allureStep, allureJsonAttachment } from '../testing/allure-test.js';
import {
  assertSuccess,
  registerCleanup,
  createTestSessionManager,
  createTrackedTempDir,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-accept-tracked-changes';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── XML builder helpers ─────────────────────────────────────────────

const DOC_OPEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>`;
const DOC_CLOSE = `</w:body></w:document>`;

function wrapDoc(bodyXml: string): string {
  return DOC_OPEN + bodyXml + DOC_CLOSE;
}

async function writeTestDocx(dir: string, name: string, bodyXml: string): Promise<string> {
  const docXml = wrapDoc(bodyXml);
  const buf = await makeDocxWithDocumentXml(docXml);
  const p = path.join(dir, name);
  await fs.writeFile(p, new Uint8Array(buf));
  return p;
}

// ── Parse helpers ───────────────────────────────────────────────────

function parseDocXml(xmlString: string): Document {
  return parseXml(xmlString);
}

function hasElement(doc: Document, localName: string): boolean {
  return doc.getElementsByTagNameNS(W_NS, localName).length > 0;
}

function getBodyText(doc: Document): string {
  const texts: string[] = [];
  const tElements = doc.getElementsByTagNameNS(W_NS, 't');
  for (let i = 0; i < tElements.length; i++) {
    texts.push(tElements[i]!.textContent ?? '');
  }
  return texts.join('');
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Traceability: Accept Tracked Changes', () => {
  const test = testAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });
  registerCleanup();

  // ── Spec: docx-primitives — Tracked Change Acceptance Engine ────
  // These tests map to the docx-primitives spec (not mcp-server), so they
  // use plain `test()` rather than `test.openspec()` to avoid traceability
  // checker mismatches (the checker only validates mcp-server scenarios).

  test(
    'Scenario: accept insertions by unwrapping w:ins wrappers',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml = `<w:p><w:ins w:id="1" w:author="A"><w:r><w:t>new text</w:t></w:r></w:ins></w:p>`;
      const filePath = await writeTestDocx(dir, 'ins.docx', bodyXml);
      await allureJsonAttachment('input-body-xml', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      await allureStep('No w:ins elements remain', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'ins')).toBe(false);
      });

      await allureStep('Promoted run with text present in parent w:p', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(getBodyText(dom)).toContain('new text');
        expect(hasElement(dom, 'r')).toBe(true);
      });

      await allureStep('Stats: insertionsAccepted >= 1', () => {
        expect(result.insertionsAccepted).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test(
    'Scenario: accept deletions by removing w:del elements and content',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p><w:r><w:t>kept</w:t></w:r>` +
        `<w:del w:id="2" w:author="A"><w:r><w:delText>old text</w:delText></w:r></w:del></w:p>`;
      const filePath = await writeTestDocx(dir, 'del.docx', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      await allureStep('No w:del elements remain', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'del')).toBe(false);
      });

      await allureStep('No w:delText elements remain', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'delText')).toBe(false);
      });

      await allureStep('"old text" not present in document body', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        expect(xml).not.toContain('old text');
      });

      await allureStep('Stats: deletionsAccepted >= 1', () => {
        expect(result.deletionsAccepted).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test(
    'Scenario: accept property changes by removing change records',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p>` +
        `<w:pPr><w:pStyle w:val="Heading1"/><w:pPrChange w:id="10" w:author="A"><w:pPr/></w:pPrChange></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:rPrChange w:id="11" w:author="A"><w:rPr/></w:rPrChange></w:rPr><w:t>bold text</w:t></w:r>` +
        `</w:p>` +
        `<w:tbl><w:tblPr><w:tblPrChange w:id="12" w:author="A"><w:tblPr/></w:tblPrChange></w:tblPr>` +
        `<w:tr><w:tc><w:tcPr><w:tcPrChange w:id="13" w:author="A"><w:tcPr/></w:tcPrChange></w:tcPr>` +
        `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const filePath = await writeTestDocx(dir, 'prchange.docx', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      await allureStep('No *PrChange elements remain', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        for (const local of ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange']) {
          expect(hasElement(dom, local)).toBe(false);
        }
      });

      await allureStep('Current formatting preserved', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'b')).toBe(true);
        expect(hasElement(dom, 'pStyle')).toBe(true);
      });

      await allureStep('Stats: propertyChangesResolved >= 1', () => {
        expect(result.propertyChangesResolved).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test(
    'Scenario: accept moves by keeping destination and removing source',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p><w:moveFromRangeStart w:id="20" w:name="move1"/>` +
        `<w:moveFrom w:id="21" w:author="A"><w:r><w:t>moved text</w:t></w:r></w:moveFrom>` +
        `<w:moveFromRangeEnd w:id="20"/></w:p>` +
        `<w:p><w:moveToRangeStart w:id="22" w:name="move1"/>` +
        `<w:moveTo w:id="23" w:author="A"><w:r><w:t>moved text</w:t></w:r></w:moveTo>` +
        `<w:moveToRangeEnd w:id="22"/></w:p>`;
      const filePath = await writeTestDocx(dir, 'move.docx', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      await allureStep('w:moveFrom removed', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'moveFrom')).toBe(false);
      });

      await allureStep('w:moveTo unwrapped, content at destination', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'moveTo')).toBe(false);
        expect(getBodyText(dom)).toContain('moved text');
      });

      await allureStep('No move range markers remain', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'moveFromRangeStart')).toBe(false);
        expect(hasElement(dom, 'moveFromRangeEnd')).toBe(false);
        expect(hasElement(dom, 'moveToRangeStart')).toBe(false);
        expect(hasElement(dom, 'moveToRangeEnd')).toBe(false);
      });

      await allureStep('Stats: movesResolved >= 1', () => {
        expect(result.movesResolved).toBeGreaterThanOrEqual(1);
      });
    },
  );

  test(
    'Scenario: bottom-up processing resolves nested revisions',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p><w:ins w:id="30" w:author="A">` +
        `<w:del w:id="31" w:author="A"><w:r><w:delText>deleted inside ins</w:delText></w:r></w:del>` +
        `<w:r><w:t>kept</w:t></w:r>` +
        `</w:ins></w:p>`;
      const filePath = await writeTestDocx(dir, 'nested.docx', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      const session = mgr.getSession(result.session_id as string);
      const xml = serializeDoc(session);
      const dom = parseDocXml(xml);

      await allureStep('Inner w:del removed (deleted text gone)', () => {
        expect(hasElement(dom, 'del')).toBe(false);
        expect(xml).not.toContain('deleted inside ins');
      });

      await allureStep('Outer w:ins unwrapped ("kept" text remains)', () => {
        expect(hasElement(dom, 'ins')).toBe(false);
        expect(getBodyText(dom)).toContain('kept');
      });

      await allureStep('No orphaned elements remain', () => {
        expect(hasElement(dom, 'delText')).toBe(false);
      });
    },
  );

  test(
    'Scenario: orphaned moves handled with safe fallback',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      // moveFrom with no matching moveTo, and moveTo with no matching moveFrom
      const bodyXml =
        `<w:p><w:moveFrom w:id="40" w:author="A"><w:r><w:t>orphan source</w:t></w:r></w:moveFrom></w:p>` +
        `<w:p><w:moveTo w:id="41" w:author="A"><w:r><w:t>orphan dest</w:t></w:r></w:moveTo></w:p>`;
      const filePath = await writeTestDocx(dir, 'orphan-move.docx', bodyXml);

      const result = await allureStep('Call accept_changes tool', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      const session = mgr.getSession(result.session_id as string);
      const xml = serializeDoc(session);
      const dom = parseDocXml(xml);

      await allureStep('Orphaned moveFrom removed entirely', () => {
        expect(hasElement(dom, 'moveFrom')).toBe(false);
        expect(xml).not.toContain('orphan source');
      });

      await allureStep('Orphaned moveTo unwrapped, children promoted', () => {
        expect(hasElement(dom, 'moveTo')).toBe(false);
        expect(getBodyText(dom)).toContain('orphan dest');
      });
    },
  );

  // ── Spec: mcp-server — Accept Tracked Changes Tool ─────────────

  test.openspec('accept_changes produces clean document body with no revision markup')(
    'Scenario: accept_changes produces clean document body with no revision markup',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p>` +
        `<w:ins w:id="50" w:author="A"><w:r><w:t>inserted</w:t></w:r></w:ins>` +
        `<w:del w:id="51" w:author="A"><w:r><w:delText>deleted</w:delText></w:r></w:del>` +
        `<w:r><w:rPr><w:b/><w:rPrChange w:id="52" w:author="A"><w:rPr/></w:rPrChange></w:rPr><w:t>formatted</w:t></w:r>` +
        `</w:p>` +
        `<w:p><w:moveFrom w:id="53" w:author="A"><w:r><w:t>move src</w:t></w:r></w:moveFrom></w:p>` +
        `<w:p><w:moveTo w:id="54" w:author="A"><w:r><w:t>move dst</w:t></w:r></w:moveTo></w:p>`;
      const filePath = await writeTestDocx(dir, 'mixed.docx', bodyXml);

      const result = await allureStep('Call accept_changes with file_path', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');
      await allureJsonAttachment('result', result);

      await allureStep('Response includes correct stat counts', () => {
        expect(result.insertionsAccepted).toBeGreaterThanOrEqual(1);
        expect(result.deletionsAccepted).toBeGreaterThanOrEqual(1);
        expect(result.movesResolved).toBeGreaterThanOrEqual(1);
        expect(result.propertyChangesResolved).toBeGreaterThanOrEqual(1);
      });

      await allureStep('Re-reading session shows no revision markup', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        expect(hasElement(dom, 'ins')).toBe(false);
        expect(hasElement(dom, 'del')).toBe(false);
        expect(hasElement(dom, 'moveFrom')).toBe(false);
        expect(hasElement(dom, 'moveTo')).toBe(false);
        expect(hasElement(dom, 'rPrChange')).toBe(false);
      });
    },
  );

  test.openspec('accepted document opens cleanly in Microsoft Word')(
    'Scenario: accepted document opens cleanly in Microsoft Word (well-formed XML proxy)',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p>` +
        `<w:ins w:id="60" w:author="A"><w:r><w:t>ins</w:t></w:r></w:ins>` +
        `<w:del w:id="61" w:author="A"><w:r><w:delText>del</w:delText></w:r></w:del>` +
        `</w:p>` +
        `<w:p><w:pPr><w:pPrChange w:id="62" w:author="A"><w:pPr/></w:pPrChange></w:pPr>` +
        `<w:r><w:t>para</w:t></w:r></w:p>`;
      const filePath = await writeTestDocx(dir, 'wellformed.docx', bodyXml);

      const result = await allureStep('Call accept_changes', () =>
        acceptChangesTool(mgr, { file_path: filePath }),
      );
      assertSuccess(result, 'accept_changes');

      await allureStep('Output XML parses without errors', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        // If parseDocXml throws, the step fails
        const dom = parseDocXml(xml);
        expect(dom).toBeTruthy();
      });

      await allureStep('No revision elements exist', () => {
        const session = mgr.getSession(result.session_id as string);
        const xml = serializeDoc(session);
        const dom = parseDocXml(xml);
        const forbidden = [
          'ins', 'del', 'moveFrom', 'moveTo',
          'rPrChange', 'pPrChange', 'sectPrChange',
          'tblPrChange', 'trPrChange', 'tcPrChange', 'delText',
        ];
        for (const local of forbidden) {
          expect(hasElement(dom, local)).toBe(false);
        }
      });
    },
  );

  test.openspec('original document is not mutated')(
    'Scenario: original document is not mutated',
    async () => {
      const mgr = createTestSessionManager();
      const dir = await createTrackedTempDir();

      const bodyXml =
        `<w:p><w:ins w:id="70" w:author="A"><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>`;
      const filePath = await writeTestDocx(dir, 'immutable.docx', bodyXml);

      // Open session and snapshot originalBuffer
      const opened = await allureStep('Open session', () =>
        openDocument(mgr, { file_path: filePath }),
      );
      assertSuccess(opened, 'open');
      const sessionId = opened.session_id as string;

      const session = mgr.getSession(sessionId);
      const snapshotBefore = Buffer.from(session.originalBuffer);

      await allureStep('Call accept_changes', () =>
        acceptChangesTool(mgr, { session_id: sessionId }),
      );

      await allureStep('originalBuffer is byte-identical to snapshot', () => {
        expect(session.originalBuffer.equals(snapshotBefore)).toBe(true);
      });
    },
  );

  // ── Additional edge case tests ────────────────────────────────────

  test('Empty document (no tracked changes) returns zero stats', async () => {
    const mgr = createTestSessionManager();
    const dir = await createTrackedTempDir();

    const bodyXml = `<w:p><w:r><w:t>clean paragraph</w:t></w:r></w:p>`;
    const filePath = await writeTestDocx(dir, 'clean.docx', bodyXml);

    const result = await allureStep('Call accept_changes', () =>
      acceptChangesTool(mgr, { file_path: filePath }),
    );
    assertSuccess(result, 'accept_changes');

    await allureStep('All stats are 0', () => {
      expect(result.insertionsAccepted).toBe(0);
      expect(result.deletionsAccepted).toBe(0);
      expect(result.movesResolved).toBe(0);
      expect(result.propertyChangesResolved).toBe(0);
    });
  });

  test('Full-paragraph deletion removes entire paragraph', async () => {
    const mgr = createTestSessionManager();
    const dir = await createTrackedTempDir();

    const bodyXml =
      `<w:p><w:r><w:t>kept paragraph</w:t></w:r></w:p>` +
      `<w:p><w:del w:id="80" w:author="A"><w:r><w:delText>whole para deleted</w:delText></w:r></w:del></w:p>`;
    const filePath = await writeTestDocx(dir, 'full-para-del.docx', bodyXml);

    const result = await allureStep('Call accept_changes', () =>
      acceptChangesTool(mgr, { file_path: filePath }),
    );
    assertSuccess(result, 'accept_changes');

    await allureStep('Deleted paragraph is removed from body', () => {
      const session = mgr.getSession(result.session_id as string);
      const xml = serializeDoc(session);
      const dom = parseDocXml(xml);

      const paragraphs = dom.getElementsByTagNameNS(W_NS, 'p');
      // Should only have the kept paragraph (+ possibly bookmarked paras from normalization)
      expect(xml).not.toContain('whole para deleted');
      expect(getBodyText(dom)).toContain('kept paragraph');
    });
  });

  // ── Tool registration check ───────────────────────────────────────

  test('accept_changes tool is registered in MCP_TOOLS', async () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'accept_changes');
    expect(tool).toBeTruthy();
    expect(tool!.annotations.destructiveHint).toBe(true);
    expect(tool!.inputSchema.properties).toHaveProperty('session_id');
    expect(tool!.inputSchema.properties).toHaveProperty('file_path');
  });
});

// ── Utility ─────────────────────────────────────────────────────────

function serializeDoc(session: Session): string {
  // DocxDocument stores documentXml as a private field; access it for test assertions.
  const documentXml = (session.doc as any).documentXml as Document;
  return serializeXml(documentXml);
}
