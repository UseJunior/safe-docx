import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PdfToolResult = { code: number; stdout: string; stderr: string };

/** The two external tools a plain PDF render needs, injectable for tests. */
export type PdfRenderTools = {
  resolve(name: 'soffice' | 'pdftotext'): string | null;
  run(command: string, args: string[]): Promise<PdfToolResult>;
};

/**
 * Locate LibreOffice and pdftotext in their usual install paths
 * (`SAFE_DOCX_SOFFICE_BIN` overrides soffice) and run them with a 60-second
 * SIGKILL timeout and a 16 MiB output buffer.
 */
export function defaultPdfRenderTools(): PdfRenderTools {
  const candidates: Record<'soffice' | 'pdftotext', string[]> = {
    soffice: [process.env.SAFE_DOCX_SOFFICE_BIN ?? '', '/opt/homebrew/bin/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'],
    pdftotext: ['/opt/homebrew/bin/pdftotext', '/usr/bin/pdftotext', '/usr/local/bin/pdftotext'],
  };
  return {
    resolve(name) {
      return candidates[name].find((candidate) => candidate.length > 0 && existsSync(candidate)) ?? null;
    },
    async run(command, args) {
      try {
        const result = await execFileAsync(command, args, { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
        return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
      } catch (error) {
        const failure = error as { code?: number; stdout?: unknown; stderr?: unknown; message?: string };
        // A spawn failure (ENOENT, EACCES) has empty stderr; keep the error message so the reason is not blank.
        return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr || failure.message || '') };
      }
    },
  };
}
