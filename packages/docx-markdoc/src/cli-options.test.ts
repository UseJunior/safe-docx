import path from 'node:path';
import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { INTERNAL_SUFFIX, parseGreenfieldCliArgs, parseRenderingFlags, warnedInternalPath } from './cli-options.js';

describe('Markdoc CLI rendering safety', () => {
  itAllure('[SDX-MDOC-141] parses the closed revision-grouping policy', () => {
    expect(parseRenderingFlags(['source.docx', 'edit.mdoc', 'out', '--revision-grouping', 'readable-whitespace']).revisionGrouping)
      .toBe('readable-whitespace');
    expect(() => parseRenderingFlags(['--revision-grouping', 'coarse'])).toThrow(/token-minimal or readable-whitespace/u);
    expect(() => parseRenderingFlags(['--revision-grouping', 'token-minimal', '--revision-grouping', 'token-minimal']))
      .toThrow(/only once/u);
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
