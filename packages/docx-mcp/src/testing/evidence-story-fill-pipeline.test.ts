/**
 * Evidence Story: DOCX Fill Pipeline
 *
 * This test demonstrates the canonical Safe DOCX editing pipeline end-to-end:
 *   1. Open a template document with placeholder text
 *   2. Replace placeholders with real values from a JSON payload
 *   3. Download the filled document
 *   4. Verify the output DOCX contains the expected content
 *
 * Allure artifacts attached:
 *   - JSON fill payload (syntax-highlighted)
 *   - Output DOCX file (binary attachment)
 *   - Before/after document content (text)
 */
import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import {
  itAllure as it,
  allureStep,
  allureAttachment,
  allureJsonAttachment,
  type AllureBddContext,
} from './allure-test.js';
import { replaceText } from '../tools/replace_text.js';
import { readFile } from '../tools/read_file.js';
import { download } from '../tools/download.js';
import {
  assertSuccess,
  openSession,
  registerCleanup,
} from './session-test-utils.js';
import { extractParaIdsFromToon } from './docx_test_utils.js';
import {
  allurePrettyJsonAttachment,
  allureFileAttachment,
  allureWordLikeTextAttachment,
} from '../../../../testing/allure-test-factory.js';

const test = it.epic('Document Editing').withLabels({
  feature: 'Evidence Story',
  tags: ['evidence-story', 'human-readable', 'fill-pipeline'],
  severity: 'critical',
  parameters: { audience: 'non-technical' },
});

/**
 * Sample fill payload representing a real-world document fill scenario.
 * This mirrors the pre-generated artifact at site/src/assets/evidence/docx-fill/input.json.
 */
const FILL_PAYLOAD = {
  template: 'service-agreement-v1',
  fields: {
    client_name: 'Acme Corporation',
    effective_date: '2026-01-15',
    service_description: 'AI-powered document automation platform',
    monthly_fee: '$4,500',
    payment_terms: 'Net 30',
    governing_law: 'State of Delaware',
    provider_name: 'Junior AI Corp',
    provider_signatory: 'Steven Obiajulu',
    provider_title: 'CEO',
  },
};

