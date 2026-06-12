import JSZip from 'jszip';

export type ZipCompression = 'STORE' | 'DEFLATE';

export type ZipEntryInfo = {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
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

export class DocxZip {
  private zip: JSZip;

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async load(buffer: Buffer): Promise<DocxZip> {
    const zip = await JSZip.loadAsync(buffer);
    return new DocxZip(zip);
  }

  readText(path: string): Promise<string> {
    const file = this.zip.file(path);
    if (!file) throw new Error(`Missing file in .docx: ${path}`);
    return file.async('text');
  }

  async readTextOrNull(path: string): Promise<string | null> {
    const file = this.zip.file(path);
    if (!file) return null;
    return file.async('text');
  }

  writeText(path: string, text: string): void {
    // createFolders defaults to true and would add a directory entry (e.g.
    // `word/`) absent from the Word-authored input archive.
    this.zip.file(path, text, { createFolders: false });
  }

  remove(path: string): void {
    this.zip.remove(path);
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

  async toBuffer(): Promise<Buffer> {
    // OPC packages never need directory entries (Word does not emit them);
    // drop any that came in via the source archive or earlier writes so the
    // output contract is simply "zero directory entries". NOT zip.remove():
    // that deletes a folder's contents recursively.
    for (const file of Object.values(this.zip.files)) {
      if (file.dir) delete this.zip.files[file.name];
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
    // needing deterministic output pass a fixed fileDate.
    zip.file(name, value, opts?.fileDate ? { date: opts.fileDate } : undefined);
  }
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: opts?.compression ?? 'STORE',
    compressionOptions: { level: opts?.compressionLevel ?? 9 },
  });
  return out as Buffer;
}

export async function readZipText(buffer: Buffer, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) return null;
  return file.async('text');
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
