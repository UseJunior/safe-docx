import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { itAllure, allureStep } from '../../testing/allure-test.js';
import { parseEditArgs, runEditCommand } from './edit.js';
import { makeMinimalDocx, extractParaIdsFromToon } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup, openSession } from '../../testing/session-test-utils.js';

registerCleanup();

const it = itAllure.epic('Document Editing').withLabels({ feature: 'CLI Edit Command' });

describe('parseEditArgs', () => {
  it('parses --replace with 3 positional values', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'old', 'new']);
    expect(result.file_path).toBe('test.docx');
    expect(result.replaces).toHaveLength(1);
    expect(result.replaces[0]).toEqual({
      paragraph_id: '_bk_1',
      old_string: 'old',
      new_string: 'new',
    });
  });

  it('parses multiple --replace flags', () => {
    const result = parseEditArgs([
      'test.docx',
      '--replace', '_bk_1', 'old1', 'new1',
      '--replace', '_bk_2', 'old2', 'new2',
    ]);
    expect(result.replaces).toHaveLength(2);
    expect(result.replaces[0]!.paragraph_id).toBe('_bk_1');
    expect(result.replaces[1]!.paragraph_id).toBe('_bk_2');
  });

  it('parses --insert-after', () => {
    const result = parseEditArgs(['test.docx', '--insert-after', '_bk_1', 'new paragraph']);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]).toEqual({
      anchor_id: '_bk_1',
      text: 'new paragraph',
      position: 'AFTER',
    });
  });

  it('parses --insert-before', () => {
    const result = parseEditArgs(['test.docx', '--insert-before', '_bk_2', 'before text']);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]!.position).toBe('BEFORE');
  });

  it('parses -o output path', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'a', 'b', '-o', '/out.docx']);
    expect(result.output_path).toBe('/out.docx');
  });

  it('parses --output alias', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'a', 'b', '--output', '/out.docx']);
    expect(result.output_path).toBe('/out.docx');
  });

  it('parses --instruction', () => {
    const result = parseEditArgs([
      'test.docx', '--replace', '_bk_1', 'a', 'b', '--instruction', 'Fix typo',
    ]);
    expect(result.instruction).toBe('Fix typo');
  });

  it('throws on missing file_path', () => {
    expect(() => parseEditArgs(['--replace', '_bk_1', 'a', 'b'])).toThrow('file path');
  });

  it('throws with no edit operations', () => {
    expect(() => parseEditArgs(['test.docx'])).toThrow('at least one');
  });

  it('throws on unknown flag', () => {
    expect(() => parseEditArgs(['test.docx', '--bogus'])).toThrow('Unknown edit flag');
  });

  it('throws on incomplete --replace', () => {
    expect(() => parseEditArgs(['test.docx', '--replace', '_bk_1'])).toThrow('3 arguments');
  });
});

describe('runEditCommand E2E', () => {
  it('builds steps from flags and applies edits via apply_plan', async () => {
    const { firstParaId, inputPath } = await openSession(['Hello world']);

    const output: string[] = [];
    const errors: string[] = [];

    await allureStep('Run edit command with --replace', async () => {
      await runEditCommand(
        {
          file_path: inputPath,
          replaces: [{ paragraph_id: firstParaId, old_string: 'Hello', new_string: 'Goodbye' }],
          inserts: [],
        },
        { write: (l) => output.push(l), writeError: (l) => errors.push(l) },
      );
    });

    await allureStep('Verify output contains success', () => {
      expect(errors).toHaveLength(0);
      expect(output).toHaveLength(1);
      const result = JSON.parse(output[0]!) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  it('saves output when -o is specified', async () => {
    const { firstParaId, inputPath } = await openSession(['Hello world']);
    const tmpDir = await createTrackedTempDir();
    const outPath = path.join(tmpDir, 'output.docx');

    const output: string[] = [];
    const errors: string[] = [];

    await allureStep('Run edit command with --replace and -o', async () => {
      try {
        await runEditCommand(
          {
            file_path: inputPath,
            replaces: [{ paragraph_id: firstParaId, old_string: 'Hello', new_string: 'Goodbye' }],
            inserts: [],
            output_path: outPath,
          },
          { write: (l) => output.push(l), writeError: (l) => errors.push(l) },
        );
      } catch (e) {
        if (errors.length > 0) {
          // eslint-disable-next-line no-console
          console.error('Save stderr:', errors.join('\n'));
        }
        throw e;
      }
    });

    await allureStep('Verify output file was created', async () => {
      expect(errors).toHaveLength(0);
      const stat = await fs.stat(outPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    await allureStep('Verify combined JSON output', () => {
      const result = JSON.parse(output[0]!) as { apply: { success: boolean }; save: { success: boolean } };
      expect(result.apply.success).toBe(true);
      expect(result.save.success).toBe(true);
    });
  });
});
