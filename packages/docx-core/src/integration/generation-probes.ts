/**
 * LibreOffice probes for generated full-package documents.
 *
 * Deliberately separate from runLibreOfficeOracle: the oracle's contract is
 * "main XML string per accept/reject/identity job over a bare document.xml or
 * .odt", driven by an injected Basic macro because the resolve-all commands
 * are dispatch-only. These probes have a different contract — a complete
 * generated package goes in, and the *saved package* (or rendered PDF) comes
 * back out — and need no macro: `--convert-to` performs exactly the
 * load→save (or load→render) cycle that exposes recovery-dialog failures.
 *
 * A probe's pass condition is a statement about the artifact, never about a
 * file existing at a path: the run must not have failed, and what it produced
 * must be readable as the thing it claims to be. Do not weaken these back to
 * `existsSync` — a converter that fails *after* writing a partial file
 * satisfies that and nothing else (issue #796).
 *
 * The exit status is necessary but not sufficient, and neither is the output
 * check. Measured on LibreOffice 25.8 (2026-08): an unloadable source exits
 * **0**, writes `Error: source file could not be loaded` to stderr, and
 * produces no output file — so the status check added for #796 does not
 * subsume the file checks, and the file checks do not subsume it.
 *
 * Local-only, like the oracle: callers skip when `resolveSoffice()` is null
 * (CI does not install LibreOffice; the structural checks are the
 * CI-enforceable proxy). `generation-probes.test.ts` drives the probes against
 * a stub converter instead, so the failure paths are covered in CI.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseXml } from '../primitives/xml.js';
import { readZipText } from '../primitives/zip.js';
import { resolveSoffice } from './libreoffice-oracle.js';

const execFileAsync = promisify(execFile);

export type ConvertDiagnostics = {
  /** Process exit code, or null when the run was terminated by a signal. */
  readonly exitCode: number | null;
  /** Terminating signal, when the run was killed (the 45s timeout ⇒ SIGKILL). */
  readonly signal: string | null;
  /** Captured soffice stderr (falling back to stdout), kept on every path. */
  readonly output: string;
};

export type DocxIdentityProbeResult = {
  /** The package as re-saved by LibreOffice's DOCX export filter. */
  savedPackage: Buffer;
  /** Exit status and captured output of the converting run. */
  diagnostics: ConvertDiagnostics;
};

export type DocxPdfProbeResult = {
  pdf: Buffer;
  /** Exit status and captured output of the converting run. */
  diagnostics: ConvertDiagnostics;
};

/**
 * Raised when the converter did not produce a usable artifact.
 *
 * Carries the exit status and the captured output on *every* rejection path —
 * including the path where an output file exists despite a failed run, which
 * `runConvert` previously reported as a success.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/796
 */
export class ConvertProbeError extends Error {
  readonly diagnostics: ConvertDiagnostics;

  constructor(message: string, diagnostics: ConvertDiagnostics) {
    const status =
      diagnostics.signal !== null
        ? `killed by ${diagnostics.signal}`
        : `exit ${diagnostics.exitCode ?? 'unknown'}`;
    super(
      `${message}\nsoffice status: ${status}\nsoffice output:\n` +
        `${diagnostics.output.trim() || '(no output)'}`,
    );
    this.name = 'ConvertProbeError';
    this.diagnostics = diagnostics;
  }
}

