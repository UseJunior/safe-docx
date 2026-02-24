import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFile } from './read_file.js';
import { download } from './download.js';
import { formatLayout } from './format_layout.js';
import { firstParaIdFromToon, extractParaIdsFromToon } from '../testing/docx_test_utils.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  parseOutputXml,
  registerCleanup,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-safe-docx-layout-format-controls';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function getWAttr(el: Element, localName: string): string | null {
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

describe('Traceability: Layout Format Controls', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });
  registerCleanup();

  humanReadableTest.openspec('format paragraph spacing by paragraph ID')('Scenario: format paragraph spacing by paragraph ID', async () => {
    const opened = await openSession(['Alpha clause', 'Beta clause']);
    const paraId = firstParaIdFromToon(opened.content);

    const formatted = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [paraId],
        before_twips: 120,
        after_twips: 240,
        line_twips: 360,
        line_rule: 'auto',
      },
    });
    assertSuccess(formatted, 'format_layout');
    expect(formatted.mutation_summary).toEqual({
      affected_paragraphs: 1,
      affected_rows: 0,
      affected_cells: 0,
    });

    const outPath = path.join(opened.tmpDir, 'layout-spacing.docx');
    const saved = await download(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');

    const { dom } = await parseOutputXml(outPath);
    const spacing = dom.getElementsByTagNameNS(W_NS, 'spacing').item(0) as Element | null;
    expect(spacing).toBeTruthy();
    expect(getWAttr(spacing!, 'before')).toBe('120');
    expect(getWAttr(spacing!, 'after')).toBe('240');
    expect(getWAttr(spacing!, 'line')).toBe('360');
    expect(getWAttr(spacing!, 'lineRule')).toBe('auto');
  });

  humanReadableTest.openspec('format table row height and cell padding')('Scenario: format table row height and cell padding', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Table heading</w:t></w:r></w:p>` +
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

    const opened = await openSession([], { xml, prefix: 'safe-docx-layout-table-' });
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

    const outPath = path.join(opened.tmpDir, 'layout-table.docx');
    const saved = await download(opened.mgr, {
      session_id: opened.sessionId,
      save_to_local_path: outPath,
      download_format: 'clean',
      clean_bookmarks: true,
    });
    assertSuccess(saved, 'download');

    const { dom } = await parseOutputXml(outPath);
    const trHeight = dom.getElementsByTagNameNS(W_NS, 'trHeight').item(0) as Element | null;
    expect(trHeight).toBeTruthy();
    expect(getWAttr(trHeight!, 'val')).toBe('420');
    expect(getWAttr(trHeight!, 'hRule')).toBe('exact');

    const tcMar = dom.getElementsByTagNameNS(W_NS, 'tcMar').item(0) as Element | null;
    expect(tcMar).toBeTruthy();
    const top = tcMar!.getElementsByTagNameNS(W_NS, 'top').item(0) as Element | null;
    const bottom = tcMar!.getElementsByTagNameNS(W_NS, 'bottom').item(0) as Element | null;
    const left = tcMar!.getElementsByTagNameNS(W_NS, 'left').item(0) as Element | null;
    const right = tcMar!.getElementsByTagNameNS(W_NS, 'right').item(0) as Element | null;
    expect(getWAttr(top!, 'w')).toBe('80');
    expect(getWAttr(bottom!, 'w')).toBe('120');
    expect(getWAttr(left!, 'w')).toBe('60');
    expect(getWAttr(right!, 'w')).toBe('60');
  });

  humanReadableTest.openspec('invalid layout values are rejected with structured error')('Scenario: invalid layout values are rejected with structured error', async () => {
    const opened = await openSession(['Alpha clause']);
    const paraId = firstParaIdFromToon(opened.content);

    const invalid = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [paraId],
        after_twips: -1,
      },
    });
    assertFailure(invalid, 'VALIDATION_ERROR', 'format_layout invalid value');
    expect(invalid.error.hint).toContain('non-negative');
  });

  humanReadableTest.openspec('no spacer paragraphs are introduced')('Scenario: no spacer paragraphs are introduced', async () => {
    const opened = await openSession(['One', 'Two', 'Three']);
    const beforeIds = extractParaIdsFromToon(opened.content);

    const formatted = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [beforeIds[1]!],
        after_twips: 200,
      },
    });
    assertSuccess(formatted, 'format_layout');
    expect(formatted.no_spacer_paragraphs).toBe(true);

    const after = await readFile(opened.mgr, { session_id: opened.sessionId, format: 'simple' });
    assertSuccess(after, 'read after');
    const afterIds = extractParaIdsFromToon(String(after.content));
    expect(afterIds.length).toBe(beforeIds.length);
  });

  humanReadableTest.openspec('paragraph IDs remain stable after layout formatting')('Scenario: paragraph IDs remain stable after layout formatting', async () => {
    const opened = await openSession(['First', 'Second', 'Third']);
    const beforeIds = extractParaIdsFromToon(opened.content);

    const formatted = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      paragraph_spacing: {
        paragraph_ids: [beforeIds[0]!, beforeIds[2]!],
        before_twips: 120,
        after_twips: 180,
      },
    });
    assertSuccess(formatted, 'format_layout');

    const after = await readFile(opened.mgr, { session_id: opened.sessionId, format: 'simple' });
    assertSuccess(after, 'read after');
    const afterIds = extractParaIdsFromToon(String(after.content));
    expect(afterIds).toEqual(beforeIds);
  });

  humanReadableTest.openspec('npx runtime remains Python-free')('Scenario: npx runtime remains Python-free', async () => {
    const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    };
    const depNames = Object.keys(deps).join(' ').toLowerCase();
    expect(depNames.includes('python')).toBe(false);
    expect(depNames.includes('aspose')).toBe(false);
  });

  humanReadableTest.openspec('format_layout does not invoke external process tooling at runtime')(
    'Scenario: format_layout does not invoke external process tooling at runtime',
    async () => {
      const opened = await openSession(['Runtime boundary']);
      const paraId = firstParaIdFromToon(opened.content);

      const originalPath = process.env.PATH;
      process.env.PATH = '';

      try {
        const formatted = await formatLayout(opened.mgr, {
          session_id: opened.sessionId,
          paragraph_spacing: {
            paragraph_ids: [paraId],
            after_twips: 120,
          },
        });
        assertSuccess(formatted, 'format_layout');
      } finally {
        process.env.PATH = originalPath;
      }
    },
  );
});
