import { describe, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { compareSourceProjectedFormattingFidelity } from './formattingFidelity.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Paragraph merge release gate' });
const reader = process.env.SAFE_DOCX_NOTE_READER_REQUIRED === '1' ? describe : describe.skip;
reader('independent paragraph merge release readiness', () => {
  test.openspec('Reader agreement does not bypass native formatting failure')(
    'rejects an injected native formatting failure despite measured reader, schema and text agreement',
    async () => {
      const first = '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>FIRST</w:t></w:r></w:p>';
      const second = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>SECOND</w:t></w:r></w:p>';
      const original = await buildDocxFromBodyXml(first + second);
      const revised = await buildDocxFromBodyXml(second);
      const options = { author: 'Comparator', date: new Date('2026-09-17T00:00:00Z'), moveDetection: { detectMoves: false } };
      const candidate = await compareDocumentsAtomizer(original, revised, options);
      const { runLibreOfficeOracle } = await import('../../../docx-core/dist/integration/libreoffice-oracle.js');
      const states = await runLibreOfficeOracle([
        { op: 'identity', docx: original, saveAs: 'odt' }, { op: 'identity', docx: revised, saveAs: 'odt' },
        { op: 'accept', docx: candidate.document, saveAs: 'odt' }, { op: 'reject', docx: candidate.document, saveAs: 'odt' },
      ]);
      const T = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
      const project = (xml: string) => Array.from(parseXml(xml).getElementsByTagName('*'))
        .filter(n => n.namespaceURI === T && ['p', 'h'].includes(n.localName)).map(n => n.textContent);
      expect(project(states[0]!)).toEqual(['FIRST', 'SECOND']);
      expect(project(states[1]!)).toEqual(['SECOND']);
      expect(project(states[2]!)).toEqual(project(states[1]!));
      expect(project(states[3]!)).toEqual(project(states[0]!));

      const artifacts = await mkdtemp(join(tmpdir(), 'safe-docx-reader-release-gate-'));
      const path = join(artifacts, 'candidate.docx');
      await writeFile(path, candidate.document);
      const schema = spawnSync(process.execPath, [
        fileURLToPath(new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url)),
        '--self-test', path,
      ], { encoding: 'utf8' });
      expect(schema.error).toBeUndefined();
      expect(schema.status, schema.stderr).toBe(0);
      expect(schema.stdout).toContain('self-test passed');
      expect(schema.stdout).toContain('1 of 1 document.xml instances validate');

      // Fault-injection tests the readiness decision, not a claim that today's
      // native projector disagrees with this reader-confirmed candidate.
      // The singleton failedChecks assertion proves text/schema-style safety
      // success cannot override a failed native formatting vote.
      for (const detectFormatChanges of [true, false]) {
        await expect(compareDocumentsAtomizer(original, revised, {
          ...options, formatDetection: { detectFormatChanges },
          taggedTreeFormattingFidelityEvaluator: (oldXml, newXml, candidateXml) => {
            const measured = compareSourceProjectedFormattingFidelity(oldXml, newXml, candidateXml);
            expect(measured.score).toBe(1);
            return { ...measured, score: 0, accept: { ...measured.accept, score: 0 }, reject: { ...measured.reject, score: 0 } };
          },
        })).rejects.toMatchObject({
          name: 'TaggedPublicationSafetyError',
          failedChecks: ['formattingFidelity'],
          checks: expect.objectContaining({ formattingFidelity: false }),
          formattingFidelity: expect.objectContaining({ score: 0 }),
        });
      }
    }, 120000,
  );
});
