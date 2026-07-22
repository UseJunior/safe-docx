/**
 * Forced-rebuild evidence for the bounded inline-SDT opaque-passthrough pilot.
 *
 * The focused fixtures are synthetic because the checked-in real documents
 * contain block-level cover-page SDTs, not inline controls. The final test keeps
 * that real corpus measurement separate and does not relabel it as inline proof.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.36
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import {
  CorrelationStatus,
  DocxArchive,
  OOXML,
  parseXml,
  type ComparisonUnitAtom,
  type OpaquePassthroughNode,
} from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { renderOpaqueAtomSequence } from './opaquePassthrough.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';

const EXT_NS = 'urn:safe-docx:test:opaque-extension';
const ALT_EXT_NS = 'urn:safe-docx:test:opaque-extension-alias';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Document Reconstructor Inline SDT',
    story: 'Opaque Inline Content Control Preservation In Rebuild',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.31' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.36' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
  );

function textRun(text: string, props = ''): string {
  return `<w:r>${props}<w:t>${text}</w:t></w:r>`;
}

function inlineSdt(
  id: string,
  controlledRuns: string,
  options: { prefix?: string; localNamespace?: boolean } = {},
): string {
  const prefix = options.prefix ?? 'ext';
  const namespace = prefix === 'alt' ? ALT_EXT_NS : EXT_NS;
  const local = options.localNamespace
    ? ` xmlns:${prefix}="${namespace}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="${prefix}"`
    : '';
  return (
    `<w:sdt${local} ${prefix}:flag="preserve-${id}">` +
    `<w:sdtPr>` +
    `<w:alias w:val="Control ${id}"/>` +
    `<w:id w:val="${id}"/>` +
    `<${prefix}:properties>` +
    `<${prefix}:first ${prefix}:ordinal="1">alpha</${prefix}:first>` +
    `<${prefix}:second><${prefix}:payload>beta</${prefix}:payload></${prefix}:second>` +
    `</${prefix}:properties>` +
    `</w:sdtPr>` +
    `<w:sdtContent>${controlledRuns}</w:sdtContent>` +
    `</w:sdt>`
  );
}

function paragraph(before: string, controls: string, after: string): string {
  return `<w:p>${textRun(before)}${controls}${textRun(after)}</w:p>`;
}

async function packageFor(body: string, rootAlias = false): Promise<Buffer> {
  return buildDocxFromBodyXml(
    body,
    [],
    rootAlias
      ? {
          namespaces: { ext: EXT_NS, alt: ALT_EXT_NS },
          ignorablePrefixes: ['ext', 'alt'],
        }
      : {},
  );
}

async function forcedRebuild(original: Buffer, revised: Buffer): Promise<string> {
  const result = await compareDocumentsAtomizer(original, revised, {
    author: 'Issue 582 Test',
    date: new Date('2026-07-22T00:00:00Z'),
    reconstructionMode: 'rebuild',
  });
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function elementsByName(xml: string, namespaceUri: string, localName: string): Element[] {
  return Array.from(parseXml(xml).getElementsByTagNameNS(namespaceUri, localName));
}

function directElementNames(element: Element): string[] {
  return Array.from(element.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .map((node) => `{${node.namespaceURI}}${node.localName}`);
}

describe('Forced rebuild preserves unchanged inline content controls', () => {
  test
    .openspec('[SDX-SDT-01] Same-paragraph outside edit retains the complete inline SDT on forced rebuild')(
    'applies an outside text edit and retains controlled content and ordered properties',
    async ({ given, when, then, and }: AllureBddContext) => {
      const control = inlineSdt('41', `${textRun('Controlled ')}${textRun('value', '<w:rPr><w:b/></w:rPr>')}`, {
        localNamespace: true,
      });
      let output = '';

      await given('a synthetic existing DOCX with an inline SDT between ordinary runs', () => {});
      await when('an unrelated run in the same paragraph is edited through forced rebuild', async () => {
        output = await forcedRebuild(
          await packageFor(paragraph('Before ', control, ' old outside')),
          await packageFor(paragraph('Before ', control, ' new outside')),
        );
      });
      await then('the SDT is emitted once with controlled text and ordered property payload intact', () => {
        const controls = elementsByName(output, OOXML.W_NS, 'sdt');
        expect(controls).toHaveLength(1);
        expect(controls[0]!.textContent).toContain('Controlled value');
        expect(directElementNames(controls[0]!)).toEqual([
          `{${OOXML.W_NS}}sdtPr`,
          `{${OOXML.W_NS}}sdtContent`,
        ]);
        const properties = elementsByName(output, EXT_NS, 'properties')[0]!;
        expect(directElementNames(properties)).toEqual([
          `{${EXT_NS}}first`,
          `{${EXT_NS}}second`,
        ]);
        expect(properties.getElementsByTagNameNS(EXT_NS, 'payload')[0]!.textContent).toBe('beta');
      });
      await and('accept and reject projections apply only the intentional outside edit', () => {
        const acceptedText = extractTextWithParagraphs(acceptAllChanges(output));
        const rejectedText = parseXml(rejectAllChanges(output)).documentElement.textContent;
        expect(acceptedText).toContain('new outside');
        expect(acceptedText).not.toContain('old outside');
        expect(rejectedText).toContain('old outside');
        expect(rejectedText).not.toContain('new outside');
      });
    },
  );

  test
    .openspec('[SDX-SDT-02] Multiple and split-run inline controls retain deterministic paragraph order')(
    'emits split-run sibling controls once and in order among ordinary runs',
    async ({ given, when, then }: AllureBddContext) => {
      const first = inlineSdt('1', textRun('First') + textRun(' control'));
      const second = inlineSdt('2', textRun('Second') + textRun(' control'));
      const originalBody = paragraph('Lead ', `${first}${textRun(' middle ')}${second}`, ' old tail');
      const revisedBody = paragraph('Lead ', `${first}${textRun(' middle ')}${second}`, ' new tail');
      let output = '';

      await given('two inline controls with controlled text split across valid runs', () => {});
      await when('the containing paragraph is rebuilt after an outside edit', async () => {
        output = await forcedRebuild(await packageFor(originalBody, true), await packageFor(revisedBody, true));
      });
      await then('both controls appear once in their original text order', () => {
        const controls = elementsByName(output, OOXML.W_NS, 'sdt');
        expect(controls).toHaveLength(2);
        expect(controls.map((control) =>
          control.getElementsByTagNameNS(OOXML.W_NS, 'sdtContent')[0]!.textContent,
        )).toEqual(['First control', 'Second control']);
        const acceptedText = extractTextWithParagraphs(acceptAllChanges(output));
        expect(acceptedText).toContain('Lead First control middle Second control new tail');
      });
    },
  );

  test
    .openspec('[SDX-SDT-01] Same-paragraph outside edit retains the complete inline SDT on forced rebuild')(
    'uses the opaque paragraph identity when all surrounding text is replaced',
    async ({ given, when, then }: AllureBddContext) => {
      const control = inlineSdt('42', textRun('Stable controlled anchor'), { localNamespace: true });
      let output = '';

      await given('a control whose surrounding paragraph text has no useful lexical overlap', () => {});
      await when('the entire ordinary prefix and suffix are replaced in the same paragraph slot', async () => {
        output = await forcedRebuild(
          await packageFor(paragraph(
            'Original surrounding language alpha beta gamma delta. ',
            control,
            ' Former ending epsilon zeta eta theta.',
          )),
          await packageFor(paragraph(
            'Replacement context one two three four. ',
            control,
            ' New conclusion five six seven eight.',
          )),
        );
      });
      await then('the control remains matched while accept and reject retain their respective surroundings', () => {
        expect(elementsByName(output, OOXML.W_NS, 'sdt')).toHaveLength(1);
        const accepted = extractTextWithParagraphs(acceptAllChanges(output));
        const rejected = extractTextWithParagraphs(rejectAllChanges(output));
        expect(accepted).toContain('Replacement context one two three four. Stable controlled anchor');
        expect(accepted).not.toContain('Original surrounding language');
        expect(rejected).toContain('Original surrounding language alpha beta gamma delta. Stable controlled anchor');
        expect(rejected).not.toContain('Replacement context');
      });
    },
  );

  test
    .openspec('[SDX-SDT-03] Opaque namespace ownership preserves root, local, and aliased bindings')(
    'retains root and local namespace ownership plus extension prefix aliases',
    async ({ given, when, then, and }: AllureBddContext) => {
      const rootBound = inlineSdt('7', textRun('Root bound'));
      const localAlias = inlineSdt('8', textRun('Local alias'), { prefix: 'alt', localNamespace: true });
      let output = '';

      await given('one root-bound extension prefix and one locally declared alias', () => {});
      await when('the paragraph is reconstructed from atoms', async () => {
        output = await forcedRebuild(
          await packageFor(paragraph('A ', `${rootBound}${textRun(' / ')}${localAlias}`, ' old'), true),
          await packageFor(paragraph('A ', `${rootBound}${textRun(' / ')}${localAlias}`, ' new'), true),
        );
      });
      await then('namespace-aware extension nodes retain their original namespace URIs', () => {
        expect(elementsByName(output, EXT_NS, 'properties')).toHaveLength(1);
        expect(elementsByName(output, ALT_EXT_NS, 'properties')).toHaveLength(1);
      });
      await and('every ignorable token remains effectively bound on its SDT boundary', () => {
        const document = parseXml(output);
        const controls = Array.from(document.getElementsByTagNameNS(OOXML.W_NS, 'sdt'));
        expect(document.documentElement.getAttributeNS(
          'http://schemas.openxmlformats.org/markup-compatibility/2006',
          'Ignorable',
        )).toContain('ext');
        expect(controls[0]!.lookupNamespaceURI('ext')).toBe(EXT_NS);
        expect(controls[1]!.getAttributeNS(
          'http://schemas.openxmlformats.org/markup-compatibility/2006',
          'Ignorable',
        )).toContain('alt');
        expect(controls[1]!.lookupNamespaceURI('alt')).toBe(ALT_EXT_NS);
      });
    },
  );

  test
    .openspec('[SDX-SDT-03] Opaque namespace ownership preserves root, local, and aliased bindings')(
    'allows descendant-local extension bindings and legal prefix shadowing',
    async ({ given, when, then }: AllureBddContext) => {
      const control =
        `<w:sdt xmlns:ext="${EXT_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
        `mc:Ignorable="ext" ext:flag="outer">` +
        `<w:sdtPr><w:id w:val="91"/><ext:properties>` +
        `<ext:payload xmlns:ext="${ALT_EXT_NS}" mc:Ignorable="ext" ext:sentinel="inner">` +
        `<ext:nested>subtree-local</ext:nested></ext:payload>` +
        `</ext:properties></w:sdtPr><w:sdtContent>${textRun('Scoped control')}</w:sdtContent></w:sdt>`;
      let output = '';

      await given('an opaque subtree that legally rebinds its extension prefix below the SDT boundary', () => {});
      await when('an outside edit forces paragraph reconstruction', async () => {
        output = await forcedRebuild(
          await packageFor(paragraph('A ', control, ' old')),
          await packageFor(paragraph('A ', control, ' new')),
        );
      });
      await then('outer and descendant-local namespace ownership both survive', () => {
        expect(elementsByName(output, EXT_NS, 'properties')).toHaveLength(1);
        const payload = elementsByName(output, ALT_EXT_NS, 'payload')[0]!;
        expect(payload.getAttributeNS(ALT_EXT_NS, 'sentinel')).toBe('inner');
        expect(payload.getElementsByTagNameNS(ALT_EXT_NS, 'nested')[0]!.textContent).toBe('subtree-local');
        expect(payload.lookupNamespaceURI('ext')).toBe(ALT_EXT_NS);
      });
    },
  );
});

describe('Opaque inline content controls fail closed', () => {
  test
    .openspec('[SDX-SDT-04] Unsafe opaque payload fails closed')(
    'rejects mutation, removal, reorder, nesting, and unbound MCE ownership',
    async ({ given, then }: AllureBddContext) => {
      const stable = inlineSdt('1', textRun('Stable'), { localNamespace: true });
      const changed = inlineSdt('1', textRun('Changed'), { localNamespace: true });
      const second = inlineSdt('2', textRun('Second'), { localNamespace: true });
      const nested = inlineSdt('3', inlineSdt('4', textRun('Nested'), { localNamespace: true }), {
        localNamespace: true,
      });
      const unbound = stable.replace('mc:Ignorable="ext"', 'mc:Ignorable="ghost"');
      const unboundUsage = stable
        .replace('<ext:first ext:ordinal="1">', '<ghost:first>')
        .replace('</ext:first>', '</ghost:first>');
      const empty = inlineSdt('5', '', { localNamespace: true });
      const collision = stable.replace(
        '<w:sdt',
        `<x:sdt xmlns:x="${OOXML.W_NS}" xmlns:w="urn:safe-docx:test:collision"`,
      ).replace('</w:sdt>', '</x:sdt>');
      const cases: Array<[string, string, string, RegExp?]> = [
        ['controlled mutation', paragraph('A ', stable, ' Z'), paragraph('A ', changed, ' Z')],
        ['removed counterpart', paragraph('A ', stable, ' Z'), paragraph('A ', '', ' Z')],
        ['reordered controls', paragraph('A ', stable + second, ' Z'), paragraph('A ', second + stable, ' Z')],
        ['nested boundaries', paragraph('A ', nested, ' Z'), paragraph('A ', nested, ' Z')],
        ['unbound ignorable prefix', paragraph('A ', unbound, ' Z'), paragraph('A ', unbound, ' Z')],
        [
          'unbound descendant usage',
          paragraph('A ', unboundUsage, ' Z'),
          paragraph('A ', unboundUsage, ' Z'),
          /Opaque passthrough:|NamespaceError:/,
        ],
        ['conflicting namespace ownership', paragraph('A ', collision, ' Z'), paragraph('A ', collision, ' Z')],
        ['no atomizable controlled content', paragraph('A ', empty, ' Z'), paragraph('A ', empty, ' Z')],
      ];

      await given('opaque payload shapes that cannot be safely re-emitted', () => {});
      await then('every unsafe shape rejects instead of producing a partial SDT', async () => {
        for (const [name, originalBody, revisedBody, expectedError = /Opaque passthrough:/] of cases) {
          await expect(
            forcedRebuild(await packageFor(originalBody), await packageFor(revisedBody)),
            name,
          ).rejects.toThrow(expectedError);
        }
      });
    },
  );

  test
    .openspec('[SDX-SDT-04] Unsafe opaque payload fails closed')(
    'rejects paragraph movement before correlation can flatten the control',
    async ({ given, then }: AllureBddContext) => {
      const control = inlineSdt('73', textRun('Move-sensitive control'), { localNamespace: true });
      const controlledParagraph = paragraph('Controlled ', control, ' tail');
      const ordinaryParagraph = paragraph('Ordinary paragraph', '', '');

      await given('an unchanged control whose owning paragraph changes source-order position', () => {});
      await then('forced rebuild rejects the unsupported movement before emitting document XML', async () => {
        await expect(forcedRebuild(
          await packageFor(controlledParagraph + ordinaryParagraph),
          await packageFor(ordinaryParagraph + controlledParagraph),
        )).rejects.toThrow(/changed paragraph ownership, moved, or mutated/);
      });
    },
  );

  test
    .openspec('[SDX-SDT-04] Unsafe opaque payload fails closed')(
    'rejects an opaque owner interrupted by ordinary atoms during emission', () => {
      const document = parseXml(`<w:sdt xmlns:w="${OOXML.W_NS}"/>`);
      const descriptor: OpaquePassthroughNode = {
        namespaceUri: OOXML.W_NS,
        localName: 'sdt',
        documentOrdinal: 0,
        paragraphOrdinal: 0,
        containerIdentity: `{${OOXML.W_NS}}body:0`,
        semanticFingerprint: 'test-only',
        sourceElement: document.documentElement,
        effectiveNamespaces: { w: OOXML.W_NS },
        effectiveMceDeclarations: {},
        emissionElement: document.documentElement,
      };
      const atom = (owner?: OpaquePassthroughNode): ComparisonUnitAtom => ({
        correlationStatus: CorrelationStatus.Equal,
        opaquePassthrough: owner,
      }) as ComparisonUnitAtom;

      expect(() => renderOpaqueAtomSequence(
        [{
          status: CorrelationStatus.Equal,
          atoms: [atom(descriptor), atom(), atom(descriptor)],
          rPr: null,
        }],
        () => '<ordinary/>',
        () => '<opaque/>',
      )).toThrow(/boundary 0 is non-contiguous/);
    },
  );
});

describe('Real content-control corpus measurement', () => {
  test
    .openspec('[SDX-SDT-05] Real content-control corpus measurement is labeled without overclaiming')(
    'records block-SDT no-regression counts separately from synthetic inline evidence',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      const repoRoot = join(import.meta.dirname, '../../../../..');
      const relativePaths = [
        'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
        'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx',
      ];
      const measurements: Array<{ path: string; before: number; after: number; scope: string }> = [];

      await given('the checked-in real ILPA documents whose controls are block-level cover-page SDTs', () => {});
      await when('each real document is compared with itself through forced rebuild', async () => {
        for (const path of relativePaths) {
          const input = readFileSync(join(repoRoot, path));
          const beforeXml = await (await DocxArchive.load(input)).getDocumentXml();
          const output = await forcedRebuild(input, input);
          measurements.push({
            path,
            before: elementsByName(beforeXml, OOXML.W_NS, 'sdt').length,
            after: elementsByName(output, OOXML.W_NS, 'sdt').length,
            scope: 'real block-SDT no-regression only; not inline preservation evidence',
          });
        }
        await attachPrettyJson('real-content-control-corpus-measurement', measurements);
      });
      await then('every real block-SDT count remains stable and the scope label stays explicit', () => {
        expect(measurements).toHaveLength(relativePaths.length);
        for (const measurement of measurements) {
          expect(measurement.before).toBeGreaterThan(0);
          expect(measurement.after).toBe(measurement.before);
          expect(measurement.scope).toContain('not inline preservation evidence');
        }
      });
    },
    120_000,
  );
});
