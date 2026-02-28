import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import { DocxZip, parseXml, serializeXml } from '@usejunior/docx-core';

import { save } from './save.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

function canonicalizeXml(xml: string): string {
  return serializeXml(parseXml(xml));
}

async function readZipXmlParts(filePath: string, parts: string[]): Promise<Record<string, string>> {
  const buffer = await fs.readFile(filePath);
  const zip = await DocxZip.load(buffer as Buffer);
  const out: Record<string, string> = {};
  for (const part of parts) {
    out[part] = await zip.readText(part);
  }
  return out;
}

describe('open_document/download: round-trip fidelity', () => {
  registerCleanup();

  test('open + clean download without edits preserves canonical XML for core parts', async () => {
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Body paragraph.</w:t></w:r></w:p>` +
      `</w:body>` +
      `</w:document>`;

    const extraFiles = {
      '[Content_Types].xml':
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
        `</Types>`,
      '_rels/.rels':
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
      'word/styles.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `</w:styles>`,
      'word/numbering.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
      'word/_rels/document.xml.rels':
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    };

    const opened = await openSession([], {
      xml: documentXml,
      extraFiles,
      prefix: 'safe-docx-roundtrip-fidelity-',
    });

    const outputPath = `${opened.tmpDir}/roundtrip-clean.docx`;
    const saved = await save(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outputPath,
      save_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'save');

    const xmlParts = [
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/_rels/document.xml.rels',
      '_rels/.rels',
      '[Content_Types].xml',
    ];
    const inputParts = await readZipXmlParts(opened.inputPath, xmlParts);
    const outputParts = await readZipXmlParts(outputPath, xmlParts);

    for (const part of xmlParts) {
      expect(canonicalizeXml(outputParts[part]!)).toBe(canonicalizeXml(inputParts[part]!));
    }
  });
});
