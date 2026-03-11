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
import { testAllure as test, type AllureBddContext } from '../testing/allure-test.js';
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
  test('Change 1: title "SERIES A" → "SERIES A-1" preserves formatting', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const pid = '_bk_8c71639f1440';
    let result: Awaited<ReturnType<typeof replaceText>>;

    await given('the NVCA SPA source document is open in a new session', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('replaceText changes the series placeholder to SERIES A-1', async () => {
      result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: pid,
        old_string: 'SERIES [___] PREFERRED STOCK PURCHASE AGREEMENT',
        new_string: 'SERIES A-1 PREFERRED STOCK PURCHASE AGREEMENT',
        instruction: 'Change series designation from placeholder to A-1',
      });
    });

    await then('the replacement succeeds and the paragraph text is updated', () => {
      assertSuccess(result, 'title replacement');
      const session = mgr.getSession(sid);
      const afterText = session.doc.getParagraphTextById(pid);
      expect(afterText).toBe('SERIES A-1 PREFERRED STOCK PURCHASE AGREEMENT');
    });
  });

  test('Change 2: extra colon insertion after "as follows:"', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const pid = '_bk_00b3dd3a32dd';
    let result: Awaited<ReturnType<typeof replaceText>>;

    await given('the NVCA SPA source document is open in a new session', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('replaceText appends an extra colon after "as follows:"', async () => {
      result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: pid,
        old_string: 'The parties hereby agree as follows:',
        new_string: 'The parties hereby agree as follows::',
        instruction: 'Insert extra colon (redline test)',
      });
    });

    await then('the colon insertion succeeds and the paragraph contains the double colon', () => {
      assertSuccess(result, 'colon insertion');
      const session = mgr.getSession(sid);
      const afterText = session.doc.getParagraphTextById(pid);
      expect(afterText).toContain('follows::');
    });
  });

  test('Change 3: insert RECITALS paragraph before "as follows:"', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const anchorPid = '_bk_00b3dd3a32dd';
    let result: Awaited<ReturnType<typeof insertParagraph>>;

    await given('the NVCA SPA source document is open in a new session', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('insertParagraph inserts a WHEREAS recitals paragraph before "as follows:"', async () => {
      result = await insertParagraph(mgr, {
        session_id: sid,
        positional_anchor_node_id: anchorPid,
        new_string: 'WHEREAS, the Company desires to sell shares of its Preferred Stock; and WHEREAS, the Purchasers desire to purchase such shares.',
        instruction: 'Insert RECITALS paragraph',
        position: 'BEFORE',
      });
    });

    await then('the insertion succeeds and the WHEREAS paragraph appears immediately before the anchor', () => {
      assertSuccess(result, 'RECITALS insertion');
      const session = mgr.getSession(sid);
      const view = session.doc.buildDocumentView({ includeSemanticTags: false });
      const followsIdx = view.nodes.findIndex(n => n.id === anchorPid);
      expect(followsIdx).toBeGreaterThan(0);
      const inserted = view.nodes[followsIdx - 1];
      expect(inserted?.text).toContain('WHEREAS');
    });
  });

  test('Change 4: Code definition expanded — appends clause preserving bold "Code"', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const pid = '_bk_edef90d4bf7c';
    let result: Awaited<ReturnType<typeof replaceText>>;

    await given('the NVCA SPA source document is open with the Code definition paragraph', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('replaceText expands the Code definition to include Treasury regulations', async () => {
      result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: pid,
        old_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended.',
        new_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended, and the Treasury regulations promulgated thereunder.',
        instruction: 'Expand Code definition to include Treasury regulations',
      });
    });

    await then('the replacement succeeds and the paragraph contains the new clause', () => {
      assertSuccess(result, 'Code definition expansion');
      const session = mgr.getSession(sid);
      const afterText = session.doc.getParagraphTextById(pid);
      expect(afterText).toContain('Treasury regulations');
      expect(afterText).toContain('\u201cCode\u201d');
    });
    await and('"Code" run remains bold and Treasury regulations text is not bold', () => {
      const session = mgr.getSession(sid);
      const pEl = session.doc.getParagraphElementById(pid)!;
      const runs = getParagraphRuns(pEl);

      const codeRun = runs.find(r => r.text.includes('Code') && !r.text.includes('Internal'));
      expect(codeRun, 'should find a run with just "Code"').toBeDefined();
      const rPr = codeRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
      const hasBold = rPr ? rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
      expect(hasBold, '"Code" run should remain bold').toBe(true);

      const treasuryRun = runs.find(r => r.text.includes('Treasury'));
      expect(treasuryRun, 'should find a run containing "Treasury"').toBeDefined();
      const tRPr = treasuryRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
      const treasuryBold = tRPr ? tRPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
      expect(treasuryBold, '"Treasury regulations" should NOT be bold').toBe(false);
    });
  });

  test('Change 5: MAE definition expanded with carve-out — preserves bold defined term', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const pid = '_bk_2b87998276ec';
    let result: Awaited<ReturnType<typeof replaceText>>;
    const oldText = '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company.';
    const newText = '\u201cMaterial Adverse Effect\u201d means a material adverse effect on the business, assets (including intangible assets), liabilities, financial condition, property, or results of operations of the Company; provided, however, that none of the following shall be deemed to constitute, and none of the following shall be taken into account in determining whether there has been, a Material Adverse Effect: (i) any adverse change, event, or effect arising from or relating to general business or economic conditions.';

    await given('the NVCA SPA source document is open with the MAE definition paragraph', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('replaceText expands the MAE definition with a carve-out proviso', async () => {
      result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: pid,
        old_string: oldText,
        new_string: newText,
        instruction: 'Expand MAE definition with carve-out provision',
      });
    });

    await then('the expansion succeeds and the paragraph contains the proviso', () => {
      assertSuccess(result, 'MAE definition expansion');
      const session = mgr.getSession(sid);
      const afterText = session.doc.getParagraphTextById(pid);
      expect(afterText).toContain('provided, however');
      expect(afterText).toContain('Material Adverse Effect');
    });
    await and('"Material Adverse Effect" run remains bold and proviso text is not bold', () => {
      const session = mgr.getSession(sid);
      const pEl = session.doc.getParagraphElementById(pid)!;
      const runs = getParagraphRuns(pEl);

      const maeRun = runs.find(r => r.text.includes('Material Adverse Effect') && !r.text.includes('means'));
      expect(maeRun, 'should find a run with just "Material Adverse Effect"').toBeDefined();
      const rPr = maeRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
      const hasBold = rPr ? rPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
      expect(hasBold, '"Material Adverse Effect" should remain bold').toBe(true);

      const provisoRun = runs.find(r => r.text.includes('provided, however'));
      expect(provisoRun, 'should find a run with "provided, however"').toBeDefined();
      const pRPr = provisoRun!.r.getElementsByTagNameNS(W_NS, 'rPr').item(0) as Element | null;
      const provisoBold = pRPr ? pRPr.getElementsByTagNameNS(W_NS, 'b').length > 0 : false;
      expect(provisoBold, 'proviso text should NOT be bold').toBe(false);
    });
  });

  test('Change 6: Oxford comma — "Corporate Power and" → "Corporate Power, and"', async ({ given, when, then }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    const pid = '_bk_36e982f3906a';
    let result: Awaited<ReturnType<typeof replaceText>>;

    await given('the NVCA SPA source document is open with the qualification paragraph', async () => {
      ({ mgr, sid } = await openSPA());
    });

    await when('replaceText inserts an Oxford comma before "and Qualification"', async () => {
      result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: pid,
        old_string: 'Organization, Good Standing, Corporate Power and Qualification',
        new_string: 'Organization, Good Standing, Corporate Power, and Qualification',
        instruction: 'Add Oxford comma before "and Qualification"',
      });
    });

    await then('the paragraph text has the Oxford comma inserted', () => {
      assertSuccess(result, 'Oxford comma insertion');
      const session = mgr.getSession(sid);
      const afterText = session.doc.getParagraphTextById(pid);
      expect(afterText).toBe('Organization, Good Standing, Corporate Power, and Qualification');
    });
  });
});

