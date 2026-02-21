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
    this.zip.file(path, text);
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
    const out = await this.zip.generateAsync({ type: 'nodebuffer' });
    return out as Buffer;
  }
}

export async function createZipBuffer(
  files: Record<string, string | Buffer | Uint8Array>,
  opts?: { compression?: ZipCompression; compressionLevel?: number },
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, value);
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
    const stats = (file as any)?._data as ZipEntryStats | undefined;
    return {
      name: file.name,
      isDirectory: file.dir,
      compressedSize: safeNonNegativeInt(stats?.compressedSize),
      uncompressedSize: safeNonNegativeInt(stats?.uncompressedSize),
    };
  });
}
