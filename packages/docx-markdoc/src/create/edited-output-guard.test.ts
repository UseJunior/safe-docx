import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import type { PdfRenderTools } from '../pdf/tools.js';
import { parseCreateCliArgs, runCreateCommand } from './cli-create.js';

const TEST_FEATURE = 'add-markdoc-document-creation';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1186 protect edited create outputs',
  severity: 'critical',
});

const noPdf: PdfRenderTools = { resolve: () => null, run: async () => ({ code: 1, stdout: '', stderr: '' }) };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** Stand-in for a DOCX someone edited in Word after the build: any bytes the last build did not certify. */
const EDITED = Buffer.from('PK edited by a person after the build');

async function setup() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sdx-create-edited-')));
  const source = path.join(dir, 'consent.mdoc');
  await writeFile(source, '# CONSENT\n\nThe Board approves the plan.');
  const out = path.join(dir, 'out');
  await runCreateCommand([source, out], { renderTools: noPdf });
  const docx = path.join(out, 'consent.docx');
  const certificate = path.join(out, 'consent.verification.json');
  /** Every file in the output directory, hidden ones included, as base64. */
  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(out)).sort().map(async (name) => [name, (await readFile(path.join(out, name))).toString('base64')] as const)));
  const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: Error & { code?: string }) => error);
  return { dir, source, out, docx, certificate, snapshot, failure };
}

