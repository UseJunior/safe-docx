import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFile } from './read_file.js';
import { save } from './save.js';
import { formatLayout } from './format_layout.js';
import { firstParaIdFromToon, extractParaIdsFromToon } from '../testing/docx_test_utils.js';
import { testAllure, allureStep } from '../testing/allure-test.js';
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
    const { opened, paraId } = await allureStep('Given a session with two paragraphs', async () => {
      const o = await openSession(['Alpha clause', 'Beta clause']);
      const pid = firstParaIdFromToon(o.content);
      return { opened: o, paraId: pid };
    });

    const formatted = await allureStep('When paragraph spacing is applied', async () => {
      const result = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        paragraph_spacing: {
          paragraph_ids: [paraId],
          before_twips: 120,
          after_twips: 240,
          line_twips: 360,
          line_rule: 'auto',
        },
      });
      assertSuccess(result, 'format_layout');
      return result;
    });

    await allureStep('Then mutation summary reports 1 affected paragraph', () => {
      expect(formatted.mutation_summary).toEqual({
        affected_paragraphs: 1,
        affected_rows: 0,
        affected_cells: 0,
      });
    });

    await allureStep('Then saved output contains correct spacing attributes', async () => {
      const outPath = path.join(opened.tmpDir, 'layout-spacing.docx');
      const saved = await save(opened.mgr, {
        session_id: opened.sessionId,
        save_to_local_path: outPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      assertSuccess(saved, 'save');

      const { dom } = await parseOutputXml(outPath);
      const spacing = dom.getElementsByTagNameNS(W_NS, 'spacing').item(0) as Element | null;
      expect(spacing).toBeTruthy();
      expect(getWAttr(spacing!, 'before')).toBe('120');
      expect(getWAttr(spacing!, 'after')).toBe('240');
      expect(getWAttr(spacing!, 'line')).toBe('360');
      expect(getWAttr(spacing!, 'lineRule')).toBe('auto');
    });
  });

  humanReadableTest.openspec('format table row height and cell padding')('Scenario: format table row height and cell padding', async () => {
    const opened = await allureStep('Given a session with a 2x2 table', async () => {
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
      return openSession([], { xml, prefix: 'safe-docx-layout-table-' });
    });

    const formatted = await allureStep('When row height and cell padding are applied', async () => {
      const result = await formatLayout(opened.mgr, {
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
      assertSuccess(result, 'format_layout');
      return result;
    });

    await allureStep('Then mutation summary reports 1 row and 1 cell affected', () => {
      expect(formatted.mutation_summary).toEqual({
        affected_paragraphs: 0,
        affected_rows: 1,
        affected_cells: 1,
      });
    });

    await allureStep('Then saved output contains correct trHeight and tcMar', async () => {
      const outPath = path.join(opened.tmpDir, 'layout-table.docx');
      const saved = await save(opened.mgr, {
        session_id: opened.sessionId,
        save_to_local_path: outPath,
        save_format: 'clean',
        clean_bookmarks: true,
      });
      assertSuccess(saved, 'save');

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
  });

  humanReadableTest.openspec('invalid layout values are rejected with structured error')('Scenario: invalid layout values are rejected with structured error', async () => {
    const { opened, paraId } = await allureStep('Given a session with one paragraph', async () => {
      const o = await openSession(['Alpha clause']);
      const pid = firstParaIdFromToon(o.content);
      return { opened: o, paraId: pid };
    });

    const invalid = await allureStep('When a negative after_twips value is submitted', async () => {
      return formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        paragraph_spacing: {
          paragraph_ids: [paraId],
          after_twips: -1,
        },
      });
    });

    await allureStep('Then it fails with VALIDATION_ERROR hinting non-negative', () => {
      assertFailure(invalid, 'VALIDATION_ERROR', 'format_layout invalid value');
      expect(invalid.error.hint).toContain('non-negative');
    });
  });

  humanReadableTest.openspec('no spacer paragraphs are introduced')('Scenario: no spacer paragraphs are introduced', async () => {
    const { opened, beforeIds } = await allureStep('Given a session with three paragraphs', async () => {
      const o = await openSession(['One', 'Two', 'Three']);
      const ids = extractParaIdsFromToon(o.content);
      return { opened: o, beforeIds: ids };
    });

    const formatted = await allureStep('When spacing is applied to the second paragraph', async () => {
      const result = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        paragraph_spacing: {
          paragraph_ids: [beforeIds[1]!],
          after_twips: 200,
        },
      });
      assertSuccess(result, 'format_layout');
      return result;
    });

    await allureStep('Then no spacer paragraphs flag is true and count is unchanged', async () => {
      expect(formatted.no_spacer_paragraphs).toBe(true);

      const after = await readFile(opened.mgr, { session_id: opened.sessionId, format: 'simple' });
      assertSuccess(after, 'read after');
      const afterIds = extractParaIdsFromToon(String(after.content));
      expect(afterIds.length).toBe(beforeIds.length);
    });
  });

  humanReadableTest.openspec('paragraph IDs remain stable after layout formatting')('Scenario: paragraph IDs remain stable after layout formatting', async () => {
    const { opened, beforeIds } = await allureStep('Given a session with three paragraphs', async () => {
      const o = await openSession(['First', 'Second', 'Third']);
      const ids = extractParaIdsFromToon(o.content);
      return { opened: o, beforeIds: ids };
    });

    await allureStep('When spacing is applied to the first and third paragraphs', async () => {
      const result = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        paragraph_spacing: {
          paragraph_ids: [beforeIds[0]!, beforeIds[2]!],
          before_twips: 120,
          after_twips: 180,
        },
      });
      assertSuccess(result, 'format_layout');
    });

    await allureStep('Then paragraph IDs are identical before and after', async () => {
      const after = await readFile(opened.mgr, { session_id: opened.sessionId, format: 'simple' });
      assertSuccess(after, 'read after');
      const afterIds = extractParaIdsFromToon(String(after.content));
      expect(afterIds).toEqual(beforeIds);
    });
  });

  humanReadableTest.openspec('npx runtime remains Python-free')('Scenario: npx runtime remains Python-free', async () => {
    const depNames = await allureStep('Given the combined dependencies from package.json', async () => {
      const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
      const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
      };
      return Object.keys(deps).join(' ').toLowerCase();
    });

    await allureStep('Then no python or aspose dependencies exist', () => {
      expect(depNames.includes('python')).toBe(false);
      expect(depNames.includes('aspose')).toBe(false);
    });
  });

  humanReadableTest.openspec('format_layout does not invoke external process tooling at runtime')(
    'Scenario: format_layout does not invoke external process tooling at runtime',
    async () => {
      const { opened, paraId } = await allureStep('Given a session and an empty PATH', async () => {
        const o = await openSession(['Runtime boundary']);
        const pid = firstParaIdFromToon(o.content);
        return { opened: o, paraId: pid };
      });

      await allureStep('When format_layout runs with PATH emptied', async () => {
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
      });
    },
  );
});
