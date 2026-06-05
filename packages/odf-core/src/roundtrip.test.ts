import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, it, expect } from 'vitest';

import { OdfArchive } from './shared/odf/OdfArchive.js';
import { OdfDocument } from './document.js';

const execFileAsync = promisify(execFile);
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/sample.odt');

/** Resolve a LibreOffice binary, or null if none is available (test skips). */
function resolveSoffice(): string | null {
  const candidates = [
    process.env.ODF_SOFFICE_BIN,
    '/opt/homebrew/bin/soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? null;
}

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

    const archive = await OdfArchive.load(readFileSync(FIXTURE));
    const doc = OdfDocument.fromContentXml(await archive.getContentXml());
    const target = doc.getParagraphs().find((p) => p.text.includes('quick brown fox'))!;
    doc.replaceTextById(target.id, 'quick brown fox', 'slow grey cat');
    archive.setContentXml(doc.toXml());

    const dir = mkdtempSync(path.join(os.tmpdir(), 'odf-rt-'));
    const odtPath = path.join(dir, 'edited.odt');
    writeFileSync(odtPath, await archive.save());

    // Convert to text headlessly; success + correct extracted text proves LibreOffice
    // accepted our package and read the edit.
    await execFileAsync(soffice, [
      '-env:UserInstallation=file://' + path.join(dir, 'lo-profile'),
      '--headless',
      '--convert-to',
      'txt:Text',
      '--outdir',
      dir,
      odtPath,
    ]);

    const txt = readdirSync(dir).find((f) => f.endsWith('.txt'));
    expect(txt, 'soffice should produce a .txt (it accepted the .odt)').toBeTruthy();
    const extracted = readFileSync(path.join(dir, txt!), 'utf8');
    expect(extracted).toContain('slow grey cat');
  }, 60_000);
});
