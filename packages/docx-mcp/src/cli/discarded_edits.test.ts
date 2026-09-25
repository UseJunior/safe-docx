import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { createTrackedTempDir, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { readDocumentXmlFromPath } from '../testing/docx_test_utils.js';
import { SAFE_DOCX_TOOL_CATALOG } from '../tool_catalog.js';
import { createProgram } from './index.js';
import { renderTopLevelHelp } from './help.js';
import { generateToolHelp } from './flag_parser.js';
import { acceptsCliOutputOption } from './output_option.js';
import { CliCommandFailure, UNSAVED_EDITS_DISCARDED } from './tool_runner.js';

registerCleanup();

const TEST_FEATURE = 'refuse-discarded-cli-edits';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Discarded Edits' });

const CLI_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts');
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Refusal = {
  success: boolean;
  error: { code: string; message: string; hint: string };
};

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

/** Run one CLI command in-process, capturing stdout/stderr lines and any thrown failure. */
async function runInProcess(argv: string[]): Promise<{ out: string[]; err: string[]; failure: unknown }> {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ write: (l) => out.push(l), writeError: (l) => err.push(l) });
  let failure: unknown;
  try {
    await program.parseAsync(['node', 'safe-docx', ...argv]);
  } catch (e) {
    failure = e;
  }
  return { out, err, failure };
}

/** A fixture with a tracked change in it, so accept-changes has something to accept. */
async function trackedFixture(): Promise<{ inputPath: string; firstParaId: string }> {
  const { firstParaId, inputPath, tmpDir } = await openSession(['Alpha bravo.', 'Charlie delta.']);
  const trackedPath = path.join(tmpDir, 'tracked.docx');
  const res = await runInProcess([
    'replace-text', inputPath, '--para', firstParaId, '--old', 'Alpha', '--new', 'Omega', '--instruction', 't',
    '-o', trackedPath,
  ]);
  expect(res.failure, res.err.join('\n')).toBeUndefined();
  return { inputPath: trackedPath, firstParaId };
}

