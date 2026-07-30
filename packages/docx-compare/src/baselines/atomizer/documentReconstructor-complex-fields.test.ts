/**
 * Forced-rebuild evidence for unchanged complex-field ordered passthrough.
 *
 * The ECMA clauses identify the field structures and instructions. Preserving
 * their exact authored topology through comparison is a stronger SafeDocX
 * metamorphic invariant, not an ECMA-376 requirement.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.42
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.44
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.51
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import {
  buildDocxFromBodyXml,
  completeField,
  decoratedComplexField,
  FIELD_INSTRUCTIONS,
} from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const TEST_FEATURE = 'Document Reconstructor Complex Fields';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Ordered Complex Field Preservation In Rebuild',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.42' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.44' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.45' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.5.51' },
  );

function textRun(text: string): string {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

function paragraphWithId(
  paraId: string,
  content: string,
  prefix = 'w14',
): string {
  const namespace = prefix === 'w14' ? '' : ` xmlns:${prefix}="${OOXML.W14_NS}"`;
  return `<w:p${namespace} ${prefix}:paraId="${paraId}">${content}</w:p>`;
}

function fieldCharType(element: Element): string | null {
  const marker = Array.from(element.getElementsByTagNameNS(OOXML.W_NS, 'fldChar'))[0];
  return marker?.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
    marker?.getAttribute('w:fldCharType') ??
    null;
}

function fieldRanges(xml: string): Element[][] {
  const ranges: Element[][] = [];
  for (const paragraph of Array.from(parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'p'))) {
    const children = Array.from(paragraph.childNodes)
      .filter((child): child is Element => child.nodeType === 1);
    let active: Element[] | null = null;
    for (const child of children) {
      const kind = fieldCharType(child);
      if (kind === 'begin') active = [];
      if (active) active.push(child);
      if (kind === 'end' && active) {
        ranges.push(active);
        active = null;
      }
    }
  }
  return ranges;
}

function canonicalNode(node: Node): string {
  if (node.nodeType === 1) {
    const element = node as Element;
    const attributes = Array.from(element.attributes)
      .filter((attribute) =>
        attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' &&
        attribute.namespaceURI !== MC_NS)
      .map((attribute) =>
        `{${attribute.namespaceURI ?? ''}}${attribute.localName ?? attribute.name}=${JSON.stringify(attribute.value)}`,
      )
      .sort();
    return `E{${element.namespaceURI ?? ''}}${element.localName}[${attributes.join(',')}](` +
      Array.from(element.childNodes).map(canonicalNode).join('') + ')';
  }
  if (node.nodeType === 3 || node.nodeType === 4) return `T${JSON.stringify(node.nodeValue ?? '')}`;
  if (node.nodeType === 8) return `C${JSON.stringify(node.nodeValue ?? '')}`;
  return `N${node.nodeType}:${JSON.stringify(node.nodeValue ?? '')}`;
}

function canonicalRanges(xml: string): string[][] {
  return fieldRanges(xml).map((range) => range.map(canonicalNode));
}

async function compare(
  originalBody: string,
  revisedBody: string,
  lean = false,
) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  return compareDocumentsAtomizer(original, revised, {
    author: 'Issue 582 Test',
    date: new Date('2026-07-23T00:00:00Z'),
    reconstructionMode: 'rebuild',
    leanXmlVerifier: { enabled: lean },
  });
}

async function compareInplace(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  return compareDocumentsAtomizer(original, revised, {
    author: 'Issue 582 Test',
    date: new Date('2026-07-23T00:00:00Z'),
    reconstructionMode: 'inplace',
  });
}

async function outputXml(result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>): Promise<string> {
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

const decoratedFields = [
  { instruction: '\tPaGe   \\* MERGEFORMAT ', result: '7', anchor: '_Page' },
  { instruction: ' NUMPAGES \t\\# "0" ', result: '12', anchor: '_NumPages' },
  { instruction: ' ref Clause_1 \\h \\* MERGEFORMAT ', result: 'Section 1', anchor: 'Clause_1' },
  { instruction: FIELD_INSTRUCTIONS.PAGEREF, result: '42', anchor: '_Toc123' },
] as const;

function allDecoratedFields(): string {
  return decoratedFields
    .map(({ instruction, result, anchor }, index) =>
      decoratedComplexField(instruction, result, anchor) +
      (index === decoratedFields.length - 1 ? '' : textRun(' | ')))
    .join('');
}

describe('Forced rebuild preserves unchanged supported complex fields', () => {
  test
    .openspec('[SDX-FIELD-REBUILD-01] Outside edit preserves decorated supported fields')(
    'preserves PAGE, NUMPAGES, REF, and PAGEREF run topology during a same-paragraph edit',
    async ({ given, when, then, and }: AllureBddContext) => {
      const fields = allDecoratedFields();
      const originalBody = `<w:p>${textRun('Before ')}${fields}${textRun(' old tail')}</w:p>`;
      const revisedBody = `<w:p>${textRun('Before ')}${fields}${textRun(' new tail')}</w:p>`;
      let originalXml = '';
      let output = '';

      await given('four decorated complex fields with fragmented instructions and wrapped results', async () => {
        originalXml = await (await DocxArchive.load(
          await buildDocxFromBodyXml(originalBody),
        )).getDocumentXml();
      });
      await when('unrelated text in the same paragraph is compared through forced rebuild', async () => {
        output = await outputXml(await compare(originalBody, revisedBody));
      });
      await then('all four ordered field ranges match their original topology exactly once', () => {
        expect(canonicalRanges(output)).toEqual(canonicalRanges(originalXml));
        expect(fieldRanges(output)).toHaveLength(4);
        expect(Array.from(parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'hyperlink')))
          .toHaveLength(4);
        expect(Array.from(parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'rPr')))
          .toHaveLength(24);
      });
      await and('accept and reject projections retain only their intended outside text', () => {
        expect(extractTextWithParagraphs(acceptAllChanges(output))).toContain('new tail');
        expect(extractTextWithParagraphs(rejectAllChanges(output))).toContain('old tail');
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-01] Outside edit preserves decorated supported fields')(
    'allows unrelated direct-child insertion and deletion before an unchanged field',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', '_Page');
      const cases = [
        {
          name: 'insert before',
          original: `<w:p>${textRun('Stable ')}${field}${textRun(' tail')}</w:p>`,
          revised: `<w:p>${textRun('Stable ')}${textRun('inserted ')}${field}${textRun(' tail')}</w:p>`,
        },
        {
          name: 'delete before',
          original: `<w:p>${textRun('Stable ')}${textRun('deleted ')}${field}${textRun(' tail')}</w:p>`,
          revised: `<w:p>${textRun('Stable ')}${field}${textRun(' tail')}</w:p>`,
        },
      ];
      const outputs: string[] = [];

      await given('unchanged PAGE topology preceded by an unrelated direct paragraph child', () => {});
      await when('that sibling is inserted or deleted during forced rebuild', async () => {
        for (const scenario of cases) {
          outputs.push(await outputXml(await compare(scenario.original, scenario.revised)));
        }
      });
      await then('positional shifts do not alter field counterpart identity or topology', async () => {
        for (const [index, scenario] of cases.entries()) {
          const originalXml = await (await DocxArchive.load(
            await buildDocxFromBodyXml(scenario.original),
          )).getDocumentXml();
          expect(canonicalRanges(outputs[index]!)).toEqual(canonicalRanges(originalXml));
        }
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-02] Multiple fields preserve deterministic order')(
    'preserves multiple fields while rebuilding an edit in another paragraph',
    async ({ given, when, then }: AllureBddContext) => {
      const fields = allDecoratedFields();
      const originalBody =
        `<w:p>${textRun('Stable ')}${fields}</w:p><w:p>${textRun('Old second paragraph')}</w:p>`;
      const revisedBody =
        `<w:p>${textRun('Stable ')}${fields}</w:p><w:p>${textRun('New second paragraph')}</w:p>`;
      let output = '';

      await given('multiple unchanged fields in a paragraph separate from the edit', () => {});
      await when('the complete main story is rebuilt', async () => {
        output = await outputXml(await compare(originalBody, revisedBody));
      });
      await then('every field emits once in PAGE, NUMPAGES, REF, PAGEREF order', () => {
        expect(fieldRanges(output).map((range) =>
          range.flatMap((element) =>
            Array.from(element.getElementsByTagNameNS(OOXML.W_NS, 'instrText')))
            .map((element) => element.textContent ?? '')
            .join('')
            .trim()
            .split(/\s+/)[0]!
            .toUpperCase(),
        )).toEqual(['PAGE', 'NUMPAGES', 'REF', 'PAGEREF']);
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-01] Outside edit preserves decorated supported fields')(
      'preserves an unchanged REF field after an earlier paragraph is deleted',
      async ({
        given,
        when,
        then,
        and,
      }: AllureBddContext) => {
        const field = decoratedComplexField(FIELD_INSTRUCTIONS.REF, 'Section 1', 'Clause_1');
        const stableFieldParagraph = paragraphWithId('22222222', field, 'word14');
        const originalBody =
          paragraphWithId('11111111', textRun('Delete this unrelated paragraph.')) +
          stableFieldParagraph;
        const revisedBody = stableFieldParagraph;
        let output = '';

        await given(
          'an unchanged REF field whose Word paragraph identity survives an earlier deletion',
          () => {},
        );
        await when('the paragraph deletion is compared through forced rebuild', async () => {
          output = await outputXml(await compare(originalBody, revisedBody));
        });
        await then('the field retains its original ordered topology in its stable owner', async () => {
          const originalXml = await (await DocxArchive.load(
            await buildDocxFromBodyXml(originalBody),
          )).getDocumentXml();
          expect(canonicalRanges(output)).toEqual(canonicalRanges(originalXml));
          expect(fieldRanges(output)).toHaveLength(1);
        });
        await and('accept and reject projections retain the paragraph deletion', () => {
          expect(extractTextWithParagraphs(acceptAllChanges(output)))
            .not.toContain('Delete this unrelated paragraph.');
          expect(extractTextWithParagraphs(rejectAllChanges(output)))
            .toContain('Delete this unrelated paragraph.');
        });
      },
    );

  test
    .openspec('[SDX-FIELD-REBUILD-03] Unsafe field ownership fails closed')(
    'rejects changed, moved, nested, spanning, malformed, and shared ranges before reconstruction',
    async ({ given, when, then }: AllureBddContext) => {
      const page = decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', '_Page');
      const numPages = decoratedComplexField(FIELD_INSTRUCTIONS.NUMPAGES, '12', '_NumPages');
      const simplePage = completeField(FIELD_INSTRUCTIONS.PAGE, '7');
      const cases: Array<{ name: string; original: string; revised: string }> = [
        {
          name: 'result mutation',
          original: `<w:p>${page}</w:p>`,
          revised: `<w:p>${decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '8', '_Page')}</w:p>`,
        },
        {
          name: 'instruction mutation',
          original: `<w:p>${page}</w:p>`,
          revised: `<w:p>${decoratedComplexField(' page \\* MERGEFORMAT ', '7', '_Page')}</w:p>`,
        },
        {
          name: 'format mutation',
          original: `<w:p>${page}</w:p>`,
          revised: `<w:p>${page.replace('<w:b/>', '<w:i/>')}</w:p>`,
        },
        {
          name: 'wrapper attribute mutation',
          original: `<w:p>${page}</w:p>`,
          revised: `<w:p>${page.replace('w:history="1"', 'w:history="0"')}</w:p>`,
        },
        {
          name: 'inserted field',
          original: `<w:p>${textRun('plain')}</w:p>`,
          revised: `<w:p>${textRun('plain')}${page}</w:p>`,
        },
        {
          name: 'deleted field',
          original: `<w:p>${textRun('plain')}${page}</w:p>`,
          revised: `<w:p>${textRun('plain')}</w:p>`,
        },
        {
          name: 'reordered fields',
          original: `<w:p>${page}${numPages}</w:p>`,
          revised: `<w:p>${numPages}${page}</w:p>`,
        },
        {
          name: 'field moved to another paragraph',
          original:
            paragraphWithId('33333333', page) +
            paragraphWithId('44444444', textRun('plain')),
          revised:
            paragraphWithId('33333333', textRun('plain')) +
            paragraphWithId('44444444', page),
        },
        {
          name: 'nested field',
          original: `<w:p>${simplePage}</w:p>`,
          revised:
            `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
            simplePage +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        },
        {
          name: 'paragraph-spanning field',
          original: `<w:p>${simplePage}</w:p>`,
          revised:
            `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r></w:p>` +
            `<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        },
        {
          name: 'shared begin run',
          original: `<w:p>${simplePage}</w:p>`,
          revised:
            `<w:p><w:r><w:t>unrelated</w:t><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        },
        {
          name: 'tracked paragraph owner',
          original: `<w:p>${simplePage}</w:p>`,
          revised: `<w:ins w:id="9"><w:p>${simplePage}</w:p></w:ins>`,
        },
        {
          name: 'inline revision wrapper ownership',
          original: `<w:p>${simplePage}</w:p>`,
          revised: `<w:p><w:ins w:id="9" w:author="Reviewer">${simplePage}</w:ins></w:p>`,
        },
        {
          name: 'unmatched begin',
          original: `<w:p>${simplePage}</w:p>`,
          revised:
            `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r></w:p>`,
        },
      ];

      await given('adversarial supported-field shapes that violate bounded ownership', () => {});
      await when('each shape is compared through forced rebuild', async () => {
        for (const scenario of cases) {
          await expect(compare(scenario.original, scenario.revised), scenario.name)
            .rejects.toThrow(/Opaque passthrough:/);
        }
      });
      await then('none can reach lossy field reconstruction', () => {});
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-03] Unsafe field ownership fails closed')(
    'accepts REF separator switches only when the required argument is present',
    async ({ given, when, then }: AllureBddContext) => {
      const valid = decoratedComplexField(' REF Clause_1 \\d ":" ', 'Section:1', 'Clause_1');
      const invalid = completeField(' REF Clause_1 \\d ', 'Section 1');
      let output = '';

      await given('REF fields with valid and missing separator-switch arguments', () => {});
      await when('the valid field is rebuilt around an unrelated edit', async () => {
        output = await outputXml(await compare(
          `<w:p>${valid}${textRun(' old')}</w:p>`,
          `<w:p>${valid}${textRun(' new')}</w:p>`,
        ));
      });
      await then('the valid field is preserved and the missing argument fails closed', async () => {
        expect(fieldRanges(output)).toHaveLength(1);
        await expect(compare(
          `<w:p>${invalid}</w:p>`,
          `<w:p>${invalid}</w:p>`,
        )).rejects.toThrow(/unsupported REF field instruction shape/);
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-04] Inline SDT remains the sole owner')(
    'leaves a field wholly inside an unchanged inline SDT under SDT ownership',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.REF, 'Section 1', 'Clause_1');
      const sdt =
        `<w:sdt><w:sdtPr><w:id w:val="82"/></w:sdtPr>` +
        `<w:sdtContent>${field}</w:sdtContent></w:sdt>`;
      let output = '';

      await given('a supported complex field wholly owned by an unchanged inline SDT', () => {});
      await when('outside text changes in the containing paragraph', async () => {
        output = await outputXml(await compare(
          `<w:p>${sdt}${textRun(' old')}</w:p>`,
          `<w:p>${sdt}${textRun(' new')}</w:p>`,
        ));
      });
      await then('one SDT and one field range survive without duplicate emission', () => {
        expect(Array.from(parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'sdt'))).toHaveLength(1);
        expect(fieldRanges(output)).toHaveLength(0);
        expect(Array.from(parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'fldChar')))
          .toHaveLength(3);
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-04] Inline SDT remains the sole owner')(
    'retains source order when independent field and SDT owners are interleaved',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', '_Page');
      const sdt =
        `<w:sdt><w:sdtPr><w:id w:val="83"/></w:sdtPr>` +
        `<w:sdtContent>${textRun('controlled')}</w:sdtContent></w:sdt>`;
      let output = '';

      await given('an independent field owner before an unchanged inline SDT owner', () => {});
      await when('outside text changes after both owners', async () => {
        output = await outputXml(await compare(
          `<w:p>${field}${sdt}${textRun(' old')}</w:p>`,
          `<w:p>${field}${sdt}${textRun(' new')}</w:p>`,
        ));
      });
      await then('both owners emit exactly once in field-then-SDT order', () => {
        const paragraph = parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'p')[0]!;
        const children = Array.from(paragraph.childNodes)
          .filter((child): child is Element => child.nodeType === 1);
        expect(children.findIndex((child) => fieldCharType(child) === 'begin'))
          .toBeLessThan(children.findIndex((child) => child.localName === 'sdt'));
        expect(fieldRanges(output)).toHaveLength(1);
        expect(Array.from(parseXml(output).getElementsByTagNameNS(OOXML.W_NS, 'sdt'))).toHaveLength(1);
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-05] Inplace and Lean boundaries remain unchanged')(
    'does not engage ordered-range capture for direct inplace comparison',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', '_Page');
      const originalBody = `<w:p>${textRun('Before ')}${field}${textRun(' old')}</w:p>`;
      const revisedBody = `<w:p>${textRun('Before ')}${field}${textRun(' new')}</w:p>`;
      let result: Awaited<ReturnType<typeof compareDocumentsAtomizer>>;
      let revisedXml = '';
      let output = '';

      await given('an unchanged fragmented PAGE field and an outside text edit', async () => {
        revisedXml = await (await DocxArchive.load(
          await buildDocxFromBodyXml(revisedBody),
        )).getDocumentXml();
      });
      await when('comparison is requested directly in inplace mode', async () => {
        result = await compareInplace(originalBody, revisedBody);
        output = await (await DocxArchive.load(result.document)).getDocumentXml();
      });
      await then('inplace remains selected and retains its established revised field topology', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(canonicalRanges(output)).toEqual(canonicalRanges(revisedXml));
      });
    },
  );

  test
    .openspec('[SDX-FIELD-REBUILD-05] Inplace and Lean boundaries remain unchanged')(
    'reports Lean rebuild evidence as not applicable',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.PAGE, '7', '_Page');
      let status: string | undefined;

      await given('a forced rebuild with the compiled Lean verifier requested', () => {});
      await when('the comparison certificate is assembled', async () => {
        const result = await compare(
          `<w:p>${field}${textRun(' old')}</w:p>`,
          `<w:p>${field}${textRun(' new')}</w:p>`,
          true,
        );
        status = result.documentIntegrity?.status;
      });
      await then('the Lean evidence remains explicitly outside rebuild scope', () => {
        expect(status).toBe('not_applicable');
      });
    },
  );

  test
    .openspec('[SDX-FIELD-CONFORMANCE-01] REF and PAGEREF claims are bounded')(
    'keeps rebuild claims bounded while naming the separate scoped evaluator',
    async ({ given, when, then }: AllureBddContext) => {
      let registry = '';

      await given('the machine-readable ECMA-376 registry', () => {});
      await when('the REF and PAGEREF entries are read', () => {
        registry = readFileSync(
          join(import.meta.dirname, '../../../../../spec-compliance/registry/ecma-376.md'),
          'utf8',
        );
      });
      await then('the entries distinguish bounded rebuild from scoped refresh', () => {
        expect(registry).toContain('[ECMA-PART1-17-16-5-45]');
        expect(registry).toContain('[ECMA-PART1-17-16-5-51]');
        expect(registry).toContain('unchanged-rebuild invariant does not claim');
        expect(registry).toContain('scoped refresh primitive');
        expect(registry).toContain('complete field-engine equivalence');
      });
    },
  );

  test
    .openspec('[SDX-FIELD-CONFORMANCE-02] Executable evidence names the verification boundary')(
    'keeps rebuild topology outside the Lean certificate claim',
    async ({ given, when, then }: AllureBddContext) => {
      const field = decoratedComplexField(FIELD_INSTRUCTIONS.REF, 'Section 1', 'Clause_1');
      let reason: string | undefined;

      await given('a supported field rebuild with Lean evidence enabled', () => {});
      await when('the document-integrity certificate is returned', async () => {
        const result = await compare(
          `<w:p>${field}${textRun(' old')}</w:p>`,
          `<w:p>${field}${textRun(' new')}</w:p>`,
          true,
        );
        reason = result.documentIntegrity?.reason;
      });
      await then('the certificate says fixed-story verification covers inplace output only', () => {
        expect(reason).toContain('inplace comparison output only');
      });
    },
  );
});
