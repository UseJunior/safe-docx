import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from './document.js';
import { buildDocxFromParts } from '../integration/synthetic-docx-fixture.js';

const TEST_FEATURE = 'document-paragraph-id-stability-and-fingerprint';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });

const MINIMAL_BODY_XML = `
  <w:p>
    <w:bookmarkStart w:id="0" w:name="_bk_0"/>
    <w:r><w:t>Hello world</w:t></w:r>
    <w:bookmarkEnd w:id="0"/>
  </w:p>
`;

describe('Document view cache validity and mutation versioning (#1302)', () => {
  test.openspec('mutation version monotonically increases and is not reset by reads')(
    'mutation version monotonically increases and is not reset by reads',
    async ({ given, when, then }: AllureBddContext) => {
      const buffer = await buildDocxFromParts({ bodyXml: MINIMAL_BODY_XML });
      const doc = await DocxDocument.load(buffer);

      const initialVersion = doc.getMutationVersion();
      expect(initialVersion).toBe(0);

      await given('initial document view build', async () => {
        const view1 = doc.buildDocumentView();
        expect(view1.nodes.length).toBeGreaterThan(0);
        // Reads must NOT reset or alter the mutation version
        expect(doc.getMutationVersion()).toBe(initialVersion);
      });

      await when('subsequent reads are performed', async () => {
        doc.readParagraphs();
        const view2 = doc.buildDocumentView();
        expect(doc.getMutationVersion()).toBe(initialVersion);
        // Cached view returns identical object references
        expect(view2.nodes).toBe(doc.buildDocumentView().nodes);
      });

      await then('markMutated increments version monotonically and invalidates cache', async () => {
        const v1 = doc.markMutated();
        expect(v1).toBe(initialVersion + 1);
        expect(doc.getMutationVersion()).toBe(v1);

        const v2 = doc.markMutated();
        expect(v2).toBe(v1 + 1);
        expect(doc.getMutationVersion()).toBe(v2);

        // A new buildDocumentView rebuilds fresh nodes
        const view3 = doc.buildDocumentView();
        expect(doc.getMutationVersion()).toBe(v2);
        // Fresh view nodes are rebuilt after mutation
        expect(view3.nodes.length).toBeGreaterThan(0);
      });
    },
  );

  test.openspec('view cache hit preserves node references until mutation occurs')(
    'view cache hit preserves node references until mutation occurs',
    async ({ given, when, then }: AllureBddContext) => {
      const buffer = await buildDocxFromParts({ bodyXml: MINIMAL_BODY_XML });
      const doc = await DocxDocument.load(buffer);

      let viewFirst!: ReturnType<typeof doc.buildDocumentView>;
      await given('first buildDocumentView call', async () => {
        viewFirst = doc.buildDocumentView({ showFormatting: true, formattingMode: 'compact' });
      });

      await when('calling buildDocumentView with same options', async () => {
        const viewSecond = doc.buildDocumentView({ showFormatting: true, formattingMode: 'compact' });
        expect(viewSecond.nodes).toBe(viewFirst.nodes);
        expect(viewSecond.styles).toBe(viewFirst.styles);
      });

      await when('calling buildDocumentView with different options', async () => {
        const viewFull = doc.buildDocumentView({ showFormatting: true, formattingMode: 'full' });
        // Different mode requires rebuild
        expect(viewFull.nodes).not.toBe(viewFirst.nodes);
      });

      await then('mutation invalidates cache across all options', async () => {
        const vBefore = doc.getMutationVersion();
        doc.replaceText({
          targetParagraphId: '_bk_0',
          findText: 'Hello',
          replaceText: 'Hi',
        });
        expect(doc.getMutationVersion()).toBeGreaterThan(vBefore);

        const viewAfterMutation = doc.buildDocumentView({ showFormatting: true, formattingMode: 'full' });
        expect(viewAfterMutation.nodes[0]!.clean_text).toContain('Hi');
      });
    },
  );

  test.openspec('legacy dirty accessor integrates with versioned mutation model')(
    'legacy dirty accessor integrates with versioned mutation model',
    async ({ given, then }: AllureBddContext) => {
      const buffer = await buildDocxFromParts({ bodyXml: MINIMAL_BODY_XML });
      const doc = await DocxDocument.load(buffer);

      await given('freshly loaded document', async () => {
        expect(doc.dirty).toBe(true); // cache is null
        doc.buildDocumentView();
        expect(doc.dirty).toBe(false); // cache is valid
      });

      await then('setting dirty to true triggers mutation and invalidates cache', async () => {
        const vBefore = doc.getMutationVersion();
        doc.dirty = true;
        expect(doc.getMutationVersion()).toBe(vBefore + 1);
        expect(doc.dirty).toBe(true);
      });
    },
  );
});
