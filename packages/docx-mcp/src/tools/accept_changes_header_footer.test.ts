import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { parseXml, readZipText, serializeXml } from '@usejunior/docx-core';
import { type DocxSession } from '../session/manager.js';
import { makeDocxWithDocumentXml } from '../testing/docx_test_utils.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { acceptChanges } from './accept_changes.js';

const TEST_FEATURE = 'add-markdoc-header-footer-authoring';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });

describe('accept_changes selected header projection', () => {
  registerCleanup();

  test.openspec('[SDX-MCP-STORY-01] accept_changes resolves a selected header revision')(
    'accepts a selected header without sweeping an orphan header',
    async () => {
      const selected =
        `<w:hdr xmlns:w="${W_NS}"><w:p>` +
        `<w:del w:id="91" w:author="AI"><w:r><w:delText>Old</w:delText></w:r></w:del>` +
        `<w:ins w:id="92" w:author="AI"><w:r><w:t>New</w:t></w:r></w:ins>` +
        `</w:p></w:hdr>`;
      const orphan =
        `<w:hdr xmlns:w="${W_NS}"><w:p><w:ins w:id="93" w:author="AI">` +
        `<w:r><w:t>Orphan</w:t></w:r></w:ins></w:p></w:hdr>`;
      const documentXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}" xmlns:r="${REL_BASE}"><w:body>` +
        `<w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>` +
        `</w:body></w:document>`;
      const source = await makeDocxWithDocumentXml(documentXml, {
        'word/_rels/document.xml.rels':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rIdHeader" Type="${REL_BASE}/header" Target="header-selected.xml"/>` +
          `</Relationships>`,
        'word/header-selected.xml': selected,
        'word/header-orphan.xml': orphan,
        '[Content_Types].xml':
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/header-selected.xml" ContentType="${HEADER_CONTENT_TYPE}"/>` +
          `<Override PartName="/word/header-orphan.xml" ContentType="${HEADER_CONTENT_TYPE}"/>` +
          `</Types>`,
      });
      const manager = createTestSessionManager();
      const filePath = path.join(await createTrackedTempDir(), 'selected-header.docx');
      await fs.writeFile(filePath, source);

      const result = await acceptChanges(manager, { file_path: filePath });
      assertSuccess(result, 'accept_changes');
      const session = (await manager.getSessionByFilePath(filePath)) as DocxSession;
      const output = (await session.doc.toBuffer()).buffer;
      const selectedOutput = await readZipText(output, 'word/header-selected.xml');

      expect(selectedOutput).toContain('New');
      expect(selectedOutput).not.toContain('Old');
      expect(selectedOutput).not.toMatch(/<w:(?:ins|del)\b/);
      expect(result.insertionsAccepted).toBe(1);
      expect(result.deletionsAccepted).toBe(1);
      expect(await readZipText(output, 'word/header-orphan.xml'))
        .toBe(await readZipText(source, 'word/header-orphan.xml'));
    },
  );

  test.openspec('[SDX-ROWREV-MCP-01] accept_changes resolves a deleted table row')(
    'retains the inherited resolved-row semantics while adding header support',
    async () => {
      const bodyXml =
        `<w:tbl><w:tr><w:trPr><w:del w:id="7" w:author="Reviewer"/>` +
        `</w:trPr><w:tc><w:p><w:r><w:t>Deleted row</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>`;
      const documentXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`;
      const manager = createTestSessionManager();
      const filePath = path.join(await createTrackedTempDir(), 'deleted-row.docx');
      await fs.writeFile(filePath, await makeDocxWithDocumentXml(documentXml));

      const result = await acceptChanges(manager, { file_path: filePath });
      assertSuccess(result, 'accept_changes');
      const session = (await manager.getSessionByFilePath(filePath)) as DocxSession;
      const projected = parseXml(serializeXml(
        (session.doc as unknown as { documentXml: Document }).documentXml,
      ));
      expect(projected.getElementsByTagNameNS(W_NS, 'tr')).toHaveLength(0);
      expect(result.deletionsAccepted).toBe(1);
      expect(result.unresolvedRowRevisions).toBe(0);
    },
  );
});
