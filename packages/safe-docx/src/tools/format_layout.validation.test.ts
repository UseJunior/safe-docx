import { describe, expect } from 'vitest';
import { itAllure as it } from '../testing/allure-test.js';

import { formatLayout } from './format_layout.js';
import { openSession, assertSuccess, registerCleanup } from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('format_layout validation + strictness', () => {
  registerCleanup();

  it('validates strict type and missing operations', async () => {
    const opened = await openSession(['Alpha paragraph']);

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

    const noMutation = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      strict: true,
    });
    expect(noMutation.success).toBe(false);
    if (!noMutation.success) expect(noMutation.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces strict selector checks for paragraph/table/cell selectors', async () => {
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

    const opened = await openSession([], { xml, prefix: 'safe-docx-layout-strict-' });

    const missingPara = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      strict: true,
      paragraph_spacing: {
        paragraph_ids: ['jr_para_missing'],
        after_twips: 120,
      },
    });
    expect(missingPara.success).toBe(false);
    if (!missingPara.success) expect(missingPara.error.code).toBe('INVALID_SELECTOR');

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

  it('returns warnings (not errors) for missing selectors when strict=false', async () => {
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

    const opened = await openSession([], { xml, prefix: 'safe-docx-layout-warn-' });
    const res = await formatLayout(opened.mgr, {
      session_id: opened.sessionId,
      strict: false,
      paragraph_spacing: {
        paragraph_ids: ['jr_para_missing'],
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

    assertSuccess(res, 'format_layout strict=false');
    expect(Array.isArray(res.warnings)).toBe(true);
    expect((res.warnings as string[]).length).toBeGreaterThan(0);
    expect(res.message).toContain('No document nodes matched');
  });
});
