import JSZip from 'jszip';

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
