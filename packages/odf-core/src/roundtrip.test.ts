import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { probeSofficeUsable, resolveSoffice, runLibreOfficeOracle } from '@usejunior/docx-core';

import { OdfArchive } from './shared/odf/OdfArchive.js';
import { OdfDocument } from './document.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/sample.odt');

describe('ODF round trip', () => {
  it('[ORTS-01] open → replace_text → save → reopen yields the edited text, others unchanged', async () => {
    const archive = await OdfArchive.load(readFileSync(FIXTURE));
    const doc = OdfDocument.fromContentXml(await archive.getContentXml());

    const before = doc.getParagraphs();
    const target = before.find((p) => p.text.includes('quick brown fox'));
    expect(target, 'fixture should contain the fox paragraph').toBeTruthy();

    const res = doc.replaceTextById(target!.id, 'quick brown fox', 'slow grey cat');
    expect(res.ok).toBe(true);

    archive.setContentXml(doc.toXml());
    const saved = await archive.save();

    // Reopen
    const reopened = OdfDocument.fromContentXml(await (await OdfArchive.load(saved)).getContentXml());
    const after = reopened.getParagraphs();
    expect(after.find((p) => p.id === target!.id)!.text).toContain('slow grey cat');

    // Every other paragraph is unchanged.
    for (const p of before) {
      if (p.id === target!.id) continue;
      expect(after.find((q) => q.id === p.id)!.text).toBe(p.text);
    }

    // content.xml remains well-formed: paragraph count is preserved after the round trip.
    expect(after.length).toBe(before.length);
  });

  it('[ORTS-02] saved .odt opens in LibreOffice (skipped when soffice is unavailable)', async () => {
    const soffice = resolveSoffice();
    if (!soffice) {
      console.warn('[ORTS-02] soffice not found — skipping LibreOffice open smoke (set ODF_SOFFICE_BIN to enable).');
      return;
    }
    if (!(await probeSofficeUsable(soffice))) {
      console.warn('[ORTS-02] soffice present but unusable (aborts on launch) — skipping LibreOffice open smoke.');
      return;
    }

    const archive = await OdfArchive.load(readFileSync(FIXTURE));
    const doc = OdfDocument.fromContentXml(await archive.getContentXml());
    const target = doc.getParagraphs().find((p) => p.text.includes('quick brown fox'))!;
    doc.replaceTextById(target.id, 'quick brown fox', 'slow grey cat');
    archive.setContentXml(doc.toXml());

    // Load and re-save through LibreOffice (an `identity` oracle job: no dispatch). A saved
    // content.xml carrying the edit proves LibreOffice accepted our package and read the edit.
    // Going through the oracle keeps this launch under docx-core's cross-process soffice lock
    // instead of overlapping other workers' LibreOffice runs (#1037).
    const [contentXml] = await runLibreOfficeOracle([{ op: 'identity', odt: await archive.save() }], soffice);
    expect(contentXml, 'LibreOffice should load and re-save the edited .odt').toBeTruthy();
    expect(contentXml).toContain('slow grey cat');
  }, 60_000);
});
