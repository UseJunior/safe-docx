import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import { auditSectPr, buildSyntheticDocx } from '@usejunior/docx-core';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { formatCliError, INTERNAL_SUFFIX, parseGreenfieldCliArgs, parseRenderingFlags, warnedInternalPath } from './cli-options.js';
import { DocxMarkdocError } from './errors.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';
import type { SourceParagraph } from './types.js';

const CLI_ENTRY = path.resolve(import.meta.dirname, 'cli.ts');

/** Imported Markdoc whose first paragraph is rewritten as a `change` tag carrying `nameAttributes`. */
async function markdocWithChange(nameAttributes: string): Promise<{ markdoc: string; paragraph: SourceParagraph }> {
  const source = await buildSyntheticDocx({ paragraphs: ['Either party may terminate this Agreement.', 'Second paragraph.'] });
  const imported = await importDocxToMarkdoc(source);
  const paragraph = requireMarkdoc(imported.markdoc).scaffold[0]!;
  const block = [
    `{% change id="${paragraph.id}" fingerprint="${paragraph.fingerprint}" style="${paragraph.style}" ${nameAttributes} format="inherit-source-paragraph" %}`,
    '{% before %}', 'Either party may terminate this Agreement.', '{% /before %}',
    '{% after %}', 'Either party may terminate this Agreement after a thirty-day cure period.', '{% /after %}',
    '{% /change %}',
  ].join('\n');
  const markdoc = imported.markdoc.replace(new RegExp(`\\{% para id="${paragraph.id}"[\\s\\S]*?\\{% /para %\\}`), block);
  return { markdoc, paragraph };
}

function caughtValidationError(markdoc: string): DocxMarkdocError {
  try {
    requireMarkdoc(markdoc);
  } catch (error) {
    if (error instanceof DocxMarkdocError) return error;
    throw error;
  }
  throw new Error('Expected requireMarkdoc to reject the Markdoc.');
}

