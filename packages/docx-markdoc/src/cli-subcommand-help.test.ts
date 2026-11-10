import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect } from 'vitest';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { COMMAND_HELP, commandHelp, creationGrammarHelp, topLevelUsage, UNDOCUMENTED } from './cli-help.js';
import { formatCliError } from './cli-options.js';
import { runCli } from './cli-run.js';
import { HEADING_NUMBER_SCHEMES } from './create/list-numbering.js';
import {
  CREATION_BLOCK_TAGS,
  CREATION_FRONTMATTER_KEYS,
  CREATION_INLINE_TAGS,
  FILL_IN_MODES,
  FIRST_PAGE_NONE,
  FOOTER_LAYOUTS,
  PAGE_NUMBER_FORMATS,
  RUNNING_TEXT_ALIGNMENTS,
  RUNNING_TEXT_KEYS,
  XREF_FORMATS,
  XREF_NUMBERS,
  XREF_SHOWS,
} from './create/validate.js';
import { CliUsageError } from './errors.js';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc } from './markdoc.js';

const TEST_FEATURE = 'update-markdoc-cli-help-and-creation-lint';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1223 subcommand help, one-line usage errors and validate --create',
  severity: 'normal',
});

const CLI_ENTRY = path.resolve(import.meta.dirname, 'cli.ts');
const SUBCOMMANDS = ['import', 'validate', 'inspect', 'compile', 'verify', 'compile-greenfield', 'create', 'export-edits', 'comments-to-footnotes'];
/** A stack frame line, as Node prints it. */
const STACK_FRAME = /^\s+at /mu;

/** The creation source of #1223 gap 5, which `create` builds without error. */
const GAP_5_SOURCE = [
  '---',
  'title: Engagement Letter',
  'page-numbers: true',
  '---',
  '',
  'Dear Client:',
  '',
  '**Re: Acme Matter**',
  '',
  '{% section footer="[Acceptance Page]" /%}',
  '',
  '{% signer name="Jane Roe" date="Date: ________" /%}',
  '',
].join('\n');

type CliRun = { code: number; stdout: string; stderr: string };

async function run(argv: string[], debug = false): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; }, debug });
  return { code, stdout, stderr };
}

/** Runs the real `docx-markdoc` entry point (via tsx) without DEBUG. */
function spawnCli(argv: string[], env: Record<string, string> = {}): CliRun {
  const { DEBUG: _ignored, ...baseEnv } = process.env;
  const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...argv], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    env: { ...baseEnv, ...env },
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Every entry under `directory`, recursively, with its size and modification time. */
async function listing(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true });
  const described = await Promise.all(entries.map(async (entry) => {
    const info = await stat(path.join(directory, entry));
    return `${entry} ${info.isDirectory() ? 'dir' : info.size} ${info.mtimeMs}`;
  }));
  return described.sort();
}

const scratch: string[] = [];
async function scratchDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'docx-markdoc-cli-help-'));
  scratch.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** One stderr line, no stack frame. */
function expectOneLine(stderr: string, pattern: RegExp): void {
  const lines = stderr.trimEnd().split('\n');
  expect(lines, stderr).toHaveLength(1);
  expect(lines[0]).toMatch(pattern);
  expect(stderr).not.toMatch(STACK_FRAME);
}

