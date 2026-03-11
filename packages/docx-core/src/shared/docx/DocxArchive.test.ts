import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { DocxArchive, DOCX_PATHS } from './DocxArchive.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'DocxArchive' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DocxArchive', () => {
  describe('create', () => {
    test('creates a valid minimal DOCX', async ({ given, when, then }: AllureBddContext) => {
      let archive: DocxArchive;

      await given('no initial state', () => {});

      await when('DocxArchive.create is called', async () => {
        archive = await DocxArchive.create();
      });

      await then('the archive has required files and a valid document body', async () => {
        // Should have required files
        expect(archive.hasFile(DOCX_PATHS.DOCUMENT)).toBe(true);
        expect(archive.hasFile(DOCX_PATHS.CONTENT_TYPES)).toBe(true);
        expect(archive.hasFile('_rels/.rels')).toBe(true);

        // Document should have body element
        const docXml = await archive.getDocumentXml();
        expect(docXml).toContain('w:document');
        expect(docXml).toContain('w:body');
      });
    });

    test('can save and reload a created DOCX', async ({ given, when, then }: AllureBddContext) => {
      let archive: DocxArchive;
      let buffer: Buffer;

      await given('a created DocxArchive', async () => {
        archive = await DocxArchive.create();
      });

      await when('the archive is saved', async () => {
        buffer = await archive.save();
      });

      await then('the buffer is a valid ZIP and can be reloaded', async () => {
        // Should be a valid buffer
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);

        // Should start with PK (ZIP magic bytes)
        expect(buffer[0]).toBe(0x50); // P
        expect(buffer[1]).toBe(0x4b); // K

        // Should be reloadable
        const reloaded = await DocxArchive.load(buffer);
        const docXml = await reloaded.getDocumentXml();
        expect(docXml).toContain('w:document');
      });
    });
  });

  describe('setDocumentXml', () => {
    test('modifies the document XML', async ({ given, when, then }: AllureBddContext) => {
      let archive: DocxArchive;
      let retrieved: string;

      await given('a created DocxArchive', async () => {
        archive = await DocxArchive.create();
      });

      await when('setDocumentXml is called with new XML', async () => {
        const newXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>Hello World</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

        archive.setDocumentXml(newXml);
        retrieved = await archive.getDocumentXml();
      });

      await then('the new content is returned and the document path is marked modified', () => {
        expect(retrieved).toContain('Hello World');
        expect(archive.getModifiedPaths()).toContain(DOCX_PATHS.DOCUMENT);
      });
    });
  });

  describe('clone', () => {
    test('creates an independent copy', async ({ given, when, then }: AllureBddContext) => {
      let original: DocxArchive;
      let clone: DocxArchive;

      await given('an original archive and a clone', async () => {
        original = await DocxArchive.create();
        clone = await original.clone();
      });

      await when('the original is modified', () => {
        original.setDocumentXml('<w:document><w:body><w:p/></w:body></w:document>');
      });

      await then('the clone is unaffected', async () => {
        const cloneXml = await clone.getDocumentXml();
        expect(cloneXml).not.toContain('<w:p/>');
      });
    });
  });

  describe('load', () => {
    test('throws on invalid buffer', async ({ given, when, then }: AllureBddContext) => {
      let invalidBuffer: Buffer;

      await given('an invalid buffer', () => {
        invalidBuffer = Buffer.from('not a zip file');
      });

      await when('DocxArchive.load is called', () => {});

      await then('an error is thrown', async () => {
        await expect(DocxArchive.load(invalidBuffer)).rejects.toThrow();
      });
    });

    test('throws on ZIP without document.xml', async ({ given, when, then }: AllureBddContext) => {
      let buffer: Buffer;

      await given('a ZIP file without document.xml', async () => {
        // Create a ZIP that's not a DOCX
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        zip.file('hello.txt', 'Hello World');
        buffer = await zip.generateAsync({ type: 'nodebuffer' });
      });

      await when('DocxArchive.load is called', () => {});

      await then('an error containing "Invalid DOCX" is thrown', async () => {
        await expect(DocxArchive.load(buffer)).rejects.toThrow('Invalid DOCX');
      });
    });
  });

  describe('listFiles', () => {
    test('lists all files in archive', async ({ given, when, then }: AllureBddContext) => {
      let archive: DocxArchive;
      let files: string[];

      await given('a created DocxArchive', async () => {
        archive = await DocxArchive.create();
      });

      await when('listFiles is called', () => {
        files = archive.listFiles();
      });

      await then('all required files are listed', () => {
        expect(files).toContain(DOCX_PATHS.DOCUMENT);
        expect(files).toContain(DOCX_PATHS.CONTENT_TYPES);
        expect(files).toContain('_rels/.rels');
      });
    });
  });
});

// Integration test with real DOCX if available
describe('DocxArchive with real files', () => {
  const fixturesDir = path.join(__dirname, '../../testing/fixtures');

  test.skip('loads and round-trips a real DOCX', async ({ given, when, then }: AllureBddContext) => {
    // This test requires a real DOCX file in fixtures
    const docxPath = path.join(fixturesDir, 'simple.docx');
    let archive: DocxArchive;
    let docXml: string;

    await given('a real DOCX file in fixtures', async () => {
      try {
        const buffer = await fs.readFile(docxPath);
        archive = await DocxArchive.load(buffer);
      } catch (error) {
        // Skip if fixture doesn't exist
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('Skipping: simple.docx not found in fixtures');
          return;
        }
        throw error;
      }
    });

    await when('the archive is round-tripped', async () => {
      docXml = await archive.getDocumentXml();
      const saved = await archive.save();
      const reloaded = await DocxArchive.load(saved);
      const reloadedXml = await reloaded.getDocumentXml();
      expect(reloadedXml).toBe(docXml);
    });

    await then('the round-tripped XML matches the original', () => {
      expect(docXml).toContain('w:document');
    });
  });
});
