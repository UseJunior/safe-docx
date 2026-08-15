import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { testAllure } from './allure-test.js';

interface Snapshot {
  schemaVersion: number;
  oracle: { name: string; package: string; version: string };
  fieldCases: Array<{ id: string; originalSha256: string; revisedSha256: string; outputDocumentXmlSha256: string; classification: string; deletedFldChars: number; insertedFldChars: number; outsideRevisionFldChars: number; deletedInstruction: string; insertedInstruction: string; deletedText: string; insertedText: string }>;
}

interface IlpaMeasurements {
  provenance: { originalSha256: string; revisedSha256: string; wordVersion: string; asposeVersion: string };
  observations: Record<string, any>;
}

const repoRoot = resolve(import.meta.dirname, '../../../..');
const snapshot = JSON.parse(readFileSync(resolve(import.meta.dirname, 'oracles/aspose-field-oracle.v1.json'), 'utf8')) as Snapshot;
const ilpa = JSON.parse(readFileSync(resolve(import.meta.dirname, 'oracles/word-aspose-ilpa-measurements.v1.json'), 'utf8')) as IlpaMeasurements;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const TEST_FEATURE = 'Add Aspose Field Differential Oracle';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

describe('Aspose field differential oracle trust boundary', () => {
  test.openspec('[ASPOSE-FIELD-01] Instruction changes replace the complete complex field')('classifies all instruction changes as whole-field replacement', () => {
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.oracle).toMatchObject({ package: 'aspose-words', version: '25.10' });
    const expected = {
      'formcheckbox-to-formtext': [' FORMCHECKBOX ', ' FORMTEXT ', '☐', 'value'],
      'hyperlink-retarget': [' HYPERLINK "https://old.example" ', ' HYPERLINK "https://new.example" ', 'link', 'link'],
      'pageref-retarget': [' PAGEREF Old \\h ', ' PAGEREF New \\h ', '3', '3'],
    } as const;
    for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
      const verdict = snapshot.fieldCases.find((entry) => entry.id === id);
      expect(verdict).toMatchObject({
        classification: 'whole-field-replacement', deletedFldChars: 3,
        insertedFldChars: 3, outsideRevisionFldChars: 0,
        deletedInstruction: expected[id][0], insertedInstruction: expected[id][1],
        deletedText: expected[id][2], insertedText: expected[id][3],
      });
      expect(verdict?.outputDocumentXmlSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test.openspec('[ASPOSE-FIELD-02] A cached-result-only change preserves field scaffolding')('classifies the NUMPAGES cache update as result-only', () => {
    const verdict = snapshot.fieldCases.find((entry) => entry.id === 'numpages-result-only');
    expect(verdict).toMatchObject({ classification: 'cached-result-only', deletedFldChars: 0, insertedFldChars: 0, outsideRevisionFldChars: 3, deletedText: '3', insertedText: '4' });
  });

  test.openspec('[ASPOSE-FIELD-03] CI validates evidence without Aspose or its license')('validates committed provenance using only repository files', () => {
    expect(snapshot.fieldCases).toHaveLength(4);
    expect(ilpa.provenance.originalSha256).toBe(hash(resolve(repoRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx')));
    expect(ilpa.provenance.revisedSha256).toBe(hash(resolve(repoRoot, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx')));
    const checked = spawnSync('python3', [resolve(repoRoot, 'scripts/aspose_field_oracle.py'), '--output', resolve(import.meta.dirname, 'oracles/aspose-field-oracle.v1.json'), '--check'], { encoding: 'utf8' });
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain('verified without importing Aspose');
    const selfTest = spawnSync('python3', [resolve(repoRoot, 'scripts/aspose_field_oracle.py'), '--output', resolve(import.meta.dirname, 'oracles/aspose-field-oracle.v1.json'), '--self-test'], { encoding: 'utf8' });
    expect(selfTest.status, selfTest.stderr).toBe(0);
    expect(selfTest.stdout).toContain('projection self-test passed without importing Aspose');
  });

  test.openspec('[ASPOSE-FIELD-04] Local oracle configuration has a fail-closed trust boundary')('contains no license configuration or secret material', () => {
    expect(snapshot).not.toHaveProperty('license');
    expect(JSON.stringify(snapshot)).not.toMatch(/\.lic|SAFE_DOCX_ASPOSE_LICENSE/);
  });

  test.openspec('[ASPOSE-FIELD-04] Local oracle configuration has a fail-closed trust boundary')('skips absent configuration and rejects partial configuration without writing', () => {
    const output = resolve(mkdtempSync(resolve(tmpdir(), 'aspose-oracle-boundary-')), 'snapshot.json');
    const script = resolve(repoRoot, 'scripts/aspose_field_oracle.py');
    const cleanEnv = { ...process.env };
    delete cleanEnv.SAFE_DOCX_ASPOSE_PYTHON;
    delete cleanEnv.SAFE_DOCX_ASPOSE_LICENSE;
    const skipped = spawnSync('python3', [script, '--output', output], { encoding: 'utf8', env: cleanEnv });
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toContain('SKIP:');
    expect(existsSync(output)).toBe(false);

    const rejected = spawnSync('python3', [script, '--output', output], {
      encoding: 'utf8',
      env: { ...cleanEnv, SAFE_DOCX_ASPOSE_PYTHON: '/private/nonexistent-aspose-python' },
    });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain('both SAFE_DOCX_ASPOSE_PYTHON and SAFE_DOCX_ASPOSE_LICENSE are required');
    expect(rejected.stderr).not.toContain('/private/nonexistent-aspose-python');
    expect(existsSync(output)).toBe(false);

    const rejectedInvalidPaths = spawnSync('python3', [script, '--output', output], {
      encoding: 'utf8',
      env: { ...cleanEnv, SAFE_DOCX_ASPOSE_PYTHON: '/private/nonexistent-aspose-python', SAFE_DOCX_ASPOSE_LICENSE: '/private/nonexistent-license.lic' },
    });
    expect(rejectedInvalidPaths.status).toBe(2);
    expect(rejectedInvalidPaths.stderr).not.toContain('/private/nonexistent');
  });

  test.openspec('[ASPOSE-FIELD-05] The ILPA trust boundary records agreement and divergence')('pins the dated manual measurement record and its authority boundary', () => {
    const measured = ilpa.observations;
    expect(ilpa.provenance).toMatchObject({ wordVersion: '16.112', asposeVersion: '25.10' });
    expect(measured.wholeFieldDeletion).toMatchObject({ agreement: true, wordFldCharsInsideDeletion: 174, asposeFldCharsInsideDeletion: 45 });
    expect(measured.parentheticalEnumerator1471.agreement).toBe(true);
    expect(measured.boldToNotBold1555).toMatchObject({ agreement: true, shape: 'rPrChange', oracleDocumentCounts: { word: 34, aspose: 31 } });
    expect(measured.givebackBoundary).toMatchObject({ agreement: false, authority: 'word' });
  });
});
