/**
 * Focused forced-rebuild evidence for direct body-level block SDTs.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.34
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.38
 * @see https://github.com/UseJunior/safe-docx/issues/582
 */

import { describe, expect } from 'vitest';
import { DocxArchive, OOXML, parseXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  rejectAllChanges,
} from './trackChangesAcceptorAst.js';
import { OpaqueRelationshipClosureResolver } from './opaquePassthrough.js';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const IMAGE_REL = `${R_NS}/image`;
const CUSTOM_XML_REL = `${R_NS}/customXml`;
const TEST_FEATURE = 'Document Reconstructor Block SDT';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Opaque Direct Body Block Content Control Preservation',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.29' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.34' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.5.2.38' },
  );

function paragraph(text: string, id: string): string {
  return `<w:p w14:paraId="${id}" w14:textId="77777777" w:rsidR="00112233">` +
    (text ? `<w:r><w:t>${text}</w:t></w:r>` : '') + '</w:p>';
}

function blockSdt(content: string): string {
  return '<w:sdt>' +
    '<w:sdtPr><w:alias w:val="Opaque block"/><w:id w:val="582"/></w:sdtPr>' +
    '<w:sdtEndPr><w:rPr><w:b/></w:rPr></w:sdtEndPr>' +
    `<w:sdtContent>${content}</w:sdtContent>` +
    '</w:sdt>';
}

async function packageFor(body: string): Promise<Buffer> {
  return buildDocxFromBodyXml(body);
}

async function rebuild(originalBody: string, revisedBody: string): Promise<string> {
  const result = await compareDocumentsAtomizer(
    await packageFor(originalBody),
    await packageFor(revisedBody),
    {
      author: 'Issue 582 Test',
      date: new Date('2026-07-22T00:00:00Z'),
      reconstructionMode: 'rebuild',
    },
  );
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

interface RelationshipFixture {
  id: string;
  type: string;
  target: string;
  mode?: 'Internal' | 'External';
}

function relationshipsXml(relationships: RelationshipFixture[]): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    relationships.map((relationship) =>
      `<Relationship Id="${escape(relationship.id)}" Type="${escape(relationship.type)}"` +
      ` Target="${escape(relationship.target)}"` +
      (relationship.mode ? ` TargetMode="${relationship.mode}"` : '') + '/>',
    ).join('') + '</Relationships>';
}

async function packageWithRelationships(
  body: string,
  relationships: RelationshipFixture[],
  files: Readonly<Record<string, string | Buffer>> = {},
  namespaces: Readonly<Record<string, string>> = { r: R_NS },
): Promise<Buffer> {
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body, [], { namespaces }));
  archive.setFile('word/_rels/document.xml.rels', relationshipsXml(relationships));
  for (const [path, content] of Object.entries(files)) archive.setFile(path, content);
  return archive.save();
}

async function rebuildPackages(original: Buffer, revised: Buffer): Promise<Buffer> {
  const result = await compareDocumentsAtomizer(original, revised, {
    author: 'Issue 582 Relationship Test',
    date: new Date('2026-07-22T00:00:00Z'),
    reconstructionMode: 'rebuild',
  });
  expect(result.reconstructionModeUsed).toBe('rebuild');
  return result.document;
}

