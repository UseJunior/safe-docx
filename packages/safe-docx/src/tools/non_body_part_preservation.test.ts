import { describe, expect } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import { DocxZip } from '@usejunior/docx-primitives';

import { download } from './download.js';
import { formatLayout } from './format_layout.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';

async function readZipTextParts(filePath: string, parts: string[]): Promise<Record<string, string>> {
  const buffer = await fs.readFile(filePath);
  const zip = await DocxZip.load(buffer as Buffer);
  const out: Record<string, string> = {};
  for (const part of parts) {
    out[part] = await zip.readText(part);
  }
  return out;
}

describe('format_layout: non-body part preservation', () => {
  registerCleanup();

  test('editing layout in document.xml does not mutate non-body package parts', async () => {
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Cover Terms</w:t></w:r></w:p>` +
      `<w:tbl>` +
      `<w:tr>` +
      `<w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      `<w:tr>` +
      `<w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      `</w:tbl>` +
      `</w:body>` +
      `</w:document>`;

    const extraFiles = {
      'word/header1.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:p><w:r><w:t>Header Part</w:t></w:r></w:p>` +
        `</w:hdr>`,
      'word/footer1.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:p><w:r><w:t>Footer Part</w:t></w:r></w:p>` +
        `</w:ftr>`,
      'word/footnotes.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:footnote w:id="1"><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote>` +
        `</w:footnotes>`,
      'word/comments.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:comment w:id="0" w:author="Author"><w:p><w:r><w:t>Comment text</w:t></w:r></w:p></w:comment>` +
        `</w:comments>`,
      'customXml/item1.xml': `<root><value>Custom XML payload</value></root>`,
      'docProps/core.xml':
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">` +
        `<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Safe Docx Fixture</dc:title>` +
        `</cp:coreProperties>`,
    };

    const opened = await openSession([], {
      xml: documentXml,
      extraFiles,
      prefix: 'safe-docx-non-body-preservation-',
    });

    const formatted = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      row_height: {
        table_indexes: [0],
        row_indexes: [1],
        value_twips: 420,
        rule: 'exact',
      },
      cell_padding: {
        table_indexes: [0],
        row_indexes: [1],
        cell_indexes: [0],
        top_dxa: 80,
        bottom_dxa: 120,
        left_dxa: 60,
        right_dxa: 60,
      },
    });
    assertSuccess(formatted, 'format_layout');
    expect(formatted.mutation_summary).toEqual({
      affected_paragraphs: 0,
      affected_rows: 1,
      affected_cells: 1,
    });

    const outputPath = `${opened.tmpDir}/non-body-preserved.docx`;
    const saved = await download(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outputPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');

    const nonBodyParts = [
      'word/header1.xml',
      'word/footer1.xml',
      'word/footnotes.xml',
      'word/comments.xml',
      'customXml/item1.xml',
      'docProps/core.xml',
    ];
    const before = await readZipTextParts(opened.inputPath, nonBodyParts);
    const after = await readZipTextParts(outputPath, nonBodyParts);
    for (const part of nonBodyParts) {
      expect(after[part]).toBe(before[part]);
    }

    const outZip = await DocxZip.load(await fs.readFile(outputPath) as Buffer);
    const outDocumentXml = await outZip.readText('word/document.xml');
    expect(outDocumentXml.includes('w:trHeight')).toBe(true);
    expect(outDocumentXml.includes('w:tcMar')).toBe(true);
  });
});
