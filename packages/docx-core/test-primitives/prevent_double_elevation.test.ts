import { describe, expect } from 'vitest';
import { OOXML } from '../src/primitives/namespaces.js';
import { parseXml, serializeXml } from '../src/primitives/xml.js';
import { preventDoubleElevation } from '../src/primitives/prevent_double_elevation.js';
import {
  type AllureBddContext,
  allureJsonAttachment,
  allureStep,
  testAllure,
} from './helpers/allure-test.js';

const W_NS = OOXML.W_NS;
const TEST_FEATURE = 'prevent-footnote-double-elevation';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

function makeStylesDoc(innerXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W_NS}">${innerXml}</w:styles>`,
  );
}

/** Check if an rPr has a child element with the given localName */
function rPrHasChild(stylesDoc: Document, styleId: string, localName: string): boolean {
  const styles = stylesDoc.getElementsByTagNameNS(W_NS, 'style');
  for (let i = 0; i < styles.length; i++) {
    const el = styles.item(i)!;
    const id = el.getAttributeNS(W_NS, 'styleId') || el.getAttribute('w:styleId') || el.getAttribute('styleId');
    if (id !== styleId) continue;
    let child = el.firstChild;
    while (child) {
      if (child.nodeType === 1 && (child as Element).localName === 'rPr' && (child as Element).namespaceURI === W_NS) {
        let rChild = child.firstChild;
        while (rChild) {
          if (rChild.nodeType === 1 && (rChild as Element).localName === localName && (rChild as Element).namespaceURI === W_NS) {
            return true;
          }
          rChild = rChild.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }
  return false;
}

/** Get the val attribute of a child element in rPr */
function getRPrChildVal(stylesDoc: Document, styleId: string, localName: string): string | null {
  const styles = stylesDoc.getElementsByTagNameNS(W_NS, 'style');
  for (let i = 0; i < styles.length; i++) {
    const el = styles.item(i)!;
    const id = el.getAttributeNS(W_NS, 'styleId') || el.getAttribute('w:styleId') || el.getAttribute('styleId');
    if (id !== styleId) continue;
    let child = el.firstChild;
    while (child) {
      if (child.nodeType === 1 && (child as Element).localName === 'rPr' && (child as Element).namespaceURI === W_NS) {
        let rChild = child.firstChild;
        while (rChild) {
          if (rChild.nodeType === 1 && (rChild as Element).localName === localName && (rChild as Element).namespaceURI === W_NS) {
            return (rChild as Element).getAttributeNS(W_NS, 'val') || (rChild as Element).getAttribute('w:val') || (rChild as Element).getAttribute('val');
          }
          rChild = rChild.nextSibling;
        }
      }
      child = child.nextSibling;
    }
  }
  return null;
}

describe('prevent_double_elevation', () => {
  describe('core scenarios', () => {
    test
      .allure({
        title: 'Remove redundant position when vertAlign superscript is present on same style',
        description:
          'When a FootnoteReference style has both w:vertAlign="superscript" and a positive ' +
          'w:position, the position is redundant and causes double-elevation on non-Windows ' +
          'renderers. preventDoubleElevation removes the position while preserving vertAlign.',
      })
      .openspec('[SDX-DE-001] remove position when vertAlign superscript is present on same style')(
      '[SDX-DE-001] remove position when vertAlign superscript is present on same style',
      async ({ given, when, then, and, attachPrettyXml, attachJsonLastStep }: AllureBddContext) => {
        const scenarioId = 'SDX-DE-001';
        const fixture = {
          styleId: 'FootnoteReference',
          vertAlign: 'superscript',
          position: '6',
        } as const;

        const debugContext = {
          scenario_id: scenarioId,
          style_id: fixture.styleId,
          input_vertAlign: fixture.vertAlign,
          input_position: fixture.position,
          expected_position_removed: true,
          expected_vertAlign_preserved: true,
          expected_fixes: 1,
        };

        let doc: Document;
        let result: ReturnType<typeof preventDoubleElevation>;

        try {
          const styleXml =
            `<w:style w:type="character" w:styleId="${fixture.styleId}">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="${fixture.vertAlign}"/><w:position w:val="${fixture.position}"/></w:rPr>` +
            `</w:style>`;
          doc = makeStylesDoc(styleXml);
          const xmlBefore = serializeXml(doc);

          await given(
            'a FootnoteReference style with vertAlign=superscript and position=6',
            async () => {
              await attachPrettyXml('01 Styles XML before normalization', xmlBefore);
            },
            { style_id: fixture.styleId, vertAlign: fixture.vertAlign, position: fixture.position },
          );

          result = await when(
            'preventDoubleElevation is called',
            async () => preventDoubleElevation(doc),
          );

          const xmlAfter = serializeXml(doc);

          await then(
            'the double elevation is fixed and position is removed',
            async () => {
              expect(result.doubleElevationsFixed).toBe(1);
              expect(rPrHasChild(doc, 'FootnoteReference', 'position')).toBe(false);
              expect(rPrHasChild(doc, 'FootnoteReference', 'vertAlign')).toBe(true);
            },
            {
              expected_fixes: 1,
              actual_fixes: result.doubleElevationsFixed,
              expected_has_position: false,
              actual_has_position: rPrHasChild(doc, 'FootnoteReference', 'position'),
              expected_has_vertAlign: true,
              actual_has_vertAlign: rPrHasChild(doc, 'FootnoteReference', 'vertAlign'),
            },
          );

          await and(
            'the styles XML was modified',
            async () => {
              expect(xmlAfter).not.toBe(xmlBefore);
              await attachPrettyXml('02 Styles XML after normalization', xmlAfter);
            },
          );
        } finally {
          await attachJsonLastStep({
            context: debugContext,
            result: result!,
          });
        }
      },
    );

    test
      .allure({
        title: 'No-op when only vertAlign is present without position',
        description:
          'When a FootnoteReference style has w:vertAlign="superscript" but no w:position, ' +
          'there is no double-elevation defect. preventDoubleElevation leaves the style unchanged.',
      })
      .openspec('[SDX-DE-002] no-op when only vertAlign is present')(
      '[SDX-DE-002] no-op when only vertAlign is present',
      async ({ given, when, then, and, attachPrettyXml, attachJsonLastStep }: AllureBddContext) => {
        const scenarioId = 'SDX-DE-002';
        const fixture = {
          styleId: 'FootnoteReference',
          vertAlign: 'superscript',
        } as const;

        const debugContext = {
          scenario_id: scenarioId,
          style_id: fixture.styleId,
          input_vertAlign: fixture.vertAlign,
          input_position: null,
          expected_unchanged: true,
          expected_fixes: 0,
        };

        let doc: Document;
        let xmlBefore: string;
        let result: ReturnType<typeof preventDoubleElevation>;

        try {
          const styleXml =
            `<w:style w:type="character" w:styleId="${fixture.styleId}">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="${fixture.vertAlign}"/></w:rPr>` +
            `</w:style>`;
          doc = makeStylesDoc(styleXml);
          xmlBefore = serializeXml(doc);

          await given(
            'a FootnoteReference style with only vertAlign=superscript',
            async () => {
              await attachPrettyXml('01 Styles XML before normalization', xmlBefore);
            },
            { style_id: fixture.styleId, vertAlign: fixture.vertAlign, position: 'none' },
          );

          result = await when(
            'preventDoubleElevation is called',
            async () => preventDoubleElevation(doc),
          );

          const xmlAfter = serializeXml(doc);

          await then(
            'no fixes are applied and the document is unchanged',
            async () => {
              expect(result.doubleElevationsFixed).toBe(0);
              expect(xmlAfter).toBe(xmlBefore);
            },
            {
              expected_fixes: 0,
              actual_fixes: result.doubleElevationsFixed,
              expected_xml_unchanged: true,
              actual_xml_unchanged: xmlAfter === xmlBefore,
            },
          );

          await and(
            'the styles XML is identical before and after',
            async () => {
              await attachPrettyXml('02 Styles XML after normalization (unchanged)', xmlAfter);
            },
          );
        } finally {
          await attachJsonLastStep({
            context: debugContext,
            result: result!,
          });
        }
      },
    );

    test.openspec('[SDX-DE-003] no-op when only position is present')(
      '[SDX-DE-003] no-op when only position is present',
      async () => {
        let doc: Document;
        let before: string;
        await allureStep('Given a FootnoteReference style with position=6 but no vertAlign', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
          before = serializeXml(doc);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureStep('And the document is unchanged', async () => {
          expect(serializeXml(doc!)).toBe(before!);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-004] detect vertAlign through basedOn inheritance chain')(
      '[SDX-DE-004] detect vertAlign through basedOn inheritance chain',
      async () => {
        let doc: Document;
        await allureStep('Given a parent style with vertAlign=superscript and FootnoteReference with position=6 based on it', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="ParentRef">` +
            `<w:name w:val="parent ref"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:basedOn w:val="ParentRef"/>` +
            `<w:rPr><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 1', async () => {
          expect(result!.doubleElevationsFixed).toBe(1);
        });

        await allureStep('And w:position is removed from the child style', async () => {
          expect(rPrHasChild(doc!, 'FootnoteReference', 'position')).toBe(false);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-005] child baseline overrides ancestor superscript (no fix)')(
      '[SDX-DE-005] child baseline overrides ancestor superscript (no fix)',
      async () => {
        let doc: Document;
        let before: string;
        await allureStep('Given a parent with vertAlign=superscript and FootnoteReference with vertAlign=baseline and position=6', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="ParentRef">` +
            `<w:name w:val="parent ref"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:basedOn w:val="ParentRef"/>` +
            `<w:rPr><w:vertAlign w:val="baseline"/><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
          before = serializeXml(doc);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureStep('And the document is unchanged', async () => {
          expect(serializeXml(doc!)).toBe(before!);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-006] inherited position neutralized locally')(
      '[SDX-DE-006] inherited position neutralized locally',
      async () => {
        let doc: Document;
        await allureStep('Given a parent style with position=6 and FootnoteReference with vertAlign=superscript based on it', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="ParentRef">` +
            `<w:name w:val="parent ref"/>` +
            `<w:rPr><w:position w:val="6"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:basedOn w:val="ParentRef"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
            `</w:style>`,
          );
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 1', async () => {
          expect(result!.doubleElevationsFixed).toBe(1);
        });

        await allureStep('And FootnoteReference rPr has position=0', async () => {
          expect(getRPrChildVal(doc!, 'FootnoteReference', 'position')).toBe('0');
        });

        await allureStep('And parent style position=6 is unchanged', async () => {
          expect(getRPrChildVal(doc!, 'ParentRef', 'position')).toBe('6');
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-007] shared parent not mutated (sibling safety)')(
      '[SDX-DE-007] shared parent not mutated (sibling safety)',
      async () => {
        let doc: Document;
        await allureStep('Given a shared parent with position=6, FootnoteReference with superscript, and an unrelated SiblingStyle', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="SharedParent">` +
            `<w:name w:val="shared parent"/>` +
            `<w:rPr><w:position w:val="6"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:basedOn w:val="SharedParent"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="SiblingStyle">` +
            `<w:name w:val="sibling"/>` +
            `<w:basedOn w:val="SharedParent"/>` +
            `</w:style>`,
          );
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 1', async () => {
          expect(result!.doubleElevationsFixed).toBe(1);
        });

        await allureStep('And FootnoteReference rPr has position=0', async () => {
          expect(getRPrChildVal(doc!, 'FootnoteReference', 'position')).toBe('0');
        });

        await allureStep('And parent position=6 is preserved', async () => {
          expect(getRPrChildVal(doc!, 'SharedParent', 'position')).toBe('6');
        });

        await allureStep('And SiblingStyle has no position override', async () => {
          expect(rPrHasChild(doc!, 'SiblingStyle', 'position')).toBe(false);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-008] idempotent on already-fixed styles')(
      '[SDX-DE-008] idempotent on already-fixed styles',
      async () => {
        let doc: Document;
        await allureStep('Given a FootnoteReference style with double elevation that has been fixed once', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
          const first = preventDoubleElevation(doc);
          expect(first.doubleElevationsFixed).toBe(1);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called a second time', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureJsonAttachment('result', result!);
      },
    );
  });

  describe('edge cases', () => {
    test.openspec('[SDX-DE-009] preserve subscript with position')(
      '[SDX-DE-009] preserve subscript with position',
      async () => {
        let doc: Document;
        let before: string;
        await allureStep('Given a FootnoteReference style with vertAlign=subscript and position=6', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="subscript"/><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
          before = serializeXml(doc);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureStep('And the document is unchanged', async () => {
          expect(serializeXml(doc!)).toBe(before!);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-010] negative position preserved')(
      '[SDX-DE-010] negative position preserved',
      async () => {
        let doc: Document;
        let before: string;
        await allureStep('Given a FootnoteReference style with vertAlign=superscript and position=-4', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="-4"/></w:rPr>` +
            `</w:style>`,
          );
          before = serializeXml(doc);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureStep('And the document is unchanged', async () => {
          expect(serializeXml(doc!)).toBe(before!);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-011] non-target style is not modified')(
      '[SDX-DE-011] non-target style is not modified',
      async () => {
        let doc: Document;
        let before: string;
        await allureStep('Given a custom MyStyle with superscript and position that is not in the allowlist', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="MyStyle">` +
            `<w:name w:val="my style"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="6"/></w:rPr>` +
            `</w:style>`,
          );
          before = serializeXml(doc);
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called with default options', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 0', async () => {
          expect(result!.doubleElevationsFixed).toBe(0);
        });

        await allureStep('And the document is unchanged', async () => {
          expect(serializeXml(doc!)).toBe(before!);
        });

        await allureJsonAttachment('result', result!);
      },
    );

    test.openspec('[SDX-DE-012] handles both FootnoteReference and EndnoteReference')(
      '[SDX-DE-012] handles both FootnoteReference and EndnoteReference',
      async () => {
        let doc: Document;
        await allureStep('Given FootnoteReference and EndnoteReference both with superscript and position', async () => {
          doc = makeStylesDoc(
            `<w:style w:type="character" w:styleId="FootnoteReference">` +
            `<w:name w:val="footnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="6"/></w:rPr>` +
            `</w:style>` +
            `<w:style w:type="character" w:styleId="EndnoteReference">` +
            `<w:name w:val="endnote reference"/>` +
            `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="4"/></w:rPr>` +
            `</w:style>`,
          );
        });

        let result: ReturnType<typeof preventDoubleElevation>;
        await allureStep('When preventDoubleElevation is called', async () => {
          result = preventDoubleElevation(doc!);
        });

        await allureStep('Then doubleElevationsFixed is 2', async () => {
          expect(result!.doubleElevationsFixed).toBe(2);
        });

        await allureStep('And FootnoteReference no longer has position', async () => {
          expect(rPrHasChild(doc!, 'FootnoteReference', 'position')).toBe(false);
        });

        await allureStep('And EndnoteReference no longer has position', async () => {
          expect(rPrHasChild(doc!, 'EndnoteReference', 'position')).toBe(false);
        });

        await allureJsonAttachment('result', result!);
      },
    );
  });

  describe('human-readable', () => {
    humanReadableTest('footnote numbers no longer float too high above the text line', async () => {
      let doc: Document;
      await allureStep('Given a document where footnote numbers are styled to both rise and lift', async () => {
        doc = makeStylesDoc(
          `<w:style w:type="character" w:styleId="FootnoteReference">` +
          `<w:name w:val="footnote reference"/>` +
          `<w:rPr><w:vertAlign w:val="superscript"/><w:position w:val="6"/></w:rPr>` +
          `</w:style>`,
        );
      });

      let result: ReturnType<typeof preventDoubleElevation>;
      await allureStep('When the document is normalized', async () => {
        result = preventDoubleElevation(doc!);
      });

      await allureStep('Then the extra lift is removed and footnote numbers sit at normal superscript height', async () => {
        expect(result!.doubleElevationsFixed).toBe(1);
      });
    });
  });
});
