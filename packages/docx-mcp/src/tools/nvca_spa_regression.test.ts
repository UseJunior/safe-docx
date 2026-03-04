/**
 * NVCA SPA regression tests — verify that the 6 representative edits
 * from a real redline (SPA-edited.redline) apply correctly to the
 * NVCA Stock Purchase Agreement source document.
 *
 * These tests exercise the full replace_text / insert_paragraph pipeline
 * against a production-quality OOXML document with mixed-format runs,
 * defined terms (bold), smart quotes, and multi-section structure.
 */
import { describe, expect, afterEach } from 'vitest';
import { testAllure as test } from '../testing/allure-test.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getParagraphRuns } from '@usejunior/docx-core';

import { SessionManager } from '../session/manager.js';
import { openDocument } from './open_document.js';
import { replaceText } from './replace_text.js';
import { insertParagraph } from './insert_paragraph.js';
import { save } from './save.js';
import { parseOutputXml } from '../testing/session-test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE = path.resolve(__dirname, '../../../../tests/test_documents/nvca-regression/source.docx');

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function createMgr(): SessionManager {
  return new SessionManager({ ttlMs: 60 * 60 * 1000 });
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTempDir(prefix = 'nvca-spa-'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function openSPA(): Promise<{ mgr: SessionManager; sid: string }> {
  const mgr = createMgr();
  const openRes = await openDocument(mgr, { file_path: SOURCE });
  expect(openRes.success).toBe(true);
  return { mgr, sid: openRes.session_id as string };
}

function assertSuccess(result: { success: boolean }, label: string): void {
  expect(result.success, `${label} should succeed — got: ${JSON.stringify(result)}`).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NVCA SPA regression: redline edits', () => {
  test('Change 1: title "SERIES A" → "SERIES A-1" preserves formatting', async () => {
    const { mgr, sid } = await openSPA();
    const pid = '_bk_8c71639f1440';

    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: pid,
      old_string: 'SERIES [___] PREFERRED STOCK PURCHASE AGREEMENT',
      new_string: 'SERIES A-1 PREFERRED STOCK PURCHASE AGREEMENT',
      instruction: 'Change series designation from placeholder to A-1',
    });
    assertSuccess(result, 'title replacement');

    const session = mgr.getSession(sid);
    const afterText = session.doc.getParagraphTextById(pid);
    expect(afterText).toBe('SERIES A-1 PREFERRED STOCK PURCHASE AGREEMENT');
  });

  test('Change 2: extra colon insertion after "as follows:"', async () => {
    const { mgr, sid } = await openSPA();
    const pid = '_bk_00b3dd3a32dd';

    // The redline showed an extra colon inserted. We'll test appending text.
    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: pid,
      old_string: 'The parties hereby agree as follows:',
      new_string: 'The parties hereby agree as follows::',
      instruction: 'Insert extra colon (redline test)',
    });
    assertSuccess(result, 'colon insertion');

    const session = mgr.getSession(sid);
    const afterText = session.doc.getParagraphTextById(pid);
    expect(afterText).toContain('follows::');
  });

  test('Change 3: insert RECITALS paragraph before "as follows:"', async () => {
    const { mgr, sid } = await openSPA();
    const anchorPid = '_bk_00b3dd3a32dd'; // "The parties hereby agree as follows:"

    const result = await insertParagraph(mgr, {
      session_id: sid,
      positional_anchor_node_id: anchorPid,
      new_string: 'WHEREAS, the Company desires to sell shares of its Preferred Stock; and WHEREAS, the Purchasers desire to purchase such shares.',
      instruction: 'Insert RECITALS paragraph',
      position: 'BEFORE',
    });
    assertSuccess(result, 'RECITALS insertion');

    // Verify the new paragraph exists
    const session = mgr.getSession(sid);
    const view = session.doc.buildDocumentView({ includeSemanticTags: false });
    const followsIdx = view.nodes.findIndex(n => n.id === anchorPid);
    expect(followsIdx).toBeGreaterThan(0);
    // The inserted paragraph should be right before
    const inserted = view.nodes[followsIdx - 1];
    expect(inserted?.text).toContain('WHEREAS');
  });

  test('Change 4: Code definition expanded — appends clause preserving bold "Code"', async () => {
    const { mgr, sid } = await openSPA();
    const pid = '_bk_edef90d4bf7c';

    // Source: "Code" means the Internal Revenue Code of 1986, as amended.
    // (Runs: \u201c (plain) | Code (bold) | \u201d means the Internal Revenue Code of 1986, as amended. (plain))
    // Target: append ", and the Treasury regulations promulgated thereunder."
    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: pid,
      old_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended.',
      new_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended, and the Treasury regulations promulgated thereunder.',
      instruction: 'Expand Code definition to include Treasury regulations',
    });
    assertSuccess(result, 'Code definition expansion');

    const session = mgr.getSession(sid);
    const afterText = session.doc.getParagraphTextById(pid);
    expect(afterText).toContain('Treasury regulations');
    expect(afterText).toContain('\u201cCode\u201d');

    // Verify formatting: "Code" should still be bold
    const pEl = session.doc.getParagraphElementById(pid)!;
    const runs = getParagraphRuns(pEl);

    // Find the run containing "Code"
    const codeRun = runs.find(r => r.text.includes('Code') && !r.text.includes('Internal'));
    expect(codeRun, 'should find a run with just "Code"').toBeDefined();

    const rPr = codeRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
    const hasBold = rPr ? rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
    expect(hasBold, '"Code" run should remain bold').toBe(true);

    // Verify the appended text is NOT bold
    const treasuryRun = runs.find(r => r.text.includes('Treasury'));
    expect(treasuryRun, 'should find a run containing "Treasury"').toBeDefined();
    const tRPr = treasuryRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
    const treasuryBold = tRPr ? tRPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
    expect(treasuryBold, '"Treasury regulations" should NOT be bold').toBe(false);
  });

  test('Change 5: MAE definition expanded with carve-out — preserves bold defined term', async () => {
    const { mgr, sid } = await openSPA();
    const pid = '_bk_2b87998276ec';

    // Source: "Material Adverse Effect" means a material adverse effect on the business,
    //   assets (including intangible assets), liabilities, financial condition,
    //   property, or results of operations of the Company.
    // (Runs: \u201c (plain) | Material Adverse Effect (bold) | \u201d means ... (plain))
    // Target: append carve-out proviso
    const oldText = '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company.';
    const newText = '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company; provided, however, that none of the following shall be deemed to constitute, and none of the following shall be taken into account in determining whether there has been, a Material Adverse Effect: (i) any adverse change, event, or effect arising from or relating to general business or economic conditions.';

    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: pid,
      old_string: oldText,
      new_string: newText,
      instruction: 'Expand MAE definition with carve-out provision',
    });
    assertSuccess(result, 'MAE definition expansion');

    const session = mgr.getSession(sid);
    const afterText = session.doc.getParagraphTextById(pid);
    expect(afterText).toContain('provided, however');
    expect(afterText).toContain('Material Adverse Effect');

    // Verify formatting: "Material Adverse Effect" should still be bold
    const pEl = session.doc.getParagraphElementById(pid)!;
    const runs = getParagraphRuns(pEl);

    const maeRun = runs.find(r => r.text.includes('Material Adverse Effect') && !r.text.includes('means'));
    expect(maeRun, 'should find a run with just "Material Adverse Effect"').toBeDefined();

    const rPr = maeRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
    const hasBold = rPr ? rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
    expect(hasBold, '"Material Adverse Effect" should remain bold').toBe(true);

    // Verify the proviso text is NOT bold
    const provisoRun = runs.find(r => r.text.includes('provided, however'));
    expect(provisoRun, 'should find a run with "provided, however"').toBeDefined();
    const pRPr = provisoRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
    const provisoBold = pRPr ? pRPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
    expect(provisoBold, 'proviso text should NOT be bold').toBe(false);
  });

  test('Change 6: Oxford comma — "Corporate Power and" → "Corporate Power, and"', async () => {
    const { mgr, sid } = await openSPA();
    const pid = '_bk_36e982f3906a';

    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: pid,
      old_string: 'Organization, Good Standing, Corporate Power and Qualification',
      new_string: 'Organization, Good Standing, Corporate Power, and Qualification',
      instruction: 'Add Oxford comma before "and Qualification"',
    });
    assertSuccess(result, 'Oxford comma insertion');

    const session = mgr.getSession(sid);
    const afterText = session.doc.getParagraphTextById(pid);
    expect(afterText).toBe('Organization, Good Standing, Corporate Power, and Qualification');
  });
});