describe('CLI mutating subcommands never report success for a discarded edit (#1048)', () => {
  test.openspec('[SDX-CLI-01] A mutating subcommand without an output path is refused and the file is unchanged')(
    '[SDX-CLI-01] replace-text over a real process exits 1 with success:false and leaves the file hash unchanged',
    async ({ given, when, then, and }: AllureBddContext) => {
      let inputPath!: string;
      let firstParaId!: string;
      let before!: string;
      let result!: ReturnType<typeof spawnSync>;

      await given('a fixture DOCX on disk and its hash', async () => {
        ({ inputPath, firstParaId } = await openSession(['First item.', 'Second item.']));
        before = await sha256(inputPath);
      });

      await when('safe-docx replace-text runs as a child process without --output', () => {
        result = spawnSync(
          process.execPath,
          [
            '--import', 'tsx', CLI_SOURCE_PATH, 'replace-text', inputPath,
            '--para', firstParaId, '--old', 'First', '--new', 'Altered', '--instruction', 't',
          ],
          { cwd: PACKAGE_DIR, encoding: 'utf8' },
        );
      });

      await then('it exits non-zero with success:false and a pointer to --output', () => {
        const stderr = String(result.stderr);
        expect(result.status, stderr).toBe(1);
        expect(String(result.stdout)).toBe('');
        const summaryStart = stderr.trimEnd().lastIndexOf('\n');
        const refusal = JSON.parse(stderr.slice(0, summaryStart)) as Refusal;
        expect(refusal.success).toBe(false);
        expect(refusal.error.code).toBe(UNSAVED_EDITS_DISCARDED);
        expect(refusal.error.hint).toContain('--output <path>');
        expect(refusal.error.hint).toContain('safe-docx replace-text');
        expect(stderr).not.toMatch(/"success":\s*true/);
        expect(stderr).not.toMatch(/\n\s+at /);
      });

      await and('the input file is byte-for-byte unchanged', async () => {
        expect(await sha256(inputPath)).toBe(before);
      });
    },
  );

  test.openspec('[SDX-CLI-01] A mutating subcommand without an output path is refused and the file is unchanged')(
    '[SDX-CLI-01] insert-paragraph, add-comment, batch-edit, accept-changes and edit are refused the same way',
    async ({ given, when, then }: AllureBddContext) => {
      const cases: Array<{ name: string; inputPath: string; argv: string[] }> = [];

      await given('one invocation of each mutating command, none with an output path', async () => {
        const plain = await openSession(['Alpha bravo.', 'Charlie delta.']);
        const planPath = path.join(plain.tmpDir, 'plan.json');
        await fs.writeFile(
          planPath,
          JSON.stringify([
            { step_id: 's1', operation: 'replace_text', target_paragraph_id: plain.firstParaId, old_string: 'Alpha', new_string: 'Omega', instruction: 't' },
          ]),
        );
        const tracked = await trackedFixture();
        cases.push(
          { name: 'insert-paragraph', inputPath: plain.inputPath, argv: ['insert-paragraph', plain.inputPath, '--anchor', plain.firstParaId, '--new-string', 'Inserted.', '--instruction', 't'] },
          { name: 'add-comment', inputPath: plain.inputPath, argv: ['add-comment', plain.inputPath, '--para', plain.firstParaId, '--author', 'Reviewer', '--text', 'Note'] },
          { name: 'batch-edit', inputPath: plain.inputPath, argv: ['batch-edit', plain.inputPath, '--plan-file-path', planPath] },
          { name: 'accept-changes', inputPath: tracked.inputPath, argv: ['accept-changes', tracked.inputPath] },
          { name: 'edit', inputPath: plain.inputPath, argv: ['edit', plain.inputPath, '--replace', plain.firstParaId, 'Alpha', 'Omega'] },
        );
      });

      await then('each fails with UNSAVED_EDITS_DISCARDED, prints nothing to stdout, and leaves its input unchanged', async () => {
        for (const c of cases) {
          const before = await sha256(c.inputPath);
          const { out, err, failure } = await runInProcess(c.argv);
          expect(failure, `${c.name}: ${err.join('\n')}`).toBeInstanceOf(CliCommandFailure);
          expect(out, c.name).toEqual([]);
          const refusal = JSON.parse(err[0]!) as Refusal;
          expect(refusal.success, c.name).toBe(false);
          expect(refusal.error.code, c.name).toBe(UNSAVED_EDITS_DISCARDED);
          expect(refusal.error.hint, c.name).toContain(`safe-docx ${c.name} <file> ... --output <path>`);
          expect(err.join('\n'), c.name).not.toMatch(/"success":\s*true/);
          expect(await sha256(c.inputPath), c.name).toBe(before);
        }
      });
    },
  );

  test.openspec('[SDX-CLI-02] A mutating subcommand with an output path saves the edit')(
    '[SDX-CLI-02] replace-text -o writes the edited document and leaves the input unchanged',
    async ({ given, when, then }: AllureBddContext) => {
      let inputPath!: string;
      let firstParaId!: string;
      let outPath!: string;
      let before!: string;
      let res!: Awaited<ReturnType<typeof runInProcess>>;

      await given('a fixture DOCX and an output path', async () => {
        ({ inputPath, firstParaId } = await openSession(['First item.', 'Second item.']));
        outPath = path.join(await createTrackedTempDir(), 'edited.docx');
        before = await sha256(inputPath);
      });

      await when('replace-text runs with --output', async () => {
        res = await runInProcess([
          'replace-text', inputPath, '--para', firstParaId, '--old', 'First', '--new', 'Altered',
          '--instruction', 't', '--output', outPath,
        ]);
      });

      await then('it succeeds, the output carries the edit, and the input is unchanged', async () => {
        expect(res.failure, res.err.join('\n')).toBeUndefined();
        const printed = JSON.parse(res.out[0]!) as { success: boolean; apply: { success: boolean }; save: { success: boolean } };
        expect(printed.success).toBe(true);
        expect(printed.apply.success).toBe(true);
        expect(printed.save.success).toBe(true);
        expect(await readDocumentXmlFromPath(outPath)).toContain('Altered');
        expect(await sha256(inputPath)).toBe(before);
      });
    },
  );

  test.openspec('[SDX-CLI-03] Read-only subcommands are unaffected')(
    '[SDX-CLI-03] read-file, grep, get-* , extract-revisions and has-tracked-changes succeed without an output path',
    async ({ given, then }: AllureBddContext) => {
      let inputPath!: string;
      await given('a fixture with a tracked change', async () => {
        ({ inputPath } = await trackedFixture());
      });

      await then('each read-only command prints success and exits cleanly', async () => {
        const commands = [
          ['read-file', inputPath],
          ['grep', 'Omega', inputPath],
          ['get-document-outline', inputPath],
          ['get-comments', inputPath],
          ['get-footnotes', inputPath],
          ['extract-revisions', inputPath],
          ['has-tracked-changes', inputPath],
        ];
        for (const argv of commands) {
          const { out, err, failure } = await runInProcess(argv);
          expect(failure, `${argv[0]}: ${err.join('\n')}`).toBeUndefined();
          expect(out.length, argv[0]).toBeGreaterThan(0);
          expect(err.join('\n'), argv[0]).not.toContain(UNSAVED_EDITS_DISCARDED);
        }
      });
    },
  );

  test.openspec('[SDX-CLI-04] Help states the output-path requirement')(
    '[SDX-CLI-04] top-level and per-tool help document -o/--output and the refusal',
    async ({ then, and }: AllureBddContext) => {
      await then('top-level help explains the refusal', () => {
        const help = renderTopLevelHelp();
        expect(help).toContain('-o, --output <path>');
        expect(help).toContain(UNSAVED_EDITS_DISCARDED);
      });

      await and('every non-read-only tool without its own output path lists -o/--output', () => {
        const mutating = SAFE_DOCX_TOOL_CATALOG.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
        const withOption = mutating.filter(acceptsCliOutputOption);
        expect(mutating.filter((n) => !withOption.includes(n)).sort()).toEqual(
          ['close_file', 'convert_to_odt', 'export', 'save'],
        );
        for (const name of withOption) {
          const help = generateToolHelp(name);
          expect(help, name).toContain('-o, --output <path>');
          expect(help, name).toContain(UNSAVED_EDITS_DISCARDED);
        }
        for (const tool of SAFE_DOCX_TOOL_CATALOG.filter((t) => t.annotations.readOnlyHint)) {
          expect(generateToolHelp(tool.name), tool.name).not.toContain(UNSAVED_EDITS_DISCARDED);
        }
      });
    },
  );
});
