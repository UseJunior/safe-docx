/**
 * ODF package handler (parallel to docx-core's `DocxArchive`).
 *
 * ODF is a ZIP-of-XML like DOCX, but with one sharp packaging rule that DOCX does
 * not have: the `mimetype` entry MUST be the FIRST entry in the archive and stored
 * UNCOMPRESSED (STORE, not DEFLATE). Strict ODF readers reject a package that
 * violates this.
 *
 * CRITICAL (verified against JSZip 3.10.1): a fresh JSZip honors mimetype-first +
 * `{ compression: 'STORE' }`, but if you LOAD an existing `.odt` and re-`generateAsync`
 * the loaded handle, JSZip re-emits the existing `mimetype` entry as DEFLATE
 * (method 8) — producing an invalid `.odt`. The ONLY reliable fix is to REBUILD a
 * fresh JSZip on save: write `mimetype` first with STORE, then copy every other
 * entry's decompressed content. `save()` below does exactly that. Do not "optimize"
 * it back into re-saving the loaded handle.
 */

import JSZip from 'jszip';

import { ODF_PATHS, ODT_MIMETYPE } from './namespaces.js';

export class OdfArchive {
  private zip: JSZip;
  private modified: Set<string> = new Set();

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  /**
   * Load an ODF package from a Buffer. Rejects a buffer that is missing the
   * required `content.xml` or `META-INF/manifest.xml` parts.
   */
  static async load(buffer: Buffer): Promise<OdfArchive> {
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file(ODF_PATHS.CONTENT)) {
      throw new Error('Invalid ODF: missing content.xml');
    }
    if (!zip.file(ODF_PATHS.MANIFEST)) {
      throw new Error('Invalid ODF: missing META-INF/manifest.xml');
    }
    return new OdfArchive(zip);
  }

  /** Get `content.xml` as a string. */
  async getContentXml(): Promise<string> {
    const file = this.zip.file(ODF_PATHS.CONTENT);
    if (!file) {
      throw new Error('content.xml not found');
    }
    return file.async('string');
  }

  /** Replace `content.xml`. */
  setContentXml(xml: string): void {
    this.zip.file(ODF_PATHS.CONTENT, xml);
    this.modified.add(ODF_PATHS.CONTENT);
  }

  /** Get an arbitrary part as a string, or null if absent. */
  async getFile(path: string): Promise<string | null> {
    const file = this.zip.file(path);
    if (!file) return null;
    return file.async('string');
  }

  /** Set an arbitrary part. */
  setFile(path: string, content: string): void {
    this.zip.file(path, content);
    this.modified.add(path);
  }

  /** Whether a part exists. */
  hasFile(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  /** List all non-directory entry names in the archive. */
  listFiles(): string[] {
    const files: string[] = [];
    this.zip.forEach((relativePath, file) => {
      if (!file.dir) files.push(relativePath);
    });
    return files;
  }

  /** Paths modified since load. */
  getModifiedPaths(): string[] {
    return Array.from(this.modified);
  }

  /**
   * Save the archive to a Buffer.
   *
   * Rebuilds a fresh JSZip so the `mimetype` entry is guaranteed first + STORE
   * across a load→modify→save round trip (see the class-level note). Untouched
   * entries keep byte-identical DECOMPRESSED content; the compressed container
   * bytes may differ (re-deflation), which matches the DOCX side's guarantee.
   */
  async save(): Promise<Buffer> {
    const out = new JSZip();

    // mimetype FIRST, uncompressed. Use the original value if present (it should be),
    // otherwise fall back to the ODT mimetype.
    const mimeFile = this.zip.file(ODF_PATHS.MIMETYPE);
    const mimeValue = mimeFile ? await mimeFile.async('string') : ODT_MIMETYPE;
    out.file(ODF_PATHS.MIMETYPE, mimeValue, { compression: 'STORE' });

    // Copy every other entry's decompressed content, in the loaded order.
    const names: string[] = [];
    this.zip.forEach((relativePath, file) => {
      if (relativePath === ODF_PATHS.MIMETYPE || file.dir) return;
      names.push(relativePath);
    });
    for (const name of names) {
      const file = this.zip.file(name);
      if (!file) continue;
      const content = await file.async('nodebuffer');
      out.file(name, content);
    }

    const buffer = await out.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    return buffer as Buffer;
  }
}