describe('Evidence Story: DOCX fill pipeline', () => {
  registerCleanup();

  test(
    'fills a template document with JSON payload and produces valid output',
    async ({ given, when, then, and }: AllureBddContext) => {
      let sessionResult: Awaited<ReturnType<typeof openSession>>;
      let paraIdMap: Record<string, string>;
      let outputPath: string;

      await given('a template document with placeholder fields', async () => {
        // Create a document with placeholder text that matches our fill payload
        sessionResult = await openSession([
          'SERVICE AGREEMENT',
          'Client: {{client_name}}',
          'Effective Date: {{effective_date}}',
          'Service Description: {{service_description}}',
          'Monthly Fee: {{monthly_fee}}',
          'Payment Terms: {{payment_terms}}',
          'Governing Law: {{governing_law}}',
          'Provider: {{provider_name}}',
          'Signatory: {{provider_signatory}}, {{provider_title}}',
        ], { prefix: 'safe-docx-evidence-fill-' });

        // Map paragraph IDs for each line
        const content = sessionResult.content;
        const paraIds = extractParaIdsFromToon(content);
        paraIdMap = {
          client_name: paraIds[1]!,
          effective_date: paraIds[2]!,
          service_description: paraIds[3]!,
          monthly_fee: paraIds[4]!,
          payment_terms: paraIds[5]!,
          governing_law: paraIds[6]!,
          provider_name: paraIds[7]!,
          signatory: paraIds[8]!,
        };

        // Attach the original template content
        await allureWordLikeTextAttachment(
          'Template document (before fill)',
          content,
          { title: 'Template with placeholders' },
        );
      });

      await and('a JSON fill payload', async () => {
        // Attach the fill payload as a syntax-highlighted JSON artifact
        await allurePrettyJsonAttachment('Fill payload (JSON)', FILL_PAYLOAD);
        await allureJsonAttachment('Fill payload (raw JSON)', FILL_PAYLOAD);
      });

      await when('each placeholder is replaced with its fill value', async () => {
        const { mgr, sessionId } = sessionResult;
        const fields = FILL_PAYLOAD.fields;

        // Replace each placeholder with its corresponding value
        const replacements: Array<{ paraId: string; old: string; new_: string; field: string }> = [
          { paraId: paraIdMap.client_name!, old: '{{client_name}}', new_: fields.client_name, field: 'client_name' },
          { paraId: paraIdMap.effective_date!, old: '{{effective_date}}', new_: fields.effective_date, field: 'effective_date' },
          { paraId: paraIdMap.service_description!, old: '{{service_description}}', new_: fields.service_description, field: 'service_description' },
          { paraId: paraIdMap.monthly_fee!, old: '{{monthly_fee}}', new_: fields.monthly_fee, field: 'monthly_fee' },
          { paraId: paraIdMap.payment_terms!, old: '{{payment_terms}}', new_: fields.payment_terms, field: 'payment_terms' },
          { paraId: paraIdMap.governing_law!, old: '{{governing_law}}', new_: fields.governing_law, field: 'governing_law' },
          { paraId: paraIdMap.provider_name!, old: '{{provider_name}}', new_: fields.provider_name, field: 'provider_name' },
          { paraId: paraIdMap.signatory!, old: '{{provider_signatory}}, {{provider_title}}', new_: `${fields.provider_signatory}, ${fields.provider_title}`, field: 'signatory' },
        ];

        for (const r of replacements) {
          const result = await allureStep(`Replace {{${r.field}}}`, async () => {
            return replaceText(mgr, {
              session_id: sessionId,
              target_paragraph_id: r.paraId,
              old_string: r.old,
              new_string: r.new_,
              instruction: `Fill template field: ${r.field}`,
            });
          });
          assertSuccess(result, `replace ${r.field}`);
        }
      });

      await and('the filled document is downloaded', async () => {
        outputPath = `${sessionResult.tmpDir}/filled-output.docx`;
        const saved = await download(sessionResult.mgr, {
          session_id: sessionResult.sessionId,
          save_to_local_path: outputPath,
          download_format: 'clean',
          clean_bookmarks: true,
        });
        assertSuccess(saved, 'download');

        // Attach the output DOCX as a binary artifact
        await allureFileAttachment(
          'Filled document (output.docx)',
          outputPath,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
      });

      await then('the output document contains all filled values', async () => {
        // Re-read the filled document to verify content
        const filledRead = await readFile(sessionResult.mgr, {
          session_id: sessionResult.sessionId,
          format: 'toon',
        });
        assertSuccess(filledRead, 'read filled');

        const filledContent = String(filledRead.content);

        // Attach the filled content
        await allureWordLikeTextAttachment(
          'Filled document content (after fill)',
          filledContent,
          { title: 'Document with filled values' },
        );

        // Verify each fill value appears in the output
        const fields = FILL_PAYLOAD.fields;
        expect(filledContent).toContain(fields.client_name);
        expect(filledContent).toContain(fields.effective_date);
        expect(filledContent).toContain(fields.service_description);
        expect(filledContent).toContain(fields.monthly_fee);
        expect(filledContent).toContain(fields.payment_terms);
        expect(filledContent).toContain(fields.governing_law);
        expect(filledContent).toContain(fields.provider_name);
        expect(filledContent).toContain(fields.provider_signatory);
        expect(filledContent).toContain(fields.provider_title);

        // Verify no placeholders remain
        expect(filledContent).not.toContain('{{');
        expect(filledContent).not.toContain('}}');
      });

      await and('the output file is a valid DOCX', async () => {
        const stats = await fs.stat(outputPath);
        expect(stats.size).toBeGreaterThan(0);

        // Verify it starts with a ZIP magic number (PK header)
        const buf = await fs.readFile(outputPath);
        expect(buf[0]).toBe(0x50); // 'P'
        expect(buf[1]).toBe(0x4b); // 'K'
      });

      await and('a summary of the fill operation is recorded', async () => {
        const summary = {
          template: FILL_PAYLOAD.template,
          fields_filled: Object.keys(FILL_PAYLOAD.fields).length,
          field_names: Object.keys(FILL_PAYLOAD.fields),
          all_placeholders_resolved: true,
          output_valid: true,
        };
        await allurePrettyJsonAttachment('Fill operation summary', summary);
      });
    },
  );
});