describe('Traceability: subcommand help, usage errors and validate --create', () => {
  test.openspec('[SDX-MDOC-CLIHELP-01] every subcommand prints its help and exits 0')(
    'Scenario: every subcommand prints its help and exits 0',
    async () => {
      expect(Object.keys(COMMAND_HELP).sort()).toEqual([...SUBCOMMANDS].sort());
      for (const command of SUBCOMMANDS) {
        for (const argv of [[command, '--help'], [command, '-h'], [command, 'some-input.mdoc', '--help']]) {
          const result = await run(argv);
          expect(result.code, argv.join(' ')).toBe(0);
          expect(result.stderr, argv.join(' ')).toBe('');
          expect(result.stdout).toBe(`${commandHelp(command)}\n`);
          expect(result.stdout).toMatch(new RegExp(`^Usage:\\n  docx-markdoc ${command} `, 'u'));
          for (const heading of ['Arguments:', 'Options:', 'Outputs:']) expect(result.stdout).toContain(`\n${heading}\n`);
          expect(result.stdout).toContain('-h, --help');
        }
      }
      const top = await run(['--help']);
      expect(top.code).toBe(0);
      expect(top.stdout).toBe(`${topLevelUsage()}\n`);
      for (const help of Object.values(COMMAND_HELP)) {
        for (const line of help.synopsis) expect(top.stdout).toContain(`docx-markdoc ${line}`);
      }
      // validate documents its creation mode.
      expect(commandHelp('validate')).toContain('--create');
      // The real entry point: help on stdout, exit 0, for a command that used to print a stack.
      const spawned = spawnCli(['create', '--help']);
      expect(spawned.code).toBe(0);
      expect(spawned.stderr).toBe('');
      expect(spawned.stdout).toBe(`${commandHelp('create')}\n`);
    },
  );

  test.openspec('[SDX-MDOC-CLIHELP-02] usage errors print one line and no stack')(
    'Scenario: usage errors print one line and no stack',
    async () => {
      for (const command of SUBCOMMANDS) {
        const result = await run([command, '--bogus', 'a', 'b', 'c']);
        expect(result.code, command).toBe(1);
        expectOneLine(result.stderr, new RegExp(`^ERROR CLI_USAGE: Unknown option --bogus\\. Run 'docx-markdoc ${command} --help' for usage\\.$`, 'u'));
        expect(result.stdout).toBe('');
        const bare = await run([command]);
        expect(bare.code, `${command} with no arguments`).toBe(1);
        expectOneLine(bare.stderr, new RegExp(`^ERROR CLI_USAGE: .+ Run 'docx-markdoc ${command} --help' for usage\\.$`, 'u'));
      }
      const cases: Array<[string[], RegExp]> = [
        [['import', 'a.docx', 'b.docx'], /import takes <source\.docx> <anchored\.docx> <document\.mdoc>; got 2 arguments\./u],
        [['validate', 'a.mdoc', 'b.docx', 'c'], /validate takes <document\.mdoc> \[anchored\.docx\]; got 3 arguments\./u],
        [['verify', 'a.docx', 'b.mdoc', 'out'], /verify takes <anchored\.docx> <document\.mdoc>; got 3 arguments\./u],
        [['verify', 'a.docx', 'b.mdoc', '--dangerously-include-internal-comments', '--internal-output', 'i.docx'], /only by compile/u],
        [['create', 'a.mdoc', 'out', '--no-pdf', '--require-pdf'], /mutually exclusive/u],
        [['comments-to-footnotes', 'in.docx', 'out.docx', '--prefix'], /--prefix requires a value\./u],
        [['comments-to-footnotes', 'in.docx', 'out.docx', '--prefix', 'A', '--prefix', 'B'], /--prefix may be supplied only once\./u],
        [['comments-to-footnotes', 'in.docx', 'out.docx', '--color', 'FF0000', '--body-color', '00FF00'], /same option/u],
        [['validate', '--create', 'a.mdoc', 'anchored.docx'], /applies only to brownfield/u],
        [['validate', 'a.mdoc', '--style-profile', 'p.json'], /applies only with --create/u],
        [['bogus'], /^ERROR CLI_USAGE: Unknown command 'bogus'\. Run 'docx-markdoc --help' for usage\.$/u],
        [[], /^ERROR CLI_USAGE: No command given\. Run 'docx-markdoc --help' for usage\.$/u],
      ];
      for (const [argv, pattern] of cases) {
        const result = await run(argv);
        expect(result.code, argv.join(' ')).toBe(1);
        expectOneLine(result.stderr, pattern);
      }
      // Option values the conversion would refuse are usage errors, checked before the input is read.
      const conversionDir = await scratchDir();
      const input = path.join(conversionDir, 'input.docx');
      await writeFile(input, await buildSyntheticDocx({ paragraphs: ['A paragraph.'] }));
      const badValues: Array<[string[], RegExp]> = [
        [['--body-color', 'red'], /--body-color must be six hexadecimal digits \(RRGGBB\), got 'red'\./u],
        [['--color', '12345'], /--color must be six hexadecimal digits/u],
        [['--prefix-color', 'ZZZZZZ'], /--prefix-color must be six hexadecimal digits/u],
        [['--body-highlight', 'bogus'], /--body-highlight must be one of black, .*, none, got 'bogus'\./u],
        [['--highlight', 'Yellow'], /--highlight must be one of /u],
        [['--prefix-highlight', 'pink'], /--prefix-highlight must be one of /u],
      ];
      for (const [flags, pattern] of badValues) {
        const result = await run(['comments-to-footnotes', input, path.join(conversionDir, 'out.docx'), ...flags]);
        expect(result.code, flags.join(' ')).toBe(1);
        expectOneLine(result.stderr, new RegExp(`^ERROR CLI_USAGE: ${pattern.source}.* Run 'docx-markdoc comments-to-footnotes --help' for usage\\.$`, 'u'));
      }
      expect((await readdir(conversionDir)).sort()).toEqual(['input.docx']);
      const converted = await run(['comments-to-footnotes', input, path.join(conversionDir, 'out.docx'), '--body-color', '1F4E79', '--highlight', 'yellow']);
      expect(converted.stderr).toBe('');
      expect(converted.code).toBe(0);

      const missing = await run(['validate', path.join(await scratchDir(), 'missing.mdoc')]);
      expect(missing.code).toBe(1);
      expectOneLine(missing.stderr, /^ERROR ENOENT: ENOENT: no such file or directory, open '.*missing\.mdoc'$/u);

      // DEBUG appends the stack to a usage error.
      const debug = await run(['create', '--bogus'], true);
      expect(debug.stderr).toMatch(/^ERROR CLI_USAGE: Unknown option --bogus\./u);
      expect(debug.stderr).toMatch(STACK_FRAME);
      // A defect is not a usage error: it keeps its stack.
      const defect = formatCliError(new TypeError('cannot read properties of undefined'), false);
      expect(defect).toMatch(/^TypeError: cannot read properties of undefined\n\s+at /u);
      const plainCodeError = Object.assign(new Error('not a file-system error'), { code: 'ENOENT' });
      expect(formatCliError(plainCodeError, false)).toMatch(STACK_FRAME);
      expect(formatCliError(new CliUsageError('Bad.', 'inspect'), false)).toBe("ERROR CLI_USAGE: Bad. Run 'docx-markdoc inspect --help' for usage.");

      // The real entry point, for the commands that used to print a stack.
      for (const argv of [['create', '--help-me'], ['import', 'only-one.docx'], ['compile-greenfield', '--bogus']]) {
        const spawned = spawnCli(argv);
        expect(spawned.code, argv.join(' ')).toBe(1);
        expectOneLine(spawned.stderr, /^ERROR CLI_USAGE: /u);
      }
    },
  );

  test.openspec('[SDX-MDOC-CLIHELP-03] create help lists the whole creation grammar from its constants')(
    'Scenario: create help lists the whole creation grammar from its constants',
    async () => {
      const help = commandHelp('create')!;
      const lines = help.split('\n');
      expect(help).not.toContain(UNDOCUMENTED);
      // Descriptions say what each key does: title is the document property, not a visible paragraph.
      expect(lines.find((line) => line.startsWith('  title '))).toMatch(/document title property, not a visible paragraph/u);
      for (const key of CREATION_FRONTMATTER_KEYS) {
        expect(lines.some((line) => new RegExp(`^  ${key} +\\S`, 'u').test(line)), `frontmatter key ${key}`).toBe(true);
      }
      const sectionLine = lines.find((line) => line.startsWith('{% section %} attributes: '))!;
      expect(sectionLine.slice('{% section %} attributes: '.length).split(', ')).toEqual([...RUNNING_TEXT_KEYS]);
      for (const [tag, allowed] of [...Object.entries(CREATION_BLOCK_TAGS), ...Object.entries(CREATION_INLINE_TAGS)]) {
        const line = lines.find((candidate) => candidate.startsWith(`  ${tag}:`) || candidate.startsWith(`  ${tag} (`));
        expect(line, `tag ${tag}`).toBeDefined();
        for (const attribute of allowed) expect(line, `${tag} ${attribute}`).toContain(attribute);
      }
      const values = [
        ...RUNNING_TEXT_ALIGNMENTS, ...PAGE_NUMBER_FORMATS, ...FOOTER_LAYOUTS, FIRST_PAGE_NONE, ...FILL_IN_MODES,
        ...HEADING_NUMBER_SCHEMES, ...XREF_SHOWS, ...XREF_NUMBERS, ...XREF_FORMATS,
      ];
      for (const value of values) expect(help, `value ${value}`).toMatch(new RegExp(`(^|[\\s=|(])${value}([\\s|):;,]|$)`, 'mu'));

      // Negative control: a key or tag added to the constants without help is
      // listed as undocumented, so the assertions above fail on it.
      const keys = CREATION_FRONTMATTER_KEYS as Set<string>;
      keys.add('header-colour');
      (CREATION_INLINE_TAGS as Record<string, ReadonlySet<string>>).strike = new Set(['style']);
      try {
        const grammar = creationGrammarHelp();
        expect(grammar.find((line) => line.startsWith('  header-colour '))).toContain(UNDOCUMENTED);
        expect(grammar.find((line) => line.startsWith('  strike (style):'))).toContain(UNDOCUMENTED);
      } finally {
        keys.delete('header-colour');
        delete (CREATION_INLINE_TAGS as Record<string, ReadonlySet<string>>).strike;
      }
      expect(creationGrammarHelp().join('\n')).not.toContain(UNDOCUMENTED);
    },
  );

  test.openspec("[SDX-MDOC-CLIHELP-04] the issue's creation source passes and nothing is written")(
    'Scenario: the creation source of issue 1223 gap 5 passes validate --create and nothing is written',
    async () => {
      const directory = await scratchDir();
      const file = path.join(directory, 'v.mdoc');
      await writeFile(file, GAP_5_SOURCE);
      const before = await listing(directory);
      const result = await run(['validate', '--create', file]);
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        grammar: 'creation',
        valid: true,
        sections: 2,
        blocks: 3,
        frontmatter: { title: 'Engagement Letter', pageNumbers: true },
      });
      expect(await listing(directory)).toEqual(before);
      // The flag may come after the file, and a style profile is read as create reads it.
      const profile = path.join(directory, 'house.json');
      await writeFile(profile, JSON.stringify({ font: 'Garamond' }));
      const withProfileBefore = await listing(directory);
      const withProfile = await run(['validate', file, '--create', '--style-profile', profile]);
      expect(withProfile.code).toBe(0);
      expect(await listing(directory)).toEqual(withProfileBefore);
      expect((await readdir(directory)).sort()).toEqual(['house.json', 'v.mdoc']);
    },
  );

  test.openspec('[SDX-MDOC-CLIHELP-05] a bad creation source fails with the message and line create prints')(
    'Scenario: a bad creation source fails validate --create with the message and line create prints',
    async () => {
      const cases: Array<[string, string, RegExp]> = [
        ['unknown-key', '---\ntitle: X\nheader-colour: red\n---\n\nBody.\n', /^ERROR UNSUPPORTED_CREATION_FRONTMATTER: Unsupported frontmatter line 3: 'header-colour: red'\./u],
        ['frontmatter-align', '---\nheader-align: right\n---\n\nBody.\n', /^ERROR UNSUPPORTED_CREATION_FRONTMATTER: header-align needs header text/u],
        ['section-align', '---\ntitle: X\n---\n\nDear Client:\n\n{% section header-align="right" /%}\n\nMore.\n', /^ERROR INVALID_SECTION: header-align needs header text .* \(line 7\)$/u],
        ['empty-section', '---\ntitle: X\n---\n\n{% section footer="F" /%}\n\nBody.\n', /^ERROR EMPTY_CREATION_SECTION: .* \(line 5\)$/u],
        ['bad-profile', GAP_5_SOURCE, /^ERROR INVALID_CREATION_PROFILE_JSON: /u],
      ];
      for (const [name, source, pattern] of cases) {
        const directory = await scratchDir();
        const file = path.join(directory, `${name}.mdoc`);
        await writeFile(file, source);
        const profileArgs: string[] = [];
        if (name === 'bad-profile') {
          await writeFile(path.join(directory, 'profile.json'), '{ not json');
          profileArgs.push('--style-profile', path.join(directory, 'profile.json'));
        }
        const before = await listing(directory);
        const linted = await run(['validate', '--create', file, ...profileArgs]);
        expect(linted.code, name).toBe(1);
        expect(linted.stdout).toBe('');
        expectOneLine(linted.stderr, pattern);
        expect(await listing(directory), name).toEqual(before);
        const created = await run(['create', file, path.join(directory, 'out'), '--no-pdf', ...profileArgs]);
        expect(created.code, name).toBe(1);
        expect(created.stderr, name).toBe(linted.stderr);
      }
    },
  );

  test.openspec('[SDX-MDOC-CLIHELP-06] brownfield validate is unchanged')(
    'Scenario: brownfield validate is unchanged and does not detect creation sources',
    async () => {
      const directory = await scratchDir();
      const imported = await importDocxToMarkdoc(await buildSyntheticDocx({ paragraphs: ['Either party may terminate this Agreement.', 'Second paragraph.'] }));
      const brownfield = path.join(directory, 'revision.mdoc');
      await writeFile(brownfield, imported.markdoc);
      const validated = await run(['validate', brownfield]);
      expect(validated.code).toBe(0);
      expect(validated.stdout).toBe(`${JSON.stringify(requireMarkdoc(imported.markdoc), null, 2)}\n`);
      // A brownfield file is not a creation source.
      const asCreation = await run(['validate', '--create', brownfield]);
      expect(asCreation.code).toBe(1);
      expect(asCreation.stderr).toMatch(/^ERROR /u);

      const creation = path.join(directory, 'v.mdoc');
      await writeFile(creation, GAP_5_SOURCE);
      const withoutFlag = await run(['validate', creation]);
      expect(withoutFlag.code).toBe(1);
      expect(withoutFlag.stderr).toContain("ERROR tag-undefined: Undefined tag: 'section' (line 10)");
      expect(withoutFlag.stderr).toContain('ERROR MISSING_SOURCE: ');
    },
  );
});
