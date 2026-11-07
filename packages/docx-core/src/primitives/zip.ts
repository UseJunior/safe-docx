import JSZip from 'jszip';
import { isXmlPartPath, stripXmlLeadingNoise } from './xml.js';

export type ZipCompression = 'STORE' | 'DEFLATE';

/**
 * Fixed ZIP entry date for archives whose bytes must depend only on their
 * content. JSZip stamps each entry it writes with the current time, and the
 * DOS timestamp has 2-second resolution, so two otherwise-identical archives
 * produced on different ticks differ byte-for-byte (issue #1110). Any date on
 * or after 1980-01-01 works; 2006-01-01T00:00:00Z is the OOXML vintage.
 */
export const ZIP_EPOCH = new Date(Date.UTC(2006, 0, 1));

export type ZipEntryInfo = {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
};

export type DocxZipBufferOptions = {
  fileDate?: Date;
  overrides?: Record<string, string | Buffer | Uint8Array | null>;
};

type ZipEntryStats = {
  compressedSize?: unknown;
  uncompressedSize?: unknown;
};

function safeNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

/**
 * XML parts may legally begin with a BOM (and some producers emit whitespace
 * before `<?xml`); strip it at read time so every consumer sees markup first.
 * Re-emitted parts are written without it (#1024).
 */
function normalizePartText(path: string, text: string): string {
  return isXmlPartPath(path) ? stripXmlLeadingNoise(text) : text;
}

export class DocxZip {
  private zip: JSZip;
  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async load(buffer: Buffer): Promise<DocxZip> {
    const zip = await JSZip.loadAsync(buffer);
    return new DocxZip(zip);
  }

  async readText(path: string): Promise<string> {
    const file = this.zip.file(path);
    if (!file) throw new Error(`Missing file in .docx: ${path}`);
    return normalizePartText(path, await file.async('text'));
  }

  async readTextOrNull(path: string): Promise<string | null> {
    const file = this.zip.file(path);
    if (!file) return null;
    return normalizePartText(path, await file.async('text'));
  }

  writeText(path: string, text: string): void {
    // createFolders defaults to true and would add a directory entry (e.g.
    // `word/`) absent from the Word-authored input archive.
    this.zip.file(path, text, { createFolders: false });
  }

  hasFile(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  listFiles(): string[] {
    const files: string[] = [];
    this.zip.forEach((relativePath) => {
      files.push(relativePath);
    });
    return files;
  }

  /**
   * Return an isolated DocxZip snapshot of the archive. Subsequent writes to
   * the snapshot or to this instance do not affect each other.
   * If `overrides` are provided, those entries are written (or deleted if null).
   */
  snapshot(overrides?: Record<string, string | Buffer | Uint8Array | null>): DocxZip {
    const cloned = new JSZip();
    for (const [name, file] of Object.entries(this.zip.files)) {
      if (file.dir) continue;
      cloned.files[name] = Object.assign(Object.create(Object.getPrototypeOf(file)), file);
    }
    if (overrides) {
      for (const [path, content] of Object.entries(overrides)) {
        if (content === null || content === undefined) {
          delete cloned.files[path];
        } else {
          cloned.file(path, content, { createFolders: false });
        }
      }
    }
    return new DocxZip(cloned);
  }

  clone(overrides?: Record<string, string | Buffer | Uint8Array | null>): DocxZip {
    return this.snapshot(overrides);
  }

  /**
   * Serialize the archive.
   *
   * Serialization is fully isolated: it serializes an isolated snapshot of the
   * archive with any caller-supplied `overrides` applied, leaving this archive
   * and its in-memory entry dates completely unmodified even if serialization
   * throws an error.
   *
   * With `fileDate`, every entry in the output archive is written with that
   * date instead of the time it was (re)written, so the output depends only on
   * the entries' content.
   */
  toBuffer(opts?: DocxZipBufferOptions): Promise<Buffer> {
    const snapshot = this.snapshot(opts?.overrides);
    return snapshot.serializeDirect(opts?.fileDate);
  }

  private async serializeDirect(fileDate?: Date): Promise<Buffer> {
    if (fileDate) {
      for (const file of Object.values(this.zip.files)) {
        file.date = fileDate;
      }
    }
    // jszip defaults to STORE, which inflated saves ~6x.
    const out = await this.zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    return out as Buffer;
  }
}

export async function createZipBuffer(
  files: Record<string, string | Buffer | Uint8Array>,
  opts?: { compression?: ZipCompression; compressionLevel?: number; fileDate?: Date },
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) {
    // JSZip stamps each entry with the current time by default, which makes
    // otherwise-identical archives differ byte-for-byte across runs; callers
    // needing deterministic output pass a fixed fileDate. Directory entries
    // are unnecessary in OPC packages and otherwise retain wall-clock dates.
    zip.file(name, value, {
      createFolders: false,
      ...(opts?.fileDate ? { date: opts.fileDate } : {}),
    });
  }
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: opts?.compression ?? 'STORE',
    compressionOptions: { level: opts?.compressionLevel ?? 9 },
  });
  return out as Buffer;
}

/**
 * Read one entry of a zip buffer as text, or null when the entry is missing.
 * An XML part is normalized like `DocxZip.readText`: a leading byte-order
 * mark (and whitespace before the first `<`) is dropped, so the result can be
 * handed straight to `parseXml`.
 */
export async function readZipText(buffer: Buffer, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) return null;
  return normalizePartText(path, await file.async('text'));
}

export async function inspectZipEntries(buffer: Buffer): Promise<ZipEntryInfo[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.values(zip.files).map((file) => {
    const stats = (file as { _data?: ZipEntryStats })._data;
    return {
      name: file.name,
      isDirectory: file.dir,
      compressedSize: safeNonNegativeInt(stats?.compressedSize),
      uncompressedSize: safeNonNegativeInt(stats?.uncompressedSize),
    };
  });
}
