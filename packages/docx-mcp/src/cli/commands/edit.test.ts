import { XMLSerializer } from '@xmldom/xmldom';
import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectZipEntries, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { parseEditArgs, runEditCommand } from './edit.js';
import { makeMinimalDocx, extractParaIdsFromToon, readDocumentXmlFromPath } from '../../testing/docx_test_utils.js';
import { createTrackedTempDir, registerCleanup, openSession } from '../../testing/session-test-utils.js';

registerCleanup();

const test = testAllure.epic('Document Editing').withLabels({ feature: 'CLI Edit Command' });

describe('parseEditArgs', () => {
  test('parses --replace with 3 positional values', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'old', 'new']);
    expect(result.file_path).toBe('test.docx');
    expect(result.replaces).toHaveLength(1);
    expect(result.replaces[0]).toEqual({
      paragraph_id: '_bk_1',
      old_string: 'old',
      new_string: 'new',
    });
  });

  test('parses multiple --replace flags', () => {
    const result = parseEditArgs([
      'test.docx',
      '--replace', '_bk_1', 'old1', 'new1',
      '--replace', '_bk_2', 'old2', 'new2',
    ]);
    expect(result.replaces).toHaveLength(2);
    expect(result.replaces[0]!.paragraph_id).toBe('_bk_1');
    expect(result.replaces[1]!.paragraph_id).toBe('_bk_2');
  });

  test('parses --insert-after', () => {
    const result = parseEditArgs(['test.docx', '--insert-after', '_bk_1', 'new paragraph']);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]).toEqual({
      anchor_id: '_bk_1',
      text: 'new paragraph',
      position: 'AFTER',
    });
  });

  test('parses --insert-before', () => {
    const result = parseEditArgs(['test.docx', '--insert-before', '_bk_2', 'before text']);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]!.position).toBe('BEFORE');
  });

  test('parses -o output path', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'a', 'b', '-o', '/out.docx']);
    expect(result.output_path).toBe('/out.docx');
  });

  test('parses --output alias', () => {
    const result = parseEditArgs(['test.docx', '--replace', '_bk_1', 'a', 'b', '--output', '/out.docx']);
    expect(result.output_path).toBe('/out.docx');
  });

  test('parses --instruction', () => {
    const result = parseEditArgs([
      'test.docx', '--replace', '_bk_1', 'a', 'b', '--instruction', 'Fix typo',
    ]);
    expect(result.instruction).toBe('Fix typo');
  });

  test('throws on missing file_path', () => {
    expect(() => parseEditArgs(['--replace', '_bk_1', 'a', 'b'])).toThrow('file path');
  });

  test('throws with no edit operations', () => {
    expect(() => parseEditArgs(['test.docx'])).toThrow('at least one');
  });

  test('throws on unknown flag', () => {
    expect(() => parseEditArgs(['test.docx', '--bogus'])).toThrow('Unknown edit flag');
  });

  test('throws on incomplete --replace', () => {
    expect(() => parseEditArgs(['test.docx', '--replace', '_bk_1'])).toThrow('3 arguments');
  });
});