describe('NVCA SPA regression: batch edit + save round-trip', () => {
  test('applies all 5 replacements in batch, saves clean output, formatting preserved', async () => {
    const { mgr, sid } = await openSPA();
    const tmpDir = await makeTempDir();

    // Apply all 5 replacement edits sequentially (insert tested separately)
    const edits = [
      {
        pid: '_bk_8c71639f1440',
        old: 'SERIES [___] PREFERRED STOCK PURCHASE AGREEMENT',
        new_: 'SERIES A-1 PREFERRED STOCK PURCHASE AGREEMENT',
        instruction: 'Change series to A-1',
      },
      {
        pid: '_bk_00b3dd3a32dd',
        old: 'The parties hereby agree as follows:',
        new_: 'The parties hereby agree as follows::',
        instruction: 'Extra colon',
      },
      {
        pid: '_bk_edef90d4bf7c',
        old: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended.',
        new_: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended, and the Treasury regulations promulgated thereunder.',
        instruction: 'Expand Code definition',
      },
      {
        pid: '_bk_2b87998276ec',
        old: '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company.',
        new_: '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company; provided, however, that none of the following shall be deemed to constitute a Material Adverse Effect: (i) general business or economic conditions.',
        instruction: 'Expand MAE with carve-out',
      },
      {
        pid: '_bk_36e982f3906a',
        old: 'Organization, Good Standing, Corporate Power and Qualification',
        new_: 'Organization, Good Standing, Corporate Power, and Qualification',
        instruction: 'Oxford comma',
      },
    ];

    for (const edit of edits) {
      const result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: edit.pid,
        old_string: edit.old,
        new_string: edit.new_,
        instruction: edit.instruction,
      });
      assertSuccess(result, edit.instruction);
    }

    // Save clean output
    const cleanPath = path.join(tmpDir, 'nvca-edited-clean.docx');
    const saveRes = await save(mgr, {
      session_id: sid,
      save_to_local_path: cleanPath,
      save_format: 'clean',
    });
    assertSuccess(saveRes, 'save clean');

    // Verify the saved file exists and is non-empty
    const stat = await fs.stat(cleanPath);
    expect(stat.size).toBeGreaterThan(50_000);

    // Parse the output XML and verify formatting
    const parsed = await parseOutputXml(cleanPath);

    // Find the bold "Code" defined term run.
    // After merge, the "Code" text lives in its own run (bold) or is part of a larger run.
    // We look for a run whose text is exactly "Code" or close to it.
    const codeRuns = parsed.runs.filter(r => {
      const text = parsed.runText(r).trim();
      // The defined term "Code" should be in its own bold run
      return text === 'Code';
    });
    // If no exact match, fall back to runs that contain "Code" and are short
    const codeRunsToCheck = codeRuns.length > 0
      ? codeRuns
      : parsed.runs.filter(r => {
          const text = parsed.runText(r).trim();
          return text.includes('Code') && text.length < 20 && !text.includes('Internal');
        });
    expect(codeRunsToCheck.length).toBeGreaterThanOrEqual(1);
    for (const r of codeRunsToCheck) {
      expect(parsed.hasBold(r), `"Code" run "${parsed.runText(r)}" should be bold`).toBe(true);
    }

    // Find runs containing "Material Adverse Effect"
    // The defined term may be in its own run or merged with adjacent text
    const maeRuns = parsed.runs.filter(r => {
      const text = parsed.runText(r).trim();
      return text === 'Material Adverse Effect';
    });
    const maeRunsToCheck = maeRuns.length > 0
      ? maeRuns
      : parsed.runs.filter(r => {
          const text = parsed.runText(r).trim();
          return text.includes('Material Adverse Effect') && text.length < 40;
        });
    expect(maeRunsToCheck.length).toBeGreaterThanOrEqual(1);
    for (const r of maeRunsToCheck) {
      expect(parsed.hasBold(r), `"Material Adverse Effect" run "${parsed.runText(r)}" should be bold`).toBe(true);
    }

    // Verify the Treasury regulations text is NOT bold
    const treasuryRuns = parsed.runs.filter(r => parsed.runText(r).includes('Treasury'));
    expect(treasuryRuns.length).toBeGreaterThanOrEqual(1);
    for (const r of treasuryRuns) {
      expect(parsed.hasBold(r), '"Treasury" run should NOT be bold').toBe(false);
    }

    // Verify the proviso text is NOT bold
    const provisoRuns = parsed.runs.filter(r => parsed.runText(r).includes('provided, however'));
    expect(provisoRuns.length).toBeGreaterThanOrEqual(1);
    for (const r of provisoRuns) {
      expect(parsed.hasBold(r), '"provided, however" run should NOT be bold').toBe(false);
    }
  });

  test('saves tracked-changes output with correct redlines', async () => {
    const { mgr, sid } = await openSPA();
    const tmpDir = await makeTempDir();

    // Apply a representative edit
    const result = await replaceText(mgr, {
      session_id: sid,
      target_paragraph_id: '_bk_edef90d4bf7c',
      old_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended.',
      new_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended, and the Treasury regulations promulgated thereunder.',
      instruction: 'Expand Code definition',
    });
    assertSuccess(result, 'replace');

    // Save tracked-changes output
    const trackedPath = path.join(tmpDir, 'nvca-edited-tracked.docx');
    const saveRes = await save(mgr, {
      session_id: sid,
      save_to_local_path: trackedPath,
      save_format: 'tracked',
      tracked_changes_author: 'NVCA Test',
    });
    assertSuccess(saveRes, 'save tracked');

    // Verify the tracked file contains revision markup
    const { readDocumentXmlFromPath } = await import('../testing/docx_test_utils.js');
    const trackedXml = await readDocumentXmlFromPath(trackedPath);
    // Should contain w:ins (insertion) and w:del (deletion) elements
    expect(trackedXml).toContain('w:ins');
    expect(trackedXml).toContain('w:del');
    // The inserted text should appear
    expect(trackedXml).toContain('Treasury');
  });
});