function drawingBlock(
  relationshipId = 'rIdImage',
  prefix = 'r',
  relationshipAttribute: 'embed' | 'link' = 'embed',
): string {
  return blockSdt(
    `<w:p w14:paraId="00000031" w14:textId="77777777">` +
    `<w:r><w:drawing><wp:inline xmlns:wp="${WP_NS}">` +
    `<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Relationship fixture"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr><a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr id="1" name="fixture.png"/>` +
    `<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>` +
    `<a:blip ${prefix}:${relationshipAttribute}="${relationshipId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
  );
}

function hyperlinkRelationshipBlock(relationshipIds: readonly string[], paragraphId: string): string {
  return blockSdt(
    `<w:p w14:paraId="${paragraphId}">` +
    relationshipIds.map((id, index) =>
      `<w:hyperlink r:id="${id}"><w:r><w:t>Dependency ${index + 1}</w:t></w:r></w:hyperlink>`,
    ).join('') +
    `</w:p>`,
  );
}

function directBodyControls(xml: string): Element[] {
  const body = parseXml(xml).getElementsByTagNameNS(OOXML.W_NS, 'body')[0]!;
  return Array.from(body.childNodes).filter((node): node is Element =>
    node.nodeType === 1 &&
    (node as Element).namespaceURI === OOXML.W_NS &&
    (node as Element).localName === 'sdt',
  );
}

describe('direct body block content-control passthrough', () => {
  test.openspec('[SDX-SDT-BLOCK-01] Outside edits retain a complete block control')(
    'preserves ordered properties, empty paragraphs, and every controlled attribute',
    async ({ given, when, then, and }: AllureBddContext) => {
      const control = blockSdt(paragraph('Controlled first', '00000001') + paragraph('', '00000002'));
      let output = '';

      await given('a direct body block control with an empty controlled paragraph', () => {});
      await when('an outside paragraph changes through forced rebuild', async () => {
        output = await rebuild(control + paragraph('Outside old', '00000003'),
          control + paragraph('Outside new', '00000003'));
      });
      await then('the complete block shape and controlled attributes remain present once', () => {
        const controls = directBodyControls(output);
        expect(controls).toHaveLength(1);
        expect(Array.from(controls[0]!.childNodes)
          .filter((node): node is Element => node.nodeType === 1)
          .map((node) => node.localName)).toEqual(['sdtPr', 'sdtEndPr', 'sdtContent']);
        const paragraphs = controls[0]!.getElementsByTagNameNS(OOXML.W_NS, 'p');
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[1]!.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId'))
          .toBe('00000002');
        expect(paragraphs[1]!.getElementsByTagNameNS(OOXML.W_NS, 't')).toHaveLength(0);
      });
      await and('accept and reject apply only the outside edit', () => {
        expect(extractTextWithParagraphs(acceptAllChanges(output))).toContain('Outside new');
        expect(extractTextWithParagraphs(rejectAllChanges(output))).toContain('Outside old');
      });
    },
  );

  test.openspec('[SDX-SDT-BLOCK-02] Multiple identical controls pair locally and deterministically')(
    'retains identical sibling controls at their own body positions',
    async ({ given, when, then }: AllureBddContext) => {
      const identical = blockSdt(paragraph('Same controlled payload', '00000011'));
      const original = identical + paragraph('Between', '00000012') + identical + paragraph('Tail old', '00000013');
      const revised = identical + paragraph('Between', '00000012') + identical + paragraph('Tail new', '00000013');
      let output = '';

      await given('two byte-identical direct body controls separated by an ordinary paragraph', () => {});
      await when('the tail paragraph changes through forced rebuild', async () => {
        output = await rebuild(original, revised);
      });
      await then('both controls remain distinct, ordered, and emitted once', () => {
        expect(directBodyControls(output)).toHaveLength(2);
        expect((output.match(/Same controlled payload/g) ?? [])).toHaveLength(2);
      });
    },
  );
});

describe('unsupported body block ownership fails closed', () => {
  test.openspec('[SDX-SDT-BLOCK-03] Unsupported block ownership fails before output')(
    'rejects mutation, insertion, deletion, reorder, movement, nesting, and table or cell placement',
    async ({ given, then }: AllureBddContext) => {
      const first = paragraph('First', '00000021');
      const second = paragraph('Second', '00000022');
      const stable = blockSdt(first + second);
      const outside = paragraph('Outside', '00000023');
      const nested = blockSdt(paragraph('Outer', '00000024') + blockSdt(paragraph('Inner', '00000025')));
      const tableBlock = blockSdt(
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      );
      const cellControl = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr/>${blockSdt(paragraph('Cell control', '00000026'))}</w:tc></w:tr></w:tbl>`;
      const cases: Array<[string, string, string]> = [
        ['mutation', stable + outside, blockSdt(paragraph('Changed', '00000021') + second) + outside],
        ['insertion', stable + outside, blockSdt(first + paragraph('Inserted', '00000027') + second) + outside],
        ['deletion', stable + outside, blockSdt(first) + outside],
        ['reorder', stable + outside, blockSdt(second + first) + outside],
        ['movement', stable + outside, outside + stable],
        ['nesting', nested + outside, nested + outside],
        ['table content', tableBlock + outside, tableBlock + outside],
        ['cell placement', cellControl + outside, cellControl + outside],
      ];

      await given('block shapes outside the bounded immutable direct-body contract', () => {});
      await then('each shape rejects without returning lossy rebuilt XML', async () => {
        for (const [name, original, revised] of cases) {
          await expect(rebuild(original, revised), name).rejects.toThrow(/Opaque passthrough:/);
        }
      });
    },
  );
});

