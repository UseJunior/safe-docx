/**
 * LibreOffice probes for generated full-package documents.
 *
 * Deliberately separate from runLibreOfficeOracle: the oracle's contract is
 * "main XML string per accept/reject/identity job over a bare document.xml or
 * .odt", driven by an injected Basic macro because the resolve-all commands
 * are dispatch-only. These probes have a different contract — a complete
 * generated package goes in, and the *saved package* (or rendered PDF) comes
 * back out — and need no macro: `--convert-to` performs exactly the
 * load→save (or load→render) cycle that exposes recovery-dialog failures,
 * because a package LibreOffice cannot load cleanly produces no output.
 *
 * Local-only, like the oracle: callers skip when `resolveSoffice()` is null
 * (CI does not install LibreOffice; the structural checks are the
 * CI-enforceable proxy).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { resolveSoffice } from './libreoffice-oracle.js';

const execFileAsync = promisify(execFile);

export type DocxIdentityProbeResult = {
  /** The package as re-saved by LibreOffice's DOCX export filter. */
  savedPackage: Buffer;
};

export type DocxPdfProbeResult = {
  pdf: Buffer;
};

async function runConvert(input: Buffer, convertTo: string, outExt: string, soffice: string): Promise<Buffer> {
  const work = mkdtempSync(path.join(os.tmpdir(), 'sdx-gen-probe-'));
  try {
    const inDir = path.join(work, 'in');
    const outDir = path.join(work, 'out');
    const profile = path.join(work, 'profile');
    mkdirSync(inDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    mkdirSync(profile, { recursive: true });
    const inPath = path.join(inDir, 'probe.docx');
    writeFileSync(inPath, new Uint8Array(input));

    const args = [
      '--headless',
      '--norestore',
      '--nologo',
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--convert-to',
      convertTo,
      '--outdir',
      outDir,
      inPath,
    ];
    let diag = '';
    try {
      const r = await execFileAsync(soffice, args, { timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
      diag = String(r.stderr ?? '') || String(r.stdout ?? '');
    } catch (err) {
      const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
      diag = String(e.stderr ?? e.stdout ?? e.message ?? '');
    }

    const outPath = path.join(outDir, `probe.${outExt}`);
    if (!existsSync(outPath)) {
      throw new Error(
        `LibreOffice could not convert the generated package to ${outExt} — likely a load failure ` +
          `(the recovery-dialog class of bug).\nsoffice output:\n${diag.trim() || '(no output)'}`,
      );
    }
    return readFileSync(outPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Load→save a complete generated package through LibreOffice's DOCX filter.
 * Throws when LibreOffice cannot load the package (no output is produced).
 */
export async function probeDocxIdentity(
  generated: Buffer,
  soffice: string | null = resolveSoffice(),
): Promise<DocxIdentityProbeResult> {
  if (!soffice) throw new Error('probeDocxIdentity: no soffice binary (call resolveSoffice() and skip)');
  const savedPackage = await runConvert(generated, 'docx:MS Word 2007 XML', 'docx', soffice);
  return { savedPackage };
}

/** Render a generated package to PDF headlessly — the headless-renderer probe. */
export async function probeDocxToPdf(
  generated: Buffer,
  soffice: string | null = resolveSoffice(),
): Promise<DocxPdfProbeResult> {
  if (!soffice) throw new Error('probeDocxToPdf: no soffice binary (call resolveSoffice() and skip)');
  const pdf = await runConvert(generated, 'pdf', 'pdf', soffice);
  return { pdf };
}