describe('runEditCommand E2E', () => {
  test('builds steps from flags and applies edits via batch_edit', async ({ when, then }: AllureBddContext) => {
    const { firstParaId, inputPath } = await openSession(['Hello world']);

    const output: string[] = [];
    const errors: string[] = [];

    await when('Run edit command with --replace', async () => {
      await runEditCommand(
        {
          file_path: inputPath,
          replaces: [{ paragraph_id: firstParaId, old_string: 'Hello', new_string: 'Goodbye' }],
          inserts: [],
        },
        { write: (l) => output.push(l), writeError: (l) => errors.push(l) },
      );
    });

    await then('Verify output contains success', () => {
      expect(errors).toHaveLength(0);
      expect(output).toHaveLength(1);
      const result = JSON.parse(output[0]!) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  test('saves output when -o is specified', async ({ when, then }: AllureBddContext) => {
    const { firstParaId, inputPath } = await openSession(['Hello world']);
    const tmpDir = await createTrackedTempDir();
    const outPath = path.join(tmpDir, 'output.docx');

    const output: string[] = [];
    const errors: string[] = [];

    await when('Run edit command with --replace and -o', async () => {
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

    await then('Verify output file was created', async () => {
      expect(errors).toHaveLength(0);
      const stat = await fs.stat(outPath);
      expect(stat.size).toBeGreaterThan(0);
    });

    await then('Verify combined JSON output', () => {
      const result = JSON.parse(output[0]!) as { apply: { success: boolean }; save: { success: boolean } };
      expect(result.apply.success).toBe(true);
      expect(result.save.success).toBe(true);
    });
  });

  test('a single replace does not rewrite untouched paragraphs or inflate the archive (issue #408)', async ({ given, when, then }: AllureBddContext) => {
    // Word-shaped fixture: untouched paragraphs carry volatile proofErr
    // markup and rsid-fragmented same-format runs — exactly what open-time
    // normalization rewrites in memory and must NOT persist to disk.
    const BLAST_XML =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:proofErr w:type="spellStart"/><w:r w:rsidR="00AA0001"><w:t>Lorem</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/><w:r w:rsidR="00AA0002"><w:t xml:space="preserve"> ipsum intro</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>{mnda_term}</w:t></w:r></w:p>` +
      `<w:p><w:proofErr w:type="gramStart"/><w:r><w:t>dolor</w:t></w:r>` +
      `<w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve"> sit outro</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const serializer = new XMLSerializer();
    const bodyBlocks = (xml: string): string[] => {
      const doc = parseXml(xml);
      const body = doc.getElementsByTagName('w:body').item(0)!;
      const out: string[] = [];
      let child = body.firstChild;
      while (child) {
        if (child.nodeType === 1) out.push(serializer.serializeToString(child as never));
        child = child.nextSibling;
      }
      return out;
    };

    let inputPath = '';
    let outPath = '';
    let targetParaId = '';
    let saveJson: { blocks_restored?: number } = {};

    await given('a session over a proofErr-bearing three-paragraph document', async () => {
      const session = await openSession([], { xml: BLAST_XML });
      inputPath = session.inputPath;
      targetParaId = session.paraIds[1]!;
      outPath = path.join(await createTrackedTempDir(), 'revised.docx');
    });

    await when('one paragraph is replaced and the result saved', async () => {
      const output: string[] = [];
      const errors: string[] = [];
      await runEditCommand(
        {
          file_path: inputPath,
          replaces: [{ paragraph_id: targetParaId, old_string: '{mnda_term}', new_string: 'two (2) years' }],
          inserts: [],
          output_path: outPath,
        },
        { write: (l) => output.push(l), writeError: (l) => errors.push(l) },
      );
      expect(errors).toHaveLength(0);
      saveJson = (JSON.parse(output[0]!) as { save: { blocks_restored?: number } }).save;
    });

    await then('only the edited paragraph differs from the input', async () => {
      const inputBlocks = bodyBlocks(await readDocumentXmlFromPath(inputPath));
      const outputBlocks = bodyBlocks(await readDocumentXmlFromPath(outPath));
      expect(outputBlocks).toHaveLength(inputBlocks.length);

      const changed = inputBlocks
        .map((block, i) => (block === outputBlocks[i] ? null : i))
        .filter((i) => i !== null);
      expect(changed).toEqual([1]);
      expect(outputBlocks[1]).toContain('two (2) years');
      // Untouched paragraphs keep their proofing markup and split runs.
      expect(outputBlocks[0]).toContain('proofErr');
      expect(outputBlocks[0]).toContain('w:rsidR="00AA0001"');
      expect(outputBlocks[2]).toContain('proofErr');
      expect(saveJson.blocks_restored).toBe(2);
    });

    await then('the archive is deflate-compressed with no directory entries', async () => {
      const entries = await inspectZipEntries(await fs.readFile(outPath));
      expect(entries.some((e) => e.isDirectory)).toBe(false);
      const doc = entries.find((e) => e.name === 'word/document.xml')!;
      expect(doc.compressedSize).toBeLessThan(doc.uncompressedSize);
    });
  });
});
