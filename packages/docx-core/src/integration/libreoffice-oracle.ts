/**
 * LibreOffice accept/reject oracle — a committed, reproducible reference voter.
 *
 * Drives LibreOffice headless as a track-changes accept/reject implementation so the
 * production engine's paragraph-collapse behavior (the G3/G4/G5 differential cases) can be
 * validated against a real word processor, not just Lean↔TS self-consistency. LibreOffice is
 * the native engine for the .uno:AcceptAllTrackedChanges / .uno:RejectAllTrackedChanges
 * dispatches, so its paragraph-structure output is authoritative ground truth for the
 * mark-based rule (an untracked paragraph mark is kept on accept/reject; a PPR-INS/PPR-DEL mark
 * is dropped).
 *
 * Mechanism (macOS-portable; also works on Linux): pyuno from a terminal is blocked on macOS by
 * Launch Constraints, so this injects a Basic macro into a throwaway user profile and invokes it
 * with a bare `macro:///` URL. The order matters — a fresh profile regenerates the Standard Basic
 * library on first launch, clobbering any hand-placed Module1.xba — so we (1) init the profile via
 * a throwaway convert, (2) THEN overwrite Module1.xba, (3) THEN run the macro. See
 * reference_libreoffice_macos_oracle.
 *
 * This module is gated by callers: when `resolveSoffice()` returns null the oracle is skipped.
 * CI does not install LibreOffice, so the oracle voter is a local developer check.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createZipBuffer, readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';

const execFileAsync = promisify(execFile);
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run soffice, capturing stdout/stderr; never throws (the macro terminates the desktop, so a
 *  nonzero exit is expected). */
async function runSoffice(
  soffice: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync(soffice, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
    return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') };
  }
}

/**
 * LibreOffice's single-instance model forwards a new `soffice` invocation to an existing instance
 * that shares the same UserInstallation — so the init-convert process MUST be fully gone before the
 * macro launch, or the `macro:///` command is delivered to the dying init instance (which has no
 * Module1 yet) and never runs. The instance lock is `<profile>/.lock`. LibreOffice often leaves a
 * STALE lock after `--convert-to` exits, so we wait a short bounded window for it to self-clear and
 * then remove it unconditionally; the macro launch's own retry backstops a slow init exit.
 */
async function settleProfile(profile: string, timeoutMs = 1_500): Promise<void> {
  const lock = path.join(profile, '.lock');
  const deadline = Date.now() + timeoutMs;
  while (existsSync(lock) && Date.now() < deadline) await sleep(150);
  if (existsSync(lock)) {
    try { rmSync(lock, { force: true }); } catch { /* best effort — fresh launch will relock */ }
  }
}

