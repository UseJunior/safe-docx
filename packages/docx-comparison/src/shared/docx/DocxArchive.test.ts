import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import { DocxArchive, DOCX_PATHS } from './DocxArchive.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DocxArchive', () => {
  describe('create', () => {
    it('creates a valid minimal DOCX', async () => {
      const archive = await DocxArchive.create();

      // Should have required files
      expect(archive.hasFile(DOCX_PATHS.DOCUMENT)).toBe(true);
      expect(archive.hasFile(DOCX_PATHS.CONTENT_TYPES)).toBe(true);
      expect(archive.hasFile('_rels/.rels')).toBe(true);

      // Document should have body element
      const docXml = await archive.getDocumentXml();
      expect(docXml).toContain('w:document');
      expect(docXml).toContain('w:body');
    });

    it('can save and reload a created DOCX', async () => {
      const archive = await DocxArchive.create();
      const buffer = await archive.save();

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

  describe('setDocumentXml', () => {
    it('modifies the document XML', async () => {
      const archive = await DocxArchive.create();

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
      const retrieved = await archive.getDocumentXml();

      expect(retrieved).toContain('Hello World');
      expect(archive.getModifiedPaths()).toContain(DOCX_PATHS.DOCUMENT);
    });
  });

  describe('clone', () => {
    it('creates an independent copy', async () => {
      const original = await DocxArchive.create();
      const clone = await original.clone();

      // Modify original
      original.setDocumentXml('<w:document><w:body><w:p/></w:body></w:document>');

      // Clone should be unaffected
      const cloneXml = await clone.getDocumentXml();
      expect(cloneXml).not.toContain('<w:p/>');
    });
  });

  describe('load', () => {
    it('throws on invalid buffer', async () => {
      const invalidBuffer = Buffer.from('not a zip file');

      await expect(DocxArchive.load(invalidBuffer)).rejects.toThrow();
    });

    it('throws on ZIP without document.xml', async () => {
      // Create a ZIP that's not a DOCX
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('hello.txt', 'Hello World');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      await expect(DocxArchive.load(buffer)).rejects.toThrow('Invalid DOCX');
    });
  });

  describe('listFiles', () => {
    it('lists all files in archive', async () => {
      const archive = await DocxArchive.create();
      const files = archive.listFiles();

      expect(files).toContain(DOCX_PATHS.DOCUMENT);
      expect(files).toContain(DOCX_PATHS.CONTENT_TYPES);
      expect(files).toContain('_rels/.rels');
    });
  });
});

// Integration test with real DOCX if available
describe('DocxArchive with real files', () => {
  const fixturesDir = path.join(__dirname, '../../testing/fixtures');

  it.skip('loads and round-trips a real DOCX', async () => {
    // This test requires a real DOCX file in fixtures
    const docxPath = path.join(fixturesDir, 'simple.docx');

    try {
      const buffer = await fs.readFile(docxPath);
      const archive = await DocxArchive.load(buffer);

      const docXml = await archive.getDocumentXml();
      expect(docXml).toContain('w:document');

      // Round-trip
      const saved = await archive.save();
      const reloaded = await DocxArchive.load(saved);
      const reloadedXml = await reloaded.getDocumentXml();

      expect(reloadedXml).toBe(docXml);
    } catch (error) {
      // Skip if fixture doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('Skipping: simple.docx not found in fixtures');
        return;
      }
      throw error;
    }
  });
});