async function runConvert(
  input: Buffer,
  convertTo: string,
  outExt: string,
  soffice: string,
): Promise<{ output: Buffer; diagnostics: ConvertDiagnostics }> {
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
    let diagnostics: ConvertDiagnostics;
    try {
      const r = await execFileAsync(soffice, args, { timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
      diagnostics = {
        exitCode: 0,
        signal: null,
        output: String(r.stderr ?? '') || String(r.stdout ?? ''),
      };
    } catch (err) {
      const e = err as {
        stdout?: unknown;
        stderr?: unknown;
        message?: string;
        code?: unknown;
        signal?: unknown;
      };
      diagnostics = {
        // execFile surfaces a signal death with no numeric code, and a
        // spawn failure (ENOENT) with a string code — neither is an exit
        // status, so both land as null and the signal/status check below
        // still rejects because exitCode !== 0.
        exitCode: typeof e.code === 'number' ? e.code : null,
        signal: typeof e.signal === 'string' ? e.signal : null,
        output: String(e.stderr ?? e.stdout ?? e.message ?? ''),
      };
    }

    // Fail on the converter's own verdict FIRST, so a failed run that still
    // dropped a partial file at the output path cannot be read back as a
    // success. Note that LibreOffice does NOT always signal a load failure
    // this way (observed: exit 0 with "Error: source file could not be
    // loaded" on stderr and no output at all), which is why the file checks
    // below remain and are not replaced by the status check.
    if (diagnostics.exitCode !== 0 || diagnostics.signal !== null) {
      throw new ConvertProbeError(
        `LibreOffice failed while converting the generated package to ${outExt}.`,
        diagnostics,
      );
    }

    const outPath = path.join(outDir, `probe.${outExt}`);
    if (!existsSync(outPath)) {
      throw new ConvertProbeError(
        `LibreOffice could not convert the generated package to ${outExt} — likely a load failure ` +
          `(the recovery-dialog class of bug).`,
        diagnostics,
      );
    }
    const output = readFileSync(outPath);
    if (output.length === 0) {
      throw new ConvertProbeError(
        `LibreOffice produced an empty ${outExt} at the output path.`,
        diagnostics,
      );
    }
    return { output, diagnostics };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const OFFICE_DOCUMENT_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * The main-document part named by the package-level officeDocument
 * relationship, normalized to a zip entry name.
 *
 * OPC selects the main part by relationship, not by a fixed path, so this
 * resolves `_rels/.rels` rather than assuming `word/document.xml`.
 */
function mainDocumentPartPath(packageRelsXml: string): string | undefined {
  const relationships = parseXml(packageRelsXml).getElementsByTagName('Relationship');
  for (const relationship of Array.from(relationships)) {
    if (relationship.getAttribute('Type') !== OFFICE_DOCUMENT_RELATIONSHIP) continue;
    const target = relationship.getAttribute('Target');
    if (!target) continue;
    // Package-relative targets may be written with a leading slash.
    return target.replace(/^\/+/, '');
  }
  return undefined;
}

/**
 * Load→save a complete generated package through LibreOffice's DOCX filter.
 *
 * Throws when the converter fails, when it produces no output, or when what it
 * produced is not a readable OPC package — the probe's pass condition is that
 * the re-saved artifact IS a package, not that a file appeared at a path.
 */
export async function probeDocxIdentity(
  generated: Buffer,
  soffice: string | null = resolveSoffice(),
): Promise<DocxIdentityProbeResult> {
  if (!soffice) throw new Error('probeDocxIdentity: no soffice binary (call resolveSoffice() and skip)');
  const { output: savedPackage, diagnostics } = await runConvert(
    generated,
    'docx:MS Word 2007 XML',
    'docx',
    soffice,
  );
  let packageRels: string | null;
  try {
    packageRels = await readZipText(savedPackage, '_rels/.rels');
  } catch (err) {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${savedPackage.length}-byte .docx that is not a readable ZIP ` +
        `(${(err as Error).message}).`,
      diagnostics,
    );
  }
  if (packageRels === null) {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${savedPackage.length}-byte .docx with no _rels/.rels part.`,
      diagnostics,
    );
  }
  // The main part is whatever the package-level officeDocument relationship
  // points at. `word/document.xml` is only a convention — resolving the
  // relationship is what makes this a package check rather than a guess about
  // one producer's layout.
  const mainPartPath = mainDocumentPartPath(packageRels);
  if (mainPartPath === undefined) {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${savedPackage.length}-byte .docx whose _rels/.rels declares no ` +
        `officeDocument relationship.`,
      diagnostics,
    );
  }
  const mainPart = await readZipText(savedPackage, mainPartPath);
  if (mainPart === null) {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${savedPackage.length}-byte .docx whose officeDocument relationship ` +
        `targets ${mainPartPath}, which is not in the package.`,
      diagnostics,
    );
  }
  return { savedPackage, diagnostics };
}

/**
 * Render a generated package to PDF headlessly — the headless-renderer probe.
 *
 * Throws when the converter fails or when the rendered bytes are not a
 * complete PDF. The `%PDF-` header alone is a magic-byte check that a
 * truncated render passes, so the trailing `%%EOF` marker is checked too.
 */
export async function probeDocxToPdf(
  generated: Buffer,
  soffice: string | null = resolveSoffice(),
): Promise<DocxPdfProbeResult> {
  if (!soffice) throw new Error('probeDocxToPdf: no soffice binary (call resolveSoffice() and skip)');
  const { output: pdf, diagnostics } = await runConvert(generated, 'pdf', 'pdf', soffice);
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${pdf.length}-byte .pdf without a %PDF- header.`,
      diagnostics,
    );
  }
  // The trailer lives at the end of the file, possibly followed by whitespace.
  if (!pdf.subarray(-1024).toString('latin1').includes('%%EOF')) {
    throw new ConvertProbeError(
      `LibreOffice wrote a ${pdf.length}-byte .pdf with no %%EOF trailer — the render is truncated.`,
      diagnostics,
    );
  }
  return { pdf, diagnostics };
}