describe('opaque body block relationship closure', () => {
  const tailOriginal = paragraph('Outside old', '00000032');
  const tailRevised = paragraph('Outside new', '00000032');
  const imageRelationship: RelationshipFixture = {
    id: 'rIdImage',
    type: IMAGE_REL,
    target: 'media/logo.png',
  };

  test.openspec('[SDX-SDT-BLOCK-01] Outside edits retain a complete block control')(
    'preserves an unchanged direct image binding and media payload',
    async () => {
      const bodyOriginal = drawingBlock() + tailOriginal;
      const bodyRevised = drawingBlock() + tailRevised;
      const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const original = await packageWithRelationships(bodyOriginal, [imageRelationship], {
        'word/media/logo.png': media,
      });
      const revised = await packageWithRelationships(bodyRevised, [imageRelationship], {
        'word/media/logo.png': media,
      });

      const output = await rebuildPackages(original, revised);
      const outputArchive = await DocxArchive.load(output);
      expect(await outputArchive.getFile('word/_rels/document.xml.rels')).toBe(relationshipsXml([imageRelationship]));
      expect(await outputArchive.getFileBuffer('word/media/logo.png')).toEqual(media);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'rejects direct image retargets, byte changes, type or mode changes, missing media, and changed embed Ids',
    async () => {
      const media = Buffer.from('original-image');
      const original = await packageWithRelationships(drawingBlock() + tailOriginal, [imageRelationship], {
        'word/media/logo.png': media,
      });
      const cases: Array<[string, Promise<Buffer>]> = [
        ['retarget', packageWithRelationships(drawingBlock() + tailRevised, [
          { ...imageRelationship, target: 'media/other.png' },
        ], { 'word/media/other.png': media })],
        ['changed bytes', packageWithRelationships(drawingBlock() + tailRevised, [imageRelationship], {
          'word/media/logo.png': Buffer.from('revised-image'),
        })],
        ['changed type', packageWithRelationships(drawingBlock() + tailRevised, [
          { ...imageRelationship, type: `${R_NS}/oleObject` },
        ], { 'word/media/logo.png': media })],
        ['changed mode', packageWithRelationships(drawingBlock() + tailRevised, [
          { ...imageRelationship, target: 'https://example.test/logo.png', mode: 'External' },
        ])],
        ['missing media', packageWithRelationships(drawingBlock() + tailRevised, [imageRelationship])],
        ['changed embed', packageWithRelationships(drawingBlock('rIdOther') + tailRevised, [
          imageRelationship,
          { ...imageRelationship, id: 'rIdOther' },
        ], { 'word/media/logo.png': media })],
      ];

      for (const [name, revised] of cases) {
        await expect(rebuildPackages(original, await revised), name).rejects.toThrow(/Opaque passthrough:/);
      }
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'handles namespace aliases and compares external targets without fetching',
    async () => {
      const external = {
        id: 'rIdImage',
        type: IMAGE_REL,
        target: 'https://example.test/assets/logo.png',
        mode: 'External' as const,
      };
      const original = await packageWithRelationships(
        drawingBlock('rIdImage', 'rel', 'link') + tailOriginal,
        [external],
        {},
        { rel: R_NS },
      );
      const unchanged = await packageWithRelationships(
        drawingBlock('rIdImage', 'rel', 'link') + tailRevised,
        [external],
        {},
        { rel: R_NS },
      );
      await expect(rebuildPackages(original, unchanged)).resolves.toBeInstanceOf(Buffer);

      const changed = await packageWithRelationships(
        drawingBlock('rIdImage', 'rel', 'link') + tailRevised,
        [{ ...external, target: 'https://example.test/assets/changed.png' }],
        {},
        { rel: R_NS },
      );
      await expect(rebuildPackages(original, changed)).rejects.toThrow(/Opaque passthrough:/);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'recursively fingerprints relationship-bearing XML target parts',
    async () => {
      const control = hyperlinkRelationshipBlock(['rIdCustom'], '00000033');
      const rootRelationship: RelationshipFixture = {
        id: 'rIdCustom', type: CUSTOM_XML_REL, target: 'custom/item.xml',
      };
      const nestedRelationship: RelationshipFixture = {
        id: 'rIdNested', type: IMAGE_REL, target: '../media/nested.png',
      };
      const customXml = `<x:root xmlns:x="urn:test:custom" xmlns:r="${R_NS}" r:id="rIdNested"/>`;
      const files = (media: Buffer): Record<string, string | Buffer> => ({
        'word/custom/item.xml': customXml,
        'word/custom/_rels/item.xml.rels': relationshipsXml([nestedRelationship]),
        'word/media/nested.png': media,
      });
      const original = await packageWithRelationships(control + tailOriginal, [rootRelationship], files(Buffer.from('one')));
      const unchanged = await packageWithRelationships(control + tailRevised, [rootRelationship], files(Buffer.from('one')));
      await expect(rebuildPackages(original, unchanged)).resolves.toBeInstanceOf(Buffer);
      const changed = await packageWithRelationships(control + tailRevised, [rootRelationship], files(Buffer.from('two')));
      await expect(rebuildPackages(original, changed)).rejects.toThrow(/Opaque passthrough:/);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'accepts package-root and ordinary relative internal targets',
    async () => {
      const rootRelativeRelationship = { ...imageRelationship, target: '/word/media/root-logo.png' };
      const rootRelative = await packageWithRelationships(
        drawingBlock() + tailOriginal,
        [rootRelativeRelationship],
        { 'word/media/root-logo.png': Buffer.from('root-relative-image') },
      );
      await expect(rebuildPackages(rootRelative, rootRelative)).resolves.toBeInstanceOf(Buffer);

      const relative = await packageWithRelationships(
        drawingBlock() + tailOriginal,
        [imageRelationship],
        { 'word/media/logo.png': Buffer.from('relative-image') },
      );
      await expect(rebuildPackages(relative, relative)).resolves.toBeInstanceOf(Buffer);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'rejects dangling, unsafe, cyclic, and unsupported relationship-bearing targets',
    async () => {
      const control = drawingBlock() + tailOriginal;
      const cases: Array<[string, Promise<Buffer>]> = [
        ['dangling relationship', packageWithRelationships(control, [])],
        ['unsafe target', packageWithRelationships(control, [{ ...imageRelationship, target: '../../../escape.png' }])],
        ['unsupported relationship-bearing target', packageWithRelationships(control, [imageRelationship], {
          'word/media/logo.png': Buffer.from('image'),
          'word/media/_rels/logo.png.rels': relationshipsXml([]),
        })],
      ];
      for (const [name, input] of cases) {
        await expect(rebuildPackages(await input, await input), name).rejects.toThrow(/Opaque passthrough:/);
      }

      const cyclicControl = hyperlinkRelationshipBlock(['rIdA'], '00000034');
      const cyclic = await packageWithRelationships(cyclicControl + tailOriginal, [
        { id: 'rIdA', type: CUSTOM_XML_REL, target: 'custom/a.xml' },
      ], {
        'word/custom/a.xml': `<x:a xmlns:x="urn:test" xmlns:r="${R_NS}" r:id="rIdB"/>`,
        'word/custom/_rels/a.xml.rels': relationshipsXml([
          { id: 'rIdB', type: CUSTOM_XML_REL, target: 'b.xml' },
        ]),
        'word/custom/b.xml': `<x:b xmlns:x="urn:test" xmlns:r="${R_NS}" r:id="rIdA"/>`,
        'word/custom/_rels/b.xml.rels': relationshipsXml([
          { id: 'rIdA', type: CUSTOM_XML_REL, target: 'a.xml' },
        ]),
      });
      await expect(rebuildPackages(cyclic, cyclic)).rejects.toThrow(/cyclic relationship closure/);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'rejects authority, encoded authority, malformed, backslash, and URI-form internal targets',
    async () => {
      const invalidTargets = [
        '//authority.example/logo.png',
        '%2F%2Fauthority.example%2Flogo.png',
        '%ZZ',
        'media\\logo.png',
        'media%5Clogo.png',
        'https://example.test/logo.png',
        '%68%74%74%70%3A%2F%2Fexample.test%2Flogo.png',
      ];
      for (const target of invalidTargets) {
        const input = await packageWithRelationships(drawingBlock() + tailOriginal, [
          { ...imageRelationship, target },
        ]);
        await expect(rebuildPackages(input, input), target).rejects.toThrow(/relationship target/);
      }
    },
  );

  test.openspec('[SDX-SDT-BLOCK-05] Relationship closure changes fail before reconstruction')(
    'rejects two roots entering opposite sides of the same dependency cycle',
    async () => {
      const control = hyperlinkRelationshipBlock(['rIdRootA', 'rIdRootB'], '00000036');
      const cyclic = await packageWithRelationships(control + tailOriginal, [
        { id: 'rIdRootA', type: CUSTOM_XML_REL, target: 'custom/a.xml' },
        { id: 'rIdRootB', type: CUSTOM_XML_REL, target: 'custom/b.xml' },
      ], {
        'word/custom/a.xml': `<x:a xmlns:x="urn:test" xmlns:r="${R_NS}" r:id="rIdToB"/>`,
        'word/custom/_rels/a.xml.rels': relationshipsXml([
          { id: 'rIdToB', type: CUSTOM_XML_REL, target: 'b.xml' },
        ]),
        'word/custom/b.xml': `<x:b xmlns:x="urn:test" xmlns:r="${R_NS}" r:id="rIdToA"/>`,
        'word/custom/_rels/b.xml.rels': relationshipsXml([
          { id: 'rIdToA', type: CUSTOM_XML_REL, target: 'a.xml' },
        ]),
      });

      await expect(rebuildPackages(cyclic, cyclic)).rejects.toThrow(/cyclic relationship closure/);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-04] Block identity work remains linear in group count')(
    'computes a shared acyclic dependency once across concurrent boundary requests',
    async () => {
      const control = hyperlinkRelationshipBlock(['rIdRootA', 'rIdRootB'], '00000037');
      const archive = await DocxArchive.load(await packageWithRelationships(control + tailOriginal, [
        { id: 'rIdRootA', type: CUSTOM_XML_REL, target: 'custom/shared.xml' },
        { id: 'rIdRootB', type: CUSTOM_XML_REL, target: 'custom/shared.xml' },
      ], {
        'word/custom/shared.xml': `<x:shared xmlns:x="urn:test" xmlns:r="${R_NS}" r:id="rIdNested"/>`,
        'word/custom/_rels/shared.xml.rels': relationshipsXml([
          { id: 'rIdNested', type: IMAGE_REL, target: '../media/shared.png' },
        ]),
        'word/media/shared.png': Buffer.from('shared-image'),
      }));
      const resolver = new OpaqueRelationshipClosureResolver(archive);
      const boundary = directBodyControls(await archive.getDocumentXml())[0]!;

      const [first, second] = await Promise.all([
        resolver.fingerprintBoundary(boundary, 'word/document.xml'),
        resolver.fingerprintBoundary(boundary, 'word/document.xml'),
      ]);

      expect(second).toBe(first);
      expect(resolver.instrumentation.boundaryScans).toBe(2);
      expect(resolver.instrumentation.relationshipIdentityComputations).toBe(3);
      expect(resolver.instrumentation.partHashComputations).toBe(2);
      expect(resolver.instrumentation.relationshipPartReads).toBe(3);
    },
  );

  test.openspec('[SDX-SDT-BLOCK-04] Block identity work remains linear in group count')(
    'keeps relationship-free boundaries on the no-read path and memoizes media hashing',
    async () => {
      const plainArchive = await DocxArchive.load(await packageFor(blockSdt(paragraph('Plain', '00000035'))));
      const plainResolver = new OpaqueRelationshipClosureResolver(plainArchive);
      const plainBoundary = directBodyControls(await plainArchive.getDocumentXml())[0]!;
      expect(await plainResolver.fingerprintBoundary(plainBoundary, 'word/document.xml')).toBe('');
      expect(plainResolver.instrumentation.relationshipIdentityComputations).toBe(0);
      expect(plainResolver.instrumentation.relationshipPartReads).toBe(0);
      expect(plainResolver.instrumentation.partHashComputations).toBe(0);

      const mediaArchive = await DocxArchive.load(await packageWithRelationships(
        drawingBlock() + tailOriginal,
        [imageRelationship],
        { 'word/media/logo.png': Buffer.from('shared') },
      ));
      const mediaResolver = new OpaqueRelationshipClosureResolver(mediaArchive);
      const boundary = directBodyControls(await mediaArchive.getDocumentXml())[0]!;
      const first = await mediaResolver.fingerprintBoundary(boundary, 'word/document.xml');
      const second = await mediaResolver.fingerprintBoundary(boundary, 'word/document.xml');
      expect(second).toBe(first);
      expect(mediaResolver.instrumentation.relationshipIdentityComputations).toBe(1);
      expect(mediaResolver.instrumentation.partHashComputations).toBe(1);
      expect(mediaResolver.instrumentation.relationshipPartReads).toBe(2);
    },
  );
});
