import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { creationGrammarHelp } from '../cli-help.js';
import { createDocumentFromMarkdoc, type CreationCertificate } from './create.js';
import type { CreationLowering } from './lower.js';
import { projectSourceText } from './oracle.js';
import { pullCreationEdits } from './pull.js';

const TEST_FEATURE = 'add-created-paragraph-layout';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issues 1424 and 1196 paragraph layout in created documents',
  severity: 'critical',
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A synthetic agreement: a justified recital, a hanging-indented definitions list, an address block and a notice line. */
const AGREEMENT = [
  '---',
  'title: Services Agreement',
  '---',
  '',
  'This Services Agreement is entered into by the parties named below. Each party agrees to the terms set out in this Agreement and in each exhibit attached to it.',
  '',
  '{% paragraph-layout indent-left="0.5" indent-hanging="0.5" %}',
  '"Affiliate" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party to this Agreement.',
  '',
  '"Services" means the services described in each statement of work signed by both parties under this Agreement.',
  '{% /paragraph-layout %}',
  '',
  '{% paragraph-layout align="left" indent-left=1 %}Acme Corporation\\',
  '1 Example Street\\',
  'Example City, ST 00000{% /paragraph-layout %}',
  '',
  '{% paragraph-layout align="left" %}Notices to Acme must be sent to the address above.{% /paragraph-layout %}',
  '',
  'The parties sign this Agreement on the date first written above.',
  '',
].join('\n');

/** Every body paragraph's direct w:jc and w:ind, with its text, read from the DOCX bytes through the DOM. */
async function bodyLayouts(docx: Buffer): Promise<Array<{ text: string; jc?: string; ind?: Record<string, string> }>> {
  const document = parseXml(await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string'));
  const body = document.getElementsByTagNameNS(W, 'body')[0]!;
  return Array.from(body.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'p')
    .map((paragraph) => {
      const pPr = Array.from(paragraph.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).localName === 'pPr');
      const own = (name: string) => (pPr ? Array.from(pPr.childNodes).find((node): node is Element => node.nodeType === 1 && (node as Element).localName === name) : undefined);
      const jc = own('jc');
      const ind = own('ind');
      return {
        text: Array.from(paragraph.getElementsByTagNameNS(W, 't')).map((t) => t.textContent ?? '').join(''),
        ...(jc ? { jc: jc.getAttributeNS(W, 'val') ?? '' } : {}),
        ...(ind ? { ind: Object.fromEntries(Array.from(ind.attributes).map((attribute) => [attribute.localName, attribute.value])) } : {}),
      };
    });
}

async function verificationFailure(promise: Promise<unknown>): Promise<CreationCertificate> {
  const error = await promise.then(() => undefined, (caught: { code?: string; details?: unknown }) => caught);
  expect(error?.code).toBe('CREATION_VERIFICATION_FAILED');
  return error!.details as CreationCertificate;
}

async function failure(source: string): Promise<{ code?: string; message: string } | undefined> {
  return createDocumentFromMarkdoc(source).then(() => undefined, (error: { code?: string; message: string }) => error);
}

/** Apply `change` to the lowering's DocumentSpec only, leaving its projection as it was. */
function corruptSpec(change: (json: string) => string): (lowering: CreationLowering) => CreationLowering {
  return (lowering) => ({ ...lowering, spec: JSON.parse(change(JSON.stringify(lowering.spec))) });
}

