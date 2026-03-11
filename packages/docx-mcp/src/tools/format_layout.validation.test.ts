import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

import { formatLayout } from './format_layout.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Format Layout Validation' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('format_layout validation + strictness', () => {
  registerCleanup();

  test('validates strict type and missing operations', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;

    await given('a session with a paragraph', async () => {
      opened = await openSession(['Alpha paragraph']);
    });
    await when('formatLayout is called with an invalid strict type', async () => {
      const badStrict = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: 'yes' as unknown as boolean,
        paragraph_spacing: {
          paragraph_ids: [firstParaIdFromToon(opened.content)],
          after_twips: 100,
        },
      });
      expect(badStrict.success).toBe(false);
      if (!badStrict.success) expect(badStrict.error.code).toBe('VALIDATION_ERROR');
    });
    await then('formatLayout without any mutation operation also fails with VALIDATION_ERROR', async () => {
      const noMutation = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: true,
      });
      expect(noMutation.success).toBe(false);
      if (!noMutation.success) expect(noMutation.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test('enforces strict selector checks for paragraph/table/cell selectors', async ({ given, when, then, and }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;

    await given('a session with one paragraph and one table', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p><w:r><w:t>Only paragraph</w:t></w:r></w:p>` +
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl>` +
        `</w:body>` +
        `</w:document>`;

      opened = await openSession([], { xml, prefix: 'safe-docx-layout-strict-' });
    });
    await when('formatLayout is called with a missing paragraph ID in strict mode', async () => {
      const missingPara = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: true,
        paragraph_spacing: {
          paragraph_ids: ['_bk_missing'],
          after_twips: 120,
        },
      });
      expect(missingPara.success).toBe(false);
      if (!missingPara.success) expect(missingPara.error.code).toBe('INVALID_SELECTOR');
    });
    await and('formatLayout with a missing table index in strict mode fails with INVALID_SELECTOR', async () => {
      const missingTable = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: true,
        row_height: {
          table_indexes: [99],
          value_twips: 200,
          rule: 'exact',
        },
      });
      expect(missingTable.success).toBe(false);
      if (!missingTable.success) expect(missingTable.error.code).toBe('INVALID_SELECTOR');
    });
    await then('formatLayout with a missing cell index in strict mode fails with INVALID_SELECTOR', async () => {
      const missingCell = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: true,
        cell_padding: {
          table_indexes: [0],
          row_indexes: [0],
          cell_indexes: [5],
          left_dxa: 20,
        },
      });
      expect(missingCell.success).toBe(false);
      if (!missingCell.success) expect(missingCell.error.code).toBe('INVALID_SELECTOR');
    });
  });

  test('returns warnings (not errors) for missing selectors when strict=false', async ({ given, when, then }: AllureBddContext) => {
    let opened: Awaited<ReturnType<typeof openSession>>;
    let res: Awaited<ReturnType<typeof formatLayout>>;

    await given('a session with one paragraph and one table', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${W_NS}">` +
        `<w:body>` +
        `<w:p><w:r><w:t>P</w:t></w:r></w:p>` +
        `<w:tbl>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl>` +
        `</w:body>` +
        `</w:document>`;

      opened = await openSession([], { xml, prefix: 'safe-docx-layout-warn-' });
    });
    await when('formatLayout is called with missing selectors and strict=false', async () => {
      res = await formatLayout(opened.mgr, {
        session_id: opened.sessionId,
        strict: false,
        paragraph_spacing: {
          paragraph_ids: ['_bk_missing'],
          before_twips: 100,
        },
        row_height: {
          table_indexes: [0],
          row_indexes: [2],
          value_twips: 300,
          rule: 'auto',
        },
        cell_padding: {
          table_indexes: [0],
          row_indexes: [0],
          cell_indexes: [3],
          top_dxa: 15,
        },
      });
    });
    await then('it succeeds with warnings instead of errors', () => {
      assertSuccess(res, 'format_layout strict=false');
      expect(Array.isArray(res.warnings)).toBe(true);
      expect((res.warnings as string[]).length).toBeGreaterThan(0);
      expect(res.message).toContain('No document nodes matched');
    });
  });
});