describe('Traceability: create never silently replaces an edited DOCX', () => {
  test.openspec('[SDX-MDOC-CREATE-14] --replace rebuilds only the DOCX the last build certified')(
    'Scenario: --replace rebuilds only the DOCX the last build certified',
    async () => {
      const { dir, source, out, docx, certificate, snapshot, failure } = await setup();
      try {
        // Unchanged since the last build: a normal rebuild.
        await writeFile(source, '# CONSENT\n\nThe Board approves the amended plan.');
        const rebuilt = await runCreateCommand([source, out, '--replace'], { renderTools: noPdf });
        expect(rebuilt.overwritten).toBeUndefined();
        expect(JSON.parse(await readFile(certificate, 'utf8')).docxSha256).toBe(sha256(await readFile(docx)));

        // Edited after the build: refused, and nothing in the directory changes.
        const certifiedBytes = await readFile(docx);
        await writeFile(docx, EDITED);
        const before = await snapshot();
        await writeFile(source, '# CONSENT\n\nThe Board approves the restated plan.');
        const edited = await failure(runCreateCommand([source, out, '--replace'], { renderTools: noPdf }));
        expect(edited).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        expect(edited!.message).toMatch(/SHA-256 differs.*--dangerously-overwrite-edited-docx/);
        expect(await snapshot()).toEqual(before);
        // Without --replace the old refusal still comes first.
        expect(await failure(runCreateCommand([source, out], { renderTools: noPdf }))).toMatchObject({ code: 'CREATION_OUTPUT_EXISTS' });

        // A missing, unreadable, failed or foreign certificate cannot vouch for the DOCX.
        await writeFile(docx, certifiedBytes);
        const good = await readFile(certificate, 'utf8');
        const certified = JSON.parse(good);
        expect(certified.docxSha256).toBe(sha256(certifiedBytes));
        for (const [label, record] of [
          ['missing', null],
          ['unreadable', '{ not json'],
          ['failed', JSON.stringify({ ...certified, passed: false })],
          ['foreign', JSON.stringify({ ...certified, docxSha256: 'f'.repeat(64) })],
          ['no fingerprint', JSON.stringify({ ...certified, docxSha256: undefined })],
        ] as const) {
          // The DOCX is the certified one, so only the record decides.
          if (record === null) await rm(certificate);
          else await writeFile(certificate, record);
          const refused = await failure(runCreateCommand([source, out, '--replace'], { renderTools: noPdf }));
          expect(refused, label).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
          expect(refused!.message, label).toMatch(label === 'foreign' ? /SHA-256 differs/ : /cannot be shown to be unedited/);
          await writeFile(certificate, good);
          expect(await readFile(docx)).toEqual(certifiedBytes);
        }
        // With the record back, the same DOCX rebuilds normally.
        expect((await runCreateCommand([source, out, '--replace'], { renderTools: noPdf })).overwritten).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test.openspec('[SDX-MDOC-CREATE-14] --dangerously-overwrite-edited-docx keeps the exact edited bytes')(
    'Scenario: --dangerously-overwrite-edited-docx keeps the exact edited bytes',
    async () => {
      const { dir, source, out, docx, certificate, failure, snapshot } = await setup();
      try {
        expect(parseCreateCliArgs(['a.mdoc', 'out', '--dangerously-overwrite-edited-docx'])).toMatchObject({ replace: true, overwriteEditedDocx: true });
        await writeFile(docx, EDITED);

        // A failure while publishing rolls back: the edited DOCX is back in place, byte for byte.
        const before = await snapshot();
        let links = 0;
        const failingLink = async (from: string, to: string) => {
          links += 1;
          if (links === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          await link(from, to);
        };
        expect(await failure(runCreateCommand([source, out, '--dangerously-overwrite-edited-docx'], { renderTools: noPdf, fileOps: { link: failingLink } }))).toMatchObject({ message: 'disk full' });
        expect(await snapshot()).toEqual(before);

        // Forced: the new build is published and the edited bytes are kept, named in the result.
        const forced = await runCreateCommand([source, out, '--dangerously-overwrite-edited-docx'], { renderTools: noPdf });
        expect(forced.overwritten).toMatchObject({ sha256: sha256(EDITED), reason: expect.stringMatching(/SHA-256 differs/) });
        expect(path.dirname(forced.overwritten!.docx)).toMatch(/\/\.consent\.create-overwritten-[0-9a-f-]+$/);
        expect(Buffer.compare(await readFile(forced.overwritten!.docx), EDITED)).toBe(0);
        expect(forced.summary).toContain(`WARNING: overwrote an edited consent.docx`);
        expect(forced.summary).toContain(forced.overwritten!.docx);
        expect(JSON.parse(await readFile(certificate, 'utf8')).docxSha256).toBe(sha256(await readFile(docx)));
        // The new build is certified, so the next --replace is a normal rebuild.
        expect((await runCreateCommand([source, out, '--replace'], { renderTools: noPdf })).overwritten).toBeUndefined();

        // Forcing over the certified DOCX keeps nothing: there is nothing unique to keep.
        const again = await runCreateCommand([source, out, '--dangerously-overwrite-edited-docx'], { renderTools: noPdf });
        expect(again.overwritten).toBeUndefined();
        expect((await readdir(out)).filter((name) => name.startsWith('.consent.create-overwritten-'))).toHaveLength(1);

        // If the kept copy cannot be moved out, the staging directory holding it is kept and named.
        await writeFile(docx, EDITED);
        const failingKeep = async (from: string, to: string) => {
          if (to.includes('.create-overwritten-')) throw Object.assign(new Error('read-only'), { code: 'EROFS' });
          await rename(from, to);
        };
        const kept = await failure(runCreateCommand([source, out, '--dangerously-overwrite-edited-docx'], { renderTools: noPdf, fileOps: { rename: failingKeep } }));
        expect(kept).toMatchObject({ code: 'CREATION_OVERWRITE_BACKUP_FAILED' });
        const keptPath = (kept as unknown as { details: { kept: string } }).details.kept;
        expect(kept!.message).toContain(keptPath);
        expect(Buffer.compare(await readFile(keptPath), EDITED)).toBe(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test.openspec('[SDX-MDOC-CREATE-14] an edit made during the build is caught at publication')(
    'Scenario: an edit made during the build is caught at publication',
    async () => {
      const { dir, source, out, docx, failure, snapshot } = await setup();
      try {
        // The DOCX is certified when checked, then edited before publication moves it aside.
        const editingRename = async (from: string, to: string) => {
          if (from === docx) await writeFile(docx, EDITED);
          await rename(from, to);
        };
        const raced = await failure(runCreateCommand([source, out, '--replace'], { renderTools: noPdf, fileOps: { rename: editingRename } }));
        expect(raced).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        expect(raced!.message).toMatch(/during the build/);
        // Rolled back: the edited file is in place and every other output is unchanged.
        expect(Buffer.compare(await readFile(docx), EDITED)).toBe(0);
        const afterRace = await snapshot();

        // Forced, the same race keeps the bytes that were actually moved aside.
        const certifiedNow = async () => {
          await rm(out, { recursive: true });
          await runCreateCommand([source, out], { renderTools: noPdf });
        };
        await certifiedNow();
        const forced = await runCreateCommand([source, out, '--dangerously-overwrite-edited-docx'], { renderTools: noPdf, fileOps: { rename: editingRename } });
        expect(forced.overwritten).toMatchObject({ sha256: sha256(EDITED), reason: 'it changed during the build' });
        expect(Buffer.compare(await readFile(forced.overwritten!.docx), EDITED)).toBe(0);

        // A DOCX that appears during a build, when there was none to certify, is refused under --replace.
        await rm(out, { recursive: true });
        await mkdir(out);
        await writeFile(path.join(out, 'consent.txt'), 'stale mirror');
        const appearing: PdfRenderTools = {
          resolve: (name) => `/fake/${name}`,
          async run(command, args) {
            if (command.endsWith('soffice')) {
              await writeFile(docx, EDITED);
              const outdir = args[args.indexOf('--outdir') + 1]!;
              await mkdir(outdir, { recursive: true });
              await writeFile(path.join(outdir, 'input.pdf'), '%PDF-fake');
              return { code: 0, stdout: '', stderr: '' };
            }
            return { code: 0, stdout: 'CONSENT\nThe Board approves the plan.\n\f', stderr: '' };
          },
        };
        const appeared = await failure(runCreateCommand([source, out, '--replace'], { renderTools: appearing }));
        expect(appeared).toMatchObject({ code: 'CREATION_OUTPUT_EDITED' });
        expect(Buffer.compare(await readFile(docx), EDITED)).toBe(0);
        expect(await readFile(path.join(out, 'consent.txt'), 'utf8')).toBe('stale mirror');
        expect(afterRace).toHaveProperty(['consent.docx'], EDITED.toString('base64'));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