async function editDocument(docx: Buffer, change: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  zip.file('word/document.xml', change(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('Traceability: paragraph layout in created documents', () => {
  test.openspec('[SDX-MDOC-PARALAYOUT-01] a paragraph-layout tag gives each of its paragraphs its own alignment and indents')(
    'Scenario: a paragraph-layout tag gives each of its paragraphs its own alignment and indents',
    async () => {
      const created = await createDocumentFromMarkdoc(AGREEMENT);
      expect(created.certificate.passed).toBe(true);

      expect(await bodyLayouts(created.docx)).toEqual([
        { text: expect.stringContaining('This Services Agreement') },
        { text: expect.stringContaining('"Affiliate" means'), ind: { left: '720', hanging: '720' } },
        { text: expect.stringContaining('"Services" means'), ind: { left: '720', hanging: '720' } },
        { text: 'Acme Corporation1 Example StreetExample City, ST 00000', jc: 'left', ind: { left: '1440' } },
        { text: 'Notices to Acme must be sent to the address above.', jc: 'left' },
        { text: 'The parties sign this Agreement on the date first written above.' },
      ]);
      // The address block keeps its line breaks; the paragraphs stay body paragraphs.
      expect(created.readback.paragraphs[3]).toBe('Acme Corporation\n1 Example Street\nExample City, ST 00000');
      expect(created.lowering.blocks.map((block) => block.kind)).toEqual(['body', 'body', 'body', 'body', 'body']);

      // Read-back: every paragraph's layout against the lowering, with its negative control.
      expect(created.certificate.checks.readback).toMatchObject({ passed: true, layouts: { paragraphs: 4, negativeControlDetected: true } });
      // Round trip: the laid-out paragraphs against the source alone, with both negative controls.
      expect(created.certificate.checks.roundTrip.paragraphLayout).toEqual({
        passed: true,
        paragraphs: { expected: 4, actual: 4 },
        mismatches: [],
        negativeControls: { changedLayout: true, droppedParagraph: true, movedLayout: true },
      });
      // The source oracle reads the layout straight from the tag's attributes.
      expect(projectSourceText(AGREEMENT).body.map((entry) => entry.layout ?? null)).toEqual([
        null, 'ind.left=720 ind.hanging=720', 'ind.left=720 ind.hanging=720', 'jc=left ind.left=1440', 'jc=left', null,
      ]);

      // A source without the tag records neither layout comparison.
      const plain = await createDocumentFromMarkdoc('Body text.\n');
      expect(plain.certificate.checks.readback.layouts).toBeUndefined();
      expect(plain.certificate.checks.roundTrip.paragraphLayout).toBeUndefined();

      // Every alignment word maps to its w:jc value; create help lists the tag and its values.
      for (const [align, jc] of [['left', 'left'], ['center', 'center'], ['right', 'right'], ['justify', 'both']] as const) {
        const one = await createDocumentFromMarkdoc(`{% paragraph-layout align="${align}" %}Text.{% /paragraph-layout %}\n`);
        expect((await bodyLayouts(one.docx))[0]).toEqual({ text: 'Text.', jc });
      }
      expect(creationGrammarHelp().join('\n')).toContain('paragraph-layout (align, indent-left, indent-hanging): {% paragraph-layout ... %}');
    },
  );

  test.openspec('[SDX-MDOC-PARALAYOUT-02] verification fails when a layout is lost, changed or added on the way')(
    'Scenario: verification fails when a layout is lost, changed or added on the way',
    async () => {
      // The emitter loses the hanging indent: the read-back against the lowering fails, and so does the round trip.
      let certificate = await verificationFailure(createDocumentFromMarkdoc(AGREEMENT, {
        transformLowering: corruptSpec((json) => json.replaceAll(',"hangingTwips":720', '')),
      }));
      expect(certificate.checks.readback).toMatchObject({ passed: false, detail: 'paragraph 2 layout: expected "ind.left=720 ind.hanging=720", read "ind.left=720"' });
      expect(certificate.checks.roundTrip.passed).toBe(false);
      expect(certificate.checks.roundTrip.paragraphLayout!.mismatches[0]).toEqual({
        paragraph: 2,
        expected: 'ind.left=720 ind.hanging=720 | "Affiliate" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party to this Agreement.',
        actual: 'ind.left=720 | "Affiliate" means any entity that directly or indirectly controls, is controlled by, or is under common control with a party to this Agreement.',
      });

      // A lowering that changes the alignment in both its spec and its projection passes the read-back; the source oracle catches it.
      certificate = await verificationFailure(createDocumentFromMarkdoc(AGREEMENT, {
        transformLowering: (lowering) => {
          const blocks = lowering.spec.sections[0]!.blocks;
          blocks[3] = { ...blocks[3]!, alignment: 'right' } as typeof blocks[number];
          return { ...lowering, projection: { ...lowering.projection, layouts: lowering.projection.layouts.map((layout) => layout?.replace('jc=left ind.left=1440', 'jc=right ind.left=1440') ?? null) } };
        },
      }));
      expect(certificate.checks.readback.passed).toBe(true);
      expect(certificate.checks.roundTrip.paragraphLayout).toMatchObject({ passed: false, mismatches: [{ paragraph: 4, expected: expect.stringMatching(/^jc=left ind\.left=1440 \| /u), actual: expect.stringMatching(/^jc=right ind\.left=1440 \| /u) }] });

      // A layout on a paragraph the source never laid out is extra, even with the lowering kept in step.
      certificate = await verificationFailure(createDocumentFromMarkdoc('First paragraph.\n\nSecond paragraph.\n', {
        transformLowering: (lowering) => {
          const blocks = lowering.spec.sections[0]!.blocks;
          blocks[1] = { ...blocks[1]!, alignment: 'left' } as typeof blocks[number];
          return { ...lowering, projection: { ...lowering.projection, layouts: [null, 'jc=left'] } };
        },
      }));
      expect(certificate.checks.readback.passed).toBe(true);
      expect(certificate.checks.roundTrip.paragraphLayout).toEqual({
        passed: false,
        paragraphs: { expected: 0, actual: 1 },
        mismatches: [{ paragraph: 2, expected: 'no layout | Second paragraph.', actual: 'jc=left | Second paragraph.' }],
        negativeControls: { changedLayout: 'not applicable', droppedParagraph: 'not applicable', movedLayout: 'not applicable' },
      });

      // A layout moved to the next paragraph, which holds the same text, with the lowering kept in step: the read-back
      // passes, and the round trip still fails because it binds each layout to its paragraph's place in the body.
      const twins = '{% paragraph-layout align="left" %}Twin.{% /paragraph-layout %}\n\nTwin.\n';
      certificate = await verificationFailure(createDocumentFromMarkdoc(twins, {
        transformLowering: (lowering) => {
          const blocks = lowering.spec.sections[0]!.blocks;
          const { alignment: _moved, ...unaligned } = blocks[0]! as typeof blocks[number] & { alignment?: string };
          blocks[0] = unaligned as typeof blocks[number];
          blocks[1] = { ...blocks[1]!, alignment: 'left' } as typeof blocks[number];
          return { ...lowering, projection: { ...lowering.projection, layouts: [null, 'jc=left'] } };
        },
      }));
      expect(certificate.checks.readback.passed).toBe(true);
      expect(certificate.checks.roundTrip.paragraphLayout).toEqual({
        passed: false,
        paragraphs: { expected: 1, actual: 1 },
        mismatches: [
          { paragraph: 1, expected: 'jc=left | Twin.', actual: 'no layout | Twin.' },
          { paragraph: 2, expected: 'no layout | Twin.', actual: 'jc=left | Twin.' },
        ],
        // The moved-layout control matches what was actually built here, so it reads as undetected.
        negativeControls: { changedLayout: true, droppedParagraph: true, movedLayout: false },
      });
      // Built as written, the same source passes, and moving its layout is a negative control that is detected.
      const built = await createDocumentFromMarkdoc(twins);
      expect(built.certificate.checks.roundTrip.paragraphLayout).toMatchObject({ passed: true, negativeControls: { changedLayout: true, droppedParagraph: true, movedLayout: true } });
    },
  );

  test.openspec('[SDX-MDOC-PARALAYOUT-03] a malformed paragraph-layout tag fails closed before any output')(
    'Scenario: a malformed paragraph-layout tag fails closed before any output',
    async () => {
      const cases: Array<[string, string, RegExp]> = [
        ['{% paragraph-layout %}Text.{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /needs at least one of align, indent-left or indent-hanging/u],
        ['{% paragraph-layout align="both" %}Text.{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /paragraph-layout align must be "left", "center", "right" or "justify", got "both"/u],
        ['{% paragraph-layout indent-left="0.3" %}Text.{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /paragraph-layout indent-left must be "0\.25", .* got "0\.3"/u],
        ['{% paragraph-layout indent-left=0.5 indent-hanging=1 %}Text.{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /indent-hanging="1" needs an indent-left of at least "1"/u],
        ['{% paragraph-layout indent-hanging="0.5" %}Text.{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /indent-hanging="0\.5" needs an indent-left of at least "0\.5"/u],
        ['{% paragraph-layout align="left" %}\n{% /paragraph-layout %}\n', 'INVALID_PARAGRAPH_LAYOUT', /needs text/u],
        ['{% paragraph-layout align="left" indent-right="0.5" %}Text.{% /paragraph-layout %}\n', 'UNSUPPORTED_CREATION_ATTRIBUTE', /does not admit attribute 'indent-right'/u],
        ['{% paragraph-layout align="left" %}\n- Item\n{% /paragraph-layout %}\n', 'UNSUPPORTED_CREATION_SYNTAX', /Unsupported inline syntax 'list'/u],
      ];
      for (const [source, code, message] of cases) {
        const error = await failure(source);
        expect(error?.code, source).toBe(code);
        expect(error?.message, source).toMatch(message);
      }
    },
  );

  test.openspec('[SDX-MDOC-PARALAYOUT-04] created documents do not stretch justified lines that end in a line break')(
    'Scenario: created documents do not stretch justified lines that end in a line break',
    async () => {
      const created = await createDocumentFromMarkdoc('Return to:\\\nJane Roe\\\n1 Main Street\n');
      expect(created.certificate.passed).toBe(true);
      const settings = parseXml(await (await JSZip.loadAsync(created.docx)).file('word/settings.xml')!.async('string'));
      const compat = settings.getElementsByTagNameNS(W, 'compat')[0]!;
      expect(Array.from(compat.childNodes).filter((node) => node.nodeType === 1).map((node) => (node as Element).localName)).toEqual(['doNotExpandShiftReturn', 'compatSetting']);
      // The setting is written for every created document, whatever the profile.
      const ragged = await createDocumentFromMarkdoc('Body.\n', { profile: { justify: false } });
      const raggedSettings = await (await JSZip.loadAsync(ragged.docx)).file('word/settings.xml')!.async('string');
      expect(raggedSettings).toContain('<w:doNotExpandShiftReturn/>');
    },
  );

  test.openspec('[SDX-MDOC-PARALAYOUT-05] pull carries a wording edit inside a paragraph-layout tag back into the tag')(
    'Scenario: pull carries a wording edit inside a paragraph-layout tag back into the tag',
    async () => {
      const base = await createDocumentFromMarkdoc(AGREEMENT);
      const edited = await editDocument(base.docx, (xml) => xml.replace('Notices to Acme must be sent', 'Notices to Acme shall be sent'));
      const result = await pullCreationEdits({ source: AGREEMENT, base, edited });
      expect(result).toMatchObject({ complete: true, diagnostics: [] });
      expect(result.pulledSource).toBe(AGREEMENT.replace('Notices to Acme must be sent', 'Notices to Acme shall be sent'));

      // A deleted laid-out paragraph is removed with its own lines, keeping the tag around the other one.
      const dropped = await editDocument(base.docx, (xml) => xml.replace(/<w:p>(?:(?!<\/w:p>).)*?"Services" means(?:(?!<\/w:p>).)*?<\/w:p>/u, ''));
      const deletion = await pullCreationEdits({ source: AGREEMENT, base, edited: dropped });
      expect(deletion.complete).toBe(true);
      expect(deletion.pulledSource).not.toContain('"Services" means');
      expect(deletion.pulledSource).toContain('{% paragraph-layout indent-left="0.5" indent-hanging="0.5" %}\n"Affiliate" means');

      // Retyping all of a laid-out paragraph's words keeps its layout: the new paragraph is written in the tag again.
      for (const [source, expected] of [
        ['{% paragraph-layout align="left" %}Alpha.{% /paragraph-layout %}\n', '{% paragraph-layout align="left" %}Gamma.{% /paragraph-layout %}\n'],
        ['{% paragraph-layout align="left" %}\nAlpha.\n{% /paragraph-layout %}\n', '{% paragraph-layout align="left" %}Gamma.{% /paragraph-layout %}\n'],
        ['{% paragraph-layout align="justify" indent-left="1" indent-hanging="0.5" %}Alpha.{% /paragraph-layout %}\n', '{% paragraph-layout align="justify" indent-left="1" indent-hanging="0.5" %}Gamma.{% /paragraph-layout %}\n'],
      ] as const) {
        const one = await createDocumentFromMarkdoc(source);
        const retyped = await pullCreationEdits({ source, base: one, edited: await editDocument(one.docx, (xml) => xml.replace('Alpha.', 'Gamma.')) });
        expect(retyped, source).toMatchObject({ complete: true, diagnostics: [], pulledSource: expected });
      }
    },
  );
});
