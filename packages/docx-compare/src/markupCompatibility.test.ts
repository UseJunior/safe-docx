/**
 * Word stores one visual text box twice — an `mc:Choice` DrawingML spelling
 * and an `mc:Fallback` VML spelling inside one `mc:AlternateContent` — and
 * renders exactly one. A walk that visits both counts one box as two.
 *
 * @conformance ECMA-376 edition 5, Part 4 § 14.9.1.1
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */

import { describe, expect } from 'vitest';
import { OOXML, parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import {
  MC_NAMESPACE,
  groupElementsByTagNameNS,
  isUnselectedAlternateContentDescendant,
  requiredNamespaces,
  selectAlternateContentBranch,
  selectedElementsByTagNameNS,
} from './markupCompatibility.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Markup Compatibility Branch Selection',
    severity: 'critical',
  })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '14.9.1.1' });

const NAMESPACES =
  ` xmlns:w="${OOXML.W_NS}"` +
  ` xmlns:mc="${MC_NAMESPACE}"` +
  ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"` +
  ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
  ` xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"` +
  ` xmlns:v="urn:schemas-microsoft-com:vml"`;

function documentXml(body: string): string {
  return `<w:document${NAMESPACES}><w:body>${body}</w:body></w:document>`;
}

/** The DrawingML spelling Word renders. */
function choiceBranch(text: string, requires = 'wps'): string {
  return (
    `<mc:Choice Requires="${requires}"><w:drawing><wp:inline><a:graphic>` +
    `<a:graphicData><wps:wsp><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></mc:Choice>`
  );
}

/** The VML spelling Word keeps for readers that cannot render the choice. */
function fallbackBranch(text: string): string {
  return (
    `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>`
  );
}

/** One visual text box, stored twice, exactly the way Word writes one. */
function twinTextBox(text: string): string {
  return (
    `<w:p><w:r><mc:AlternateContent>` +
    choiceBranch(text) +
    fallbackBranch(text) +
    `</mc:AlternateContent></w:r></w:p>`
  );
}

/** A text box authored the pre-2010 way: VML only, no alternate content. */
function plainVmlTextBox(text: string): string {
  return (
    `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`
  );
}

function textBoxCounts(xml: string): { raw: number; visual: number } {
  const parsed = parseXml(xml);
  return {
    raw: parsed.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent').length,
    visual: selectedElementsByTagNameNS(parsed, OOXML.W_NS, 'txbxContent')
      .length,
  };
}