describe('NVCA SPA regression: batch edit + save round-trip', { timeout: 30_000 }, () => {
  test('applies all 5 replacements in batch, saves clean output, formatting preserved', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let tmpDir: string;
    let savedCleanPath: string;
    let parsed: Awaited<ReturnType<typeof parseOutputXml>>;

    await given('the NVCA SPA source document is open in a new session', async () => {
      ({ mgr, sid } = await openSPA());
      tmpDir = await makeTempDir();
    });

    await when('all 5 replacement edits are applied sequentially and the clean output is saved', async () => {
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
      savedCleanPath = path.join(tmpDir, 'nvca-edited-clean.docx');
      const saveRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: savedCleanPath,
        save_format: 'clean',
      });
      assertSuccess(saveRes, 'save clean');
      parsed = await parseOutputXml(savedCleanPath);
    });

    await then('the saved clean file exists and is non-empty', async () => {
      const stat = await fs.stat(savedCleanPath);
      expect(stat.size).toBeGreaterThan(50_000);
    });
    await and('"Code" defined-term runs remain bold in the output', () => {
      // Find the bold "Code" defined term run.
      const codeRuns = parsed.runs.filter(r => {
        const text = parsed.runText(r).trim();
        return text === 'Code';
      });
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
    });
    await and('"Material Adverse Effect" runs remain bold and proviso/Treasury runs are not bold', () => {
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

      const treasuryRuns = parsed.runs.filter(r => parsed.runText(r).includes('Treasury'));
      expect(treasuryRuns.length).toBeGreaterThanOrEqual(1);
      for (const r of treasuryRuns) {
        expect(parsed.hasBold(r), '"Treasury" run should NOT be bold').toBe(false);
      }

      const provisoRuns = parsed.runs.filter(r => parsed.runText(r).includes('provided, however'));
      expect(provisoRuns.length).toBeGreaterThanOrEqual(1);
      for (const r of provisoRuns) {
        expect(parsed.hasBold(r), '"provided, however" run should NOT be bold').toBe(false);
      }
    });
  });

  test('saves tracked-changes output with correct redlines', async ({ given, when, then, and }: AllureBddContext) => {
    let mgr: ReturnType<typeof createMgr>;
    let sid: string;
    let trackedPath: string;
    let saveRes: Awaited<ReturnType<typeof save>>;

    await given('the NVCA SPA source document is open and the Code definition has been expanded', async () => {
      ({ mgr, sid } = await openSPA());
      const tmpDir = await makeTempDir();
      const result = await replaceText(mgr, {
        session_id: sid,
        target_paragraph_id: '_bk_edef90d4bf7c',
        old_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended.',
        new_string: '\u201cCode\u201d means the Internal Revenue Code of 1986, as amended, and the Treasury regulations promulgated thereunder.',
        instruction: 'Expand Code definition',
      });
      assertSuccess(result, 'replace');
      trackedPath = path.join(tmpDir, 'nvca-edited-tracked.docx');
    });

    await when('the document is saved with tracked-changes output', async () => {
      saveRes = await save(mgr, {
        session_id: sid,
        save_to_local_path: trackedPath,
        save_format: 'tracked',
        tracked_changes_author: 'NVCA Test',
      });
    });

    await then('the save succeeds', () => {
      assertSuccess(saveRes, 'save tracked');
    });
    await and('the tracked file contains w:ins and w:del revision markup with the inserted text', async () => {
      const { readDocumentXmlFromPath } = await import('../testing/docx_test_utils.js');
      const trackedXml = await readDocumentXmlFromPath(trackedPath);
      expect(trackedXml).toContain('w:ins');
      expect(trackedXml).toContain('w:del');
      expect(trackedXml).toContain('Treasury');
    });
  });
});