/** Resolve a LibreOffice binary, or null if none is available (callers skip the oracle). */
export function resolveSoffice(): string | null {
  const candidates = [
    process.env.SAFE_DOCX_SOFFICE_BIN,
    process.env.ODF_SOFFICE_BIN,
    '/opt/homebrew/bin/soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

/** Pack a bare `word/document.xml` string into a minimal valid .docx package. */
export async function packMinimalDocx(documentXml: string): Promise<Buffer> {
  return createZipBuffer({
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': RELS,
    'word/_rels/document.xml.rels': DOC_RELS,
    'word/document.xml': documentXml,
  });
}

/** Read `word/document.xml` back out of a .docx package. */
export async function extractDocumentXml(docx: Buffer): Promise<string> {
  const xml = await readZipText(docx, 'word/document.xml');
  if (xml == null) throw new Error('word/document.xml not found in oracle output');
  return xml;
}

const SCRIPT_XLC = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd">
<library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink">
 <library:library library:name="Standard" xlink:href="$(USER)/basic/Standard/script.xlb/" xlink:type="simple" library:link="false"/>
</library:libraries>`;
const SCRIPT_XLB = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">
 <library:element library:name="Module1"/>
</library:library>`;
const REGMOD = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>0</value></prop></item>
 <item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
</oor:items>`;

/** The Basic macro: load each doc Hidden, dispatch accept/reject-all (or, for `identity`,
 *  dispatch nothing at all), save with the job's filter. */
function module1Xba(jobsPath: string, markerPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">
Sub RunOracle
  Dim iFile As Integer, sLine As String, parts() As String, m As Integer
  m = FreeFile : Open "${markerPath}" For Output As #m : Print #m, "started" : Close #m
  iFile = FreeFile
  Open "${jobsPath}" For Input As #iFile
  Do While Not EOF(iFile)
    Line Input #iFile, sLine
    If Len(Trim(sLine)) &gt; 0 Then
      parts = Split(sLine, "|")
      ProcessOne(parts(0), ConvertToURL(parts(1)), ConvertToURL(parts(2)), parts(3))
    End If
  Loop
  Close #iFile
  StarDesktop.terminate()
End Sub

Sub ProcessOne(op As String, inUrl As String, outUrl As String, filterName As String)
  Dim oDoc As Object, oFrame As Object, oDisp As Object
  Dim loadArgs(0) As New com.sun.star.beans.PropertyValue
  loadArgs(0).Name = "Hidden" : loadArgs(0).Value = True
  oDoc = StarDesktop.loadComponentFromURL(inUrl, "_blank", 0, loadArgs())
  oFrame = oDoc.getCurrentController().getFrame()
  oDisp = createUnoService("com.sun.star.frame.DispatchHelper")
  Dim noArgs()
  If op = "accept" Then
    oDisp.executeDispatch(oFrame, ".uno:AcceptAllTrackedChanges", "", 0, noArgs())
  ElseIf op = "reject" Then
    oDisp.executeDispatch(oFrame, ".uno:RejectAllTrackedChanges", "", 0, noArgs())
  End If
  ' op = "identity": no dispatch — a plain load-&gt;save, exposing LibreOffice's own DOCX
  ' import/export of UNRESOLVED tracked changes (the oracle trust-boundary check).
  Dim saveArgs(0) As New com.sun.star.beans.PropertyValue
  saveArgs(0).Name = "FilterName" : saveArgs(0).Value = filterName
  oDoc.storeToURL(outUrl, saveArgs())
  oDoc.close(False)
End Sub
</script:module>`;
}

/**
 * `accept` / `reject` dispatch the corresponding resolve-all command before saving — the oracle's
 * normal voting mode. `identity` loads and saves WITHOUT any dispatch, so unresolved tracked
 * changes flow through LibreOffice's import/export: it exists to characterize the oracle's
 * trust boundary (LibreOffice's save round-trip mangles some unresolved revision shapes — see
 * libreoffice-oracle-trust-boundary.test.ts), NOT to vote on engine behavior.
 *
 * DOCX jobs carry a bare `word/document.xml` (packed into a minimal package and read back out);
 * ODT jobs carry a complete `.odt` package buffer (ODF packaging — mimetype-first STORED — is
 * the caller's concern) and return its post-op `content.xml`.
 *
 * CONVERSION jobs (`docx` + `saveAs: 'odt'`) carry a complete `.docx` package buffer and save
 * through LibreOffice's `writer8` filter, returning the converted `content.xml` — the reference
 * path for differential-testing odf-core's native DOCX→ODT converter (issue #331).
 */
type OracleOp = 'accept' | 'reject' | 'identity';
export type OracleJob =
  | { op: OracleOp; documentXml: string }
  | { op: OracleOp; odt: Buffer }
  | { op: OracleOp; docx: Buffer; saveAs: 'odt' };

function isOdtJob(job: OracleJob): job is { op: OracleOp; odt: Buffer } {
  return 'odt' in job;
}

function isConvertJob(job: OracleJob): job is { op: OracleOp; docx: Buffer; saveAs: 'odt' } {
  return 'docx' in job;
}

/**
 * Run LibreOffice over a batch of jobs in ONE headless launch and return each job's resulting
 * main XML part — `word/document.xml` for DOCX jobs, `content.xml` for ODT jobs. Throws if the
 * binary is missing or the macro did not run.
 */
export async function runLibreOfficeOracle(jobs: OracleJob[], soffice = resolveSoffice()): Promise<string[]> {
  if (!soffice) throw new Error('runLibreOfficeOracle: no soffice binary (call resolveSoffice() and skip)');
  if (jobs.length === 0) return [];

  const work = mkdtempSync(path.join(os.tmpdir(), 'lo-oracle-'));
  const profile = path.join(work, 'profile');
  const userDir = path.join(profile, 'user');
  const basicDir = path.join(userDir, 'basic', 'Standard');
  const inDir = path.join(work, 'in');
  const outDir = path.join(work, 'out');
  const marker = path.join(work, 'macro_ran.txt');
  const jobsPath = path.join(work, 'jobs.txt');
  const profileUrl = pathToFileURL(profile).href;
  let keepWork = false;

  try {
    for (const d of [userDir, basicDir, inDir, outDir]) mkdirSync(d, { recursive: true });

    // Write each job's input package and build the jobs file (op|inPath|outPath|filter).
    const outPaths: string[] = [];
    const jobLines: string[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!;
      const inExt = isOdtJob(job) ? 'odt' : 'docx';
      const outExt = isOdtJob(job) || isConvertJob(job) ? 'odt' : 'docx';
      const filter = isOdtJob(job) || isConvertJob(job) ? 'writer8' : 'MS Word 2007 XML';
      const inPath = path.join(inDir, `job${i}.${inExt}`);
      const outPath = path.join(outDir, `job${i}.${outExt}`);
      writeFileSync(
        inPath,
        isOdtJob(job)
          ? new Uint8Array(job.odt)
          : isConvertJob(job)
            ? new Uint8Array(job.docx)
            : new Uint8Array(await packMinimalDocx(job.documentXml)),
      );
      outPaths.push(outPath);
      jobLines.push(`${job.op}|${inPath}|${outPath}|${filter}`);
    }
    writeFileSync(jobsPath, jobLines.join('\n') + '\n');

    // Macro security level 0 so the Standard-library macro runs headless.
    writeFileSync(path.join(userDir, 'registrymodifications.xcu'), REGMOD);

    const baseArgs = ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${profileUrl}`];
    const diag: string[] = [];

    // (1) INIT the profile: a throwaway convert makes soffice populate user/basic/Standard
    // (which would otherwise clobber a pre-placed Module1.xba on first real launch).
    const init = await runSoffice(
      soffice,
      [...baseArgs, '--convert-to', 'txt', '--outdir', path.join(work, 'init'), path.join(inDir, 'job0.docx')],
      20_000,
    );
    diag.push(`[init] ${(init.stderr || init.stdout || '(no output)').trim()}`);

    // (2) Overwrite the Basic library with our macro.
    mkdirSync(basicDir, { recursive: true });
    writeFileSync(path.join(userDir, 'basic', 'script.xlc'), SCRIPT_XLC);
    writeFileSync(path.join(basicDir, 'script.xlb'), SCRIPT_XLB);
    writeFileSync(path.join(basicDir, 'Module1.xba'), module1Xba(jobsPath, marker));

    // (3) Run the macro via a bare macro:/// URL — but only once the init instance has fully
    // released the profile, so LibreOffice's single-instance model can't forward our macro command
    // to the dying init process. Retry once: the first macro launch can still race a slow init exit.
    for (let attempt = 1; attempt <= 2 && !existsSync(marker); attempt++) {
      await settleProfile(profile);
      const run = await runSoffice(soffice, [...baseArgs, 'macro:///Standard.Module1.RunOracle'], 45_000);
      diag.push(`[macro attempt ${attempt}] ${(run.stderr || run.stdout || '(no output)').trim()}`);
      if (!existsSync(marker)) await sleep(400);
    }

    if (!existsSync(marker)) {
      keepWork = Boolean(process.env.SAFE_DOCX_ORACLE_DEBUG);
      throw new Error(
        'LibreOffice oracle macro did not run (no marker file) after 2 attempts.\nsoffice output:\n' +
          diag.join('\n') +
          (keepWork ? `\n(profile kept for debugging at ${work})` : ' (set SAFE_DOCX_ORACLE_DEBUG=1 to keep the profile)'),
      );
    }
    return Promise.all(outPaths.map(async (p, i) => {
      if (!existsSync(p)) throw new Error(`LibreOffice oracle produced no output for ${path.basename(p)}`);
      if (isOdtJob(jobs[i]!) || isConvertJob(jobs[i]!)) {
        const contentXml = await readZipText(readFileSync(p), 'content.xml');
        if (contentXml == null) throw new Error(`content.xml not found in oracle output ${path.basename(p)}`);
        return contentXml;
      }
      return extractDocumentXml(readFileSync(p));
    }));
  } finally {
    if (!keepWork) rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Structural projection of a `word/document.xml`: one entry per top-level body paragraph,
 * recording whether it carries visible text (a non-whitespace `w:t` descendant). This captures
 * the paragraph-collapse claim the oracle is authoritative for — how many paragraphs survive and
 * which collapsed to empty — without depending on revision-markup or formatting details (which
 * LibreOffice rewrites). `[]`-length is the paragraph count.
 */
export function paragraphShape(documentXml: string): boolean[] {
  const doc = parseXml(documentXml);
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0) ?? doc.documentElement;
  if (!body) return [];
  const shape: boolean[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i]!;
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.namespaceURI !== W_NS || el.localName !== 'p') continue; // skip w:sectPr etc.
    const texts = el.getElementsByTagNameNS(W_NS, 't');
    let hasText = false;
    for (let j = 0; j < texts.length; j++) {
      if ((texts.item(j)!.textContent ?? '').trim().length > 0) { hasText = true; break; }
    }
    shape.push(hasText);
  }
  return shape;
}