describe('markup compatibility branch selection', () => {
  test(
    'one authored text box counts once even though it is stored twice',
    async ({ given, when, then, and }: AllureBddContext) => {
      const xml = await given(
        'a document holding one text box as an mc:Choice / mc:Fallback pair',
        () => documentXml(twinTextBox('Charlie')),
      );

      const counts = await when('both walks enumerate w:txbxContent', () =>
        textBoxCounts(xml),
      );

      await then('the unfiltered DOM walk sees both stored copies', () => {
        expect(counts.raw).toBe(2);
      });
      await and('the branch-aware walk sees the single visible box', () => {
        expect(counts.visual).toBe(1);
      });
    },
  );

  test(
    'two authored text boxes count twice, not four times',
    async ({ given, when, then, and }: AllureBddContext) => {
      const xml = await given('a document holding two twinned text boxes', () =>
        documentXml(twinTextBox('Charlie') + twinTextBox('Echo')),
      );

      const counts = await when('both walks enumerate w:txbxContent', () =>
        textBoxCounts(xml),
      );

      await then('the unfiltered DOM walk sees four stored copies', () => {
        expect(counts.raw).toBe(4);
      });
      await and('the branch-aware walk sees two visible boxes', () => {
        expect(counts.visual).toBe(2);
      });
    },
  );

  test(
    'a text box that exists only in the fallback branch is still enumerated',
    async ({ given, when, then, and }: AllureBddContext) => {
      // The dangerous direction. Skipping every mc:Fallback unconditionally
      // would silently drop content from a document whose mc:Choice cannot be
      // selected, and an equality check that never sees the content agrees
      // with itself.
      const xml = await given(
        'an mc:AlternateContent whose only text box lives in the fallback',
        () =>
          documentXml(
            `<w:p><w:r><mc:AlternateContent>` +
              `<mc:Choice Requires="unknownPrefix"><w:drawing/></mc:Choice>` +
              fallbackBranch('Charlie') +
              `</mc:AlternateContent></w:r></w:p>`,
          ),
      );

      const selected = await when('the branch-aware walk enumerates it', () =>
        selectedElementsByTagNameNS(
          parseXml(xml),
          OOXML.W_NS,
          'txbxContent',
        ),
      );

      await then('the fallback text box is not lost', () => {
        expect(selected).toHaveLength(1);
      });
      await and('its text survives the walk', () => {
        expect(selected[0]?.textContent).toBe('Charlie');
      });
    },
  );

  test(
    'an mc:AlternateContent with only a fallback selects that fallback',
    async ({ given, when, then }: AllureBddContext) => {
      const alternateContent = await given(
        'an mc:AlternateContent carrying no mc:Choice at all',
        () => {
          const xml = documentXml(
            `<w:p><w:r><mc:AlternateContent>` +
              fallbackBranch('Charlie') +
              `</mc:AlternateContent></w:r></w:p>`,
          );
          return parseXml(xml)
            .getElementsByTagNameNS(MC_NAMESPACE, 'AlternateContent')
            .item(0) as Element;
        },
      );

      const branch = await when('the selector picks a branch', () =>
        selectAlternateContentBranch(alternateContent),
      );

      await then('the fallback is selected rather than nothing', () => {
        expect(branch?.localName).toBe('Fallback');
      });
    },
  );

  test(
    'a text box outside any mc:AlternateContent is untouched by the filter',
    async ({ given, when, then, and }: AllureBddContext) => {
      const xml = await given('a plain VML text box with no alternate content', () =>
        documentXml(plainVmlTextBox('Charlie')),
      );

      const counts = await when('both walks enumerate w:txbxContent', () =>
        textBoxCounts(xml),
      );

      await then('the unfiltered walk sees one box', () => {
        expect(counts.raw).toBe(1);
      });
      await and('the branch-aware walk agrees', () => {
        expect(counts.visual).toBe(1);
      });
    },
  );

  test(
    'grouping keeps the unrendered copies reachable',
    async ({ given, when, then, and }: AllureBddContext) => {
      const xml = await given('a document holding two twinned text boxes', () =>
        documentXml(twinTextBox('Charlie') + twinTextBox('Echo')),
      );

      const groups = await when('the walk groups matches by visual object', () =>
        groupElementsByTagNameNS(parseXml(xml), OOXML.W_NS, 'txbxContent'),
      );

      await then('there is one group per visible box', () => {
        expect(groups).toHaveLength(2);
      });
      await and('each group also carries its unrendered twin', () => {
        expect(groups.map((group) => group.unselected.length)).toEqual([1, 1]);
        expect(groups.map((group) => group.selected.textContent)).toEqual([
          'Charlie',
          'Echo',
        ]);
        expect(
          groups.map((group) => group.unselected[0]?.textContent),
        ).toEqual(['Charlie', 'Echo']);
      });
    },
  );

  test(
    'every stored copy lands in exactly one group',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Totality. Codex peer review of #794 showed that pairing copies by
      // position and discarding the surplus made a copy unreachable, so a
      // fail-closed guard that hashes `[selected, ...unselected]` went blind
      // to it. Every shape below is checked for coverage, not just count.
      const shapes = await given('documents whose branches do not correspond', () => [
        documentXml(twinTextBox('Charlie')),
        documentXml(twinTextBox('Charlie') + plainVmlTextBox('Echo')),
        documentXml(
          `<w:p><w:r><mc:AlternateContent>` +
            choiceBranch('Charlie') +
            `<mc:Fallback><w:pict>` +
            `<v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Charlie</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>` +
            `<v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Echo</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>` +
            `</w:pict></mc:Fallback>` +
            `</mc:AlternateContent></w:r></w:p>`,
        ),
        documentXml(
          `<w:p><w:r><mc:AlternateContent>` +
            `<mc:Choice Requires="wps"><w:drawing/></mc:Choice>` +
            fallbackBranch('Charlie') +
            `</mc:AlternateContent></w:r></w:p>`,
        ),
        documentXml(
          `<w:p><w:r><mc:AlternateContent>` +
            `<mc:Something><w:pict><v:shape><v:textbox><w:txbxContent>` +
            `<w:p><w:r><w:t>Charlie</w:t></w:r></w:p>` +
            `</w:txbxContent></v:textbox></v:shape></w:pict></mc:Something>` +
            `</mc:AlternateContent></w:r></w:p>`,
        ),
      ]);

      const coverage = await when('each document is grouped', () =>
        shapes.map((xml) => {
          const parsed = parseXml(xml);
          const raw = Array.from(
            parsed.getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
          ) as Element[];
          const grouped: Element[] = [];
          for (const group of groupElementsByTagNameNS(
            parsed,
            OOXML.W_NS,
            'txbxContent',
          )) {
            grouped.push(group.selected, ...group.unselected);
          }
          return {
            raw: raw.length,
            grouped: grouped.length,
            distinct: new Set(grouped).size,
            missing: raw.filter((element) => !grouped.includes(element)).length,
          };
        }),
      );

      await then('no stored copy is dropped', () => {
        expect(coverage.map((entry) => entry.missing)).toEqual(
          shapes.map(() => 0),
        );
      });
      await and('no stored copy is counted twice', () => {
        for (const entry of coverage) {
          expect(entry.grouped).toBe(entry.raw);
          expect(entry.distinct).toBe(entry.raw);
        }
      });
    },
  );

  test(
    'branches holding different numbers of matches are reported unbalanced',
    async ({ given, when, then }: AllureBddContext) => {
      const xml = await given(
        'an mc:AlternateContent whose fallback holds two boxes to the choice one',
        () =>
          documentXml(
            `<w:p><w:r><mc:AlternateContent>` +
              choiceBranch('Charlie') +
              `<mc:Fallback><w:pict>` +
              `<v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Charlie</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>` +
              `<v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Echo</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape>` +
              `</w:pict></mc:Fallback>` +
              `</mc:AlternateContent></w:r></w:p>`,
          ),
      );

      const groups = await when('the walk groups matches by visual object', () =>
        groupElementsByTagNameNS(parseXml(xml), OOXML.W_NS, 'txbxContent'),
      );

      await then('the group flags that the copies could not be paired', () => {
        expect(groups).toHaveLength(1);
        expect(groups[0]?.unbalanced).toBe(true);
      });
    },
  );

  test(
    'unselected-branch membership is reported for individual nodes',
    async ({ given, when, then, and }: AllureBddContext) => {
      const boxes = await given('a twinned text box', () => {
        const xml = documentXml(twinTextBox('Charlie'));
        return Array.from(
          parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'txbxContent'),
        ) as Element[];
      });

      const flags = await when('each stored copy is tested', () =>
        boxes.map((box) => isUnselectedAlternateContentDescendant(box)),
      );

      await then('the rendered copy is not flagged', () => {
        expect(flags[0]).toBe(false);
      });
      await and('the unrendered copy is', () => {
        expect(flags[1]).toBe(true);
      });
    },
  );

  test(
    'a Requires attribute naming an unbound prefix falls through to the fallback',
    async ({ given, when, then, and }: AllureBddContext) => {
      const alternateContent = await given(
        'an mc:Choice requiring a prefix nothing declares',
        () => {
          const xml = documentXml(
            `<w:p><w:r><mc:AlternateContent>` +
              choiceBranch('Charlie', 'nowhereDeclared') +
              fallbackBranch('Echo') +
              `</mc:AlternateContent></w:r></w:p>`,
          );
          return parseXml(xml)
            .getElementsByTagNameNS(MC_NAMESPACE, 'AlternateContent')
            .item(0) as Element;
        },
      );

      const branch = await when('the selector picks a branch', () =>
        selectAlternateContentBranch(alternateContent),
      );

      await then('the unsatisfiable choice is skipped', () => {
        expect(branch?.localName).toBe('Fallback');
      });
      await and('the unresolved prefix is visible to callers', () => {
        const choice = alternateContent
          .getElementsByTagNameNS(MC_NAMESPACE, 'Choice')
          .item(0) as Element;
        expect(requiredNamespaces(choice)).toEqual([
          { prefix: 'nowhereDeclared', namespaceURI: null },
        ]);
      });
    },
  );

  test(
    'the branch-aware walk can go red',
    async ({ given, when, then, and }: AllureBddContext) => {
      // Negative control. This class of defect went unnoticed because the
      // double count cancelled on both sides of an equality check, so the
      // check agreed with itself. A test that only ever asserts "the filtered
      // count equals the visible count" would pass against a filter that does
      // nothing at all. These fixtures prove the assertion discriminates.
      const cases = await given('documents whose visible box count is known', () => [
        { body: '', visual: 0 },
        { body: plainVmlTextBox('Charlie'), visual: 1 },
        { body: twinTextBox('Charlie'), visual: 1 },
        { body: twinTextBox('Charlie') + plainVmlTextBox('Echo'), visual: 2 },
        { body: twinTextBox('Charlie') + twinTextBox('Echo'), visual: 2 },
      ]);

      const observed = await when('each document is walked both ways', () =>
        cases.map(({ body }) => textBoxCounts(documentXml(body))),
      );

      await then('the branch-aware walk matches the visible count everywhere', () => {
        expect(observed.map((counts) => counts.visual)).toEqual(
          cases.map((entry) => entry.visual),
        );
      });
      await and('the unfiltered walk does not, so the assertion discriminates', () => {
        expect(observed.map((counts) => counts.raw)).toEqual([0, 1, 2, 3, 4]);
        expect(observed.map((counts) => counts.raw)).not.toEqual(
          cases.map((entry) => entry.visual),
        );
      });
    },
  );
});