/** Runs the real `docx-markdoc validate` entry point (via tsx) against `markdoc`. */
function runValidate(markdoc: string, env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'docx-markdoc-cli-'));
  try {
    const file = path.join(directory, 'document.mdoc');
    writeFileSync(file, markdoc);
    const { DEBUG: _ignored, ...baseEnv } = process.env;
    const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, 'validate', file], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { ...baseEnv, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('Markdoc CLI rendering safety', () => {
  itAllure('[SDX-MDOC-141] rejects the removed revision-grouping flag', () => {
    for (const policy of ['token-minimal', 'readable-whitespace']) {
      expect(() => parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--revision-grouping', policy]))
        .toThrow(/Unknown option --revision-grouping/u);
    }
  });

  itAllure('[SDX-MDOC-55] requires the dangerous flag and internal output path together', () => {
    expect(() => parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--dangerously-include-internal-comments']))
      .toThrow(/must be supplied together/u);
    expect(() => parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--internal-output', 'internal.docx']))
      .toThrow(/must be supplied together/u);
  });

  itAllure('[SDX-MDOC-52] treats external rendering flags as complete mutually exclusive overrides', () => {
    expect(parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--no-external-comments']).externalComments).toBe(false);
    expect(() => parseRenderingFlags(['--external-comments', '--no-external-comments'])).toThrow(/mutually exclusive/u);
  });

  itAllure('[SDX-MDOC-54] preserves the complete internal warning suffix within 255 UTF-8 bytes', () => {
    const requested = path.join('/tmp', `${'😀'.repeat(100)}.docx`);
    const warned = warnedInternalPath(requested);
    expect(path.basename(warned)).toMatch(/INTERNAL COMMENTS INCLUDED\.docx$/u);
    expect(Buffer.byteLength(path.basename(warned))).toBeLessThanOrEqual(255);
    expect(path.basename(warned).endsWith(INTERNAL_SUFFIX.trimStart())).toBe(true);
  });

  itAllure('[SDX-MDOC-89] parses audience note profiles and rejects conflicting profile sources', () => {
    expect(parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--external-notes', 'footnote', '--internal-notes', 'comment', '--unspecified-notes', 'omit']).notePresentation)
      .toEqual({ 'external-facing': 'footnote', internal: 'comment', unspecified: 'omit' });
    expect(() => parseRenderingFlags(['--note-profile', 'profile.json', '--internal-notes', 'comment']))
      .toThrow(/cannot be combined/u);
    expect(() => parseRenderingFlags(['--external-notes', 'email']))
      .toThrow(/requires preserve, comment, footnote, or omit/u);
  });

  itAllure('[SDX-MDOC-GREEN-CLI-01] keeps all three greenfield positionals with or without a style profile', () => {
    expect(parseGreenfieldCliArgs(['template.docx', 'form.mdoc', 'output']))
      .toEqual({ templatePath: 'template.docx', markdocPath: 'form.mdoc', outputDir: 'output' });
    expect(parseGreenfieldCliArgs(['template.docx', '--style-profile', 'style.json', 'form.mdoc', 'output']))
      .toEqual({ templatePath: 'template.docx', markdocPath: 'form.mdoc', outputDir: 'output', profilePath: 'style.json' });
    expect(() => parseGreenfieldCliArgs(['template.docx', 'form.mdoc'])).toThrow(/requires a template/u);
    expect(() => parseGreenfieldCliArgs(['template.docx', 'form.mdoc', 'output', '--style-profile'])).toThrow(/requires a JSON path/u);
  });
});

describe('Markdoc CLI error output', () => {
  itAllure('[SDX-MDOC-151] a missing edit name prints its code and line instead of a stack', async () => {
    const { markdoc } = await markdocWithChange('edit=""');
    const error = caughtValidationError(markdoc);
    expect(error.code).toBe('INVALID_MARKDOC');
    const line = error.issues?.[0]?.line;
    expect(Number.isInteger(line)).toBe(true);

    const formatted = formatCliError(error, false);
    expect(formatted).toMatch(new RegExp(`^ERROR MISSING_EDIT_NAME: change requires a non-empty edit= name\\. \\(line ${line}\\)$`, 'u'));
    expect(formatted).not.toContain('    at ');

    const run = runValidate(markdoc);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(`ERROR MISSING_EDIT_NAME: change requires a non-empty edit= name. (line ${line})`);
    expect(run.stderr).not.toContain('DocxMarkdocError: Markdoc validation failed.');
    expect(run.stderr).not.toContain('    at ');
  });

  itAllure('[SDX-MDOC-152] several issues print one ERROR line each, and an issue-less error prints its own code', async () => {
    const { markdoc } = await markdocWithChange('edit="add-cure-period"');
    const authored = `${markdoc}\n{% rationale for="no-such-edit" visibility="internal" %}\nOrphan.\n{% /rationale %}\n`
      + `{% change-set id="cure-period" edits="add-cure-period" operations="add-cure-period" atomic=true /%}\n`;
    const error = caughtValidationError(authored);
    const codes = error.issues!.map((issue) => issue.code);
    expect(codes).toContain('ORPHAN_RATIONALE');
    expect(codes).toContain('CONFLICTING_EDIT_ATTRIBUTES');
    // One issue carries a line and one does not, so both suffix shapes are exercised.
    expect(error.issues!.some((issue) => issue.line !== undefined)).toBe(true);
    expect(error.issues!.some((issue) => issue.line === undefined)).toBe(true);

    const lines = formatCliError(error, false).split('\n');
    expect(lines).toEqual(error.issues!.map((issue) =>
      `ERROR ${issue.code}: ${issue.message}${issue.line === undefined ? '' : ` (line ${issue.line})`}`));

    const run = runValidate(authored);
    expect(run.status).toBe(1);
    expect(run.stderr.replace(/\n$/u, '').split('\n')).toEqual(lines);

    expect(formatCliError(new DocxMarkdocError('GREENFIELD_OUTPUT_EXISTS', 'Output exists.'), false))
      .toBe('ERROR GREENFIELD_OUTPUT_EXISTS: Output exists.');
    expect(formatCliError(new DocxMarkdocError('SOURCE_MISMATCH', 'Fingerprint differs.', { expected: 'a' }), false))
      .toBe('ERROR SOURCE_MISMATCH: Fingerprint differs.');

    // Story topology failures pass SectPrAuditIssue[] (message but no code) as
    // details, exactly as story-inventory.ts does; the line must keep the
    // error's own code rather than print `ERROR undefined`.
    const audit = auditSectPr(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<w:body><w:sectPr><w:headerReference w:type="default" r:id="rId99"/></w:sectPr></w:body></w:document>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    expect(audit.ok).toBe(false);
    if (audit.ok) return;
    expect(audit.issues.map((issue) => issue.type)).toContain('sectpr_reference_dangling_rid');
    const topology = new DocxMarkdocError('STORY_TOPOLOGY_UNSUPPORTED', 'Selected header/footer bindings are invalid.', audit.issues);
    const formattedTopology = formatCliError(topology, false);
    expect(formattedTopology).toBe(audit.issues.map((issue) => `ERROR STORY_TOPOLOGY_UNSUPPORTED: ${issue.message}`).join('\n'));
    expect(formattedTopology).not.toContain('undefined');
  });

  itAllure('[SDX-MDOC-153] DEBUG appends the stack, and non-Markdoc errors keep printing theirs', async () => {
    const { markdoc } = await markdocWithChange('edit=""');
    const error = caughtValidationError(markdoc);
    const debugLines = formatCliError(error, true).split('\n');
    expect(debugLines[0]).toMatch(/^ERROR MISSING_EDIT_NAME: /u);
    expect(debugLines.slice(1).join('\n')).toBe(error.stack);

    const run = runValidate(markdoc, { DEBUG: '1' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^ERROR MISSING_EDIT_NAME: .* \(line \d+\)\nDocxMarkdocError: Markdoc validation failed\.\n\s+at /u);

    const plain = new Error('Disk full.');
    expect(formatCliError(plain, false)).toBe(plain.stack);
    expect(formatCliError('not an error', false)).toBe('not an error');
  });
});
