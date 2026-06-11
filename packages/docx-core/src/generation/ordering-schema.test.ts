import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { PPR_ORDER, RPR_ORDER, SECTPR_ORDER, TBLPR_ORDER, TCPR_ORDER } from './ordering.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WML_XSD_PATH = path.resolve(__dirname, '../../../../spec-compliance/ecma-376/schemas/transitional/wml.xsd');

/**
 * Extract child element local names, in declaration order, from a named
 * complexType or group in the vendored WML schema. Declaration order inside
 * the type body is the schema's canonical property order (sequences enforce
 * it outright; the transitional EG_RPrBase choice still lists members in
 * canonical order).
 */
function schemaChildOrder(xsd: string, kind: 'complexType' | 'group', name: string): string[] {
  const open = new RegExp(`<xsd:${kind} name="${name}">`);
  const startMatch = open.exec(xsd);
  if (!startMatch) throw new Error(`schema ${kind} '${name}' not found`);
  const close = `</xsd:${kind}>`;
  const end = xsd.indexOf(close, startMatch.index);
  if (end < 0) throw new Error(`schema ${kind} '${name}' has no close tag`);
  const body = xsd.slice(startMatch.index, end);

  const names: string[] = [];
  const elementRe = /<xsd:element (?:name|ref)="(?:w:)?([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = elementRe.exec(body))) {
    if (!names.includes(m[1]!)) names.push(m[1]!);
  }
  // Inline groups referenced from the body (e.g. CT_PPrBase pulls EG_RPrBase? no,
  // but CT_PPr extends CT_PPrBase) are resolved by callers via concatenation.
  return names;
}

function expectSubsequence(table: readonly string[], schemaOrder: string[], label: string): void {
  const filtered = schemaOrder.filter((name) => table.includes(name));
  const missing = table.filter((name) => !schemaOrder.includes(name));
  expect(missing, `${label}: ordering-table entries missing from schema declaration: ${missing.join(', ')}`).toEqual([]);
  expect(filtered, `${label}: table order must match schema declaration order`).toEqual([...table]);
}

describe('Traceability: property-order tables vs vendored schema', () => {
  test
    .openspec('[SDX-GEN-043] property-order tables match the vendored schema')
    .conformance(
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.1.26' },
      { spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.2.28' },
    )(
    'Scenario: property-order tables match the vendored schema',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let xsd!: string;
      await given('the vendored transitional WML schema', async () => {
        xsd = readFileSync(WML_XSD_PATH, 'utf-8');
        expect(xsd.length).toBeGreaterThan(100_000);
      });

      let orders!: Record<string, string[]>;
      await when('the declared child order is extracted for each property container', async () => {
        orders = {
          // CT_PPr extends CT_PPrBase with rPr + sectPr (+ pPrChange) at the end.
          pPr: [...schemaChildOrder(xsd, 'complexType', 'CT_PPrBase'), ...schemaChildOrder(xsd, 'complexType', 'CT_PPr')],
          rPr: schemaChildOrder(xsd, 'group', 'EG_RPrBase'),
          // CT_SectPr pulls EG_HdrFtrReferences first, then the shared
          // EG_SectPrContents group that holds the property sequence.
          sectPr: ['headerReference', 'footerReference', ...schemaChildOrder(xsd, 'group', 'EG_SectPrContents')],
          tblPr: schemaChildOrder(xsd, 'complexType', 'CT_TblPrBase'),
          tcPr: schemaChildOrder(xsd, 'complexType', 'CT_TcPrBase'),
        };
        await attachPrettyJson('schema-declared-orders', orders);
      });

      await then('every ordering table is a subsequence of the schema order', async () => {
        expectSubsequence(PPR_ORDER, orders.pPr!, 'PPR_ORDER');
        expectSubsequence(RPR_ORDER, orders.rPr!, 'RPR_ORDER');
        expectSubsequence(SECTPR_ORDER, orders.sectPr!, 'SECTPR_ORDER');
        expectSubsequence(TBLPR_ORDER, orders.tblPr!, 'TBLPR_ORDER');
        expectSubsequence(TCPR_ORDER, orders.tcPr!, 'TCPR_ORDER');
      });
    },
  );
});
