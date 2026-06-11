/**
 * Compile-time state shared by the part emitters.
 *
 * The context owns the part registry (part name → content type + optional
 * document-level relationship), the relationship-id allocator, and the
 * ordered file map handed to the zip assembler. All allocation is
 * deterministic: ids are sequential counters, never random, and no part of
 * the compiler reads the clock.
 */

export type RegisteredPart = {
  /** Zip path, e.g. 'word/header1.xml'. */
  name: string;
  /** Content type registered as an Override in [Content_Types].xml. */
  contentType: string;
  /** Relationship from word/document.xml, when the part is document-attached. */
  documentRel?: { type: string; rId: string };
};

export class CompileContext {
  private readonly partsByName = new Map<string, RegisteredPart>();
  private readonly fileContents = new Map<string, string>();
  private nextRid = 1;
  private nextHeaderIndex = 1;
  private nextFooterIndex = 1;

  /** Register a part that needs a content-type Override (content set separately). */
  registerPart(name: string, contentType: string, documentRelType?: string): RegisteredPart {
    if (this.partsByName.has(name)) {
      return this.partsByName.get(name)!;
    }
    const part: RegisteredPart = { name, contentType };
    if (documentRelType) {
      part.documentRel = { type: documentRelType, rId: this.allocateRid() };
    }
    this.partsByName.set(name, part);
    return part;
  }

  allocateRid(): string {
    return `rId${this.nextRid++}`;
  }

  allocateHeaderPartName(): string {
    return `word/header${this.nextHeaderIndex++}.xml`;
  }

  allocateFooterPartName(): string {
    return `word/footer${this.nextFooterIndex++}.xml`;
  }

  setFileContent(name: string, content: string): void {
    this.fileContents.set(name, content);
  }

  registeredParts(): RegisteredPart[] {
    return Array.from(this.partsByName.values());
  }

  documentRelParts(): RegisteredPart[] {
    return this.registeredParts().filter((p) => p.documentRel);
  }

  /**
   * Assemble the final zip-file record. [Content_Types].xml is placed first —
   * createZipBuffer preserves insertion order but does not enforce ordering
   * itself, so the contract lives here.
   */
  toFileRecord(): Record<string, string> {
    const contentTypes = this.fileContents.get('[Content_Types].xml');
    if (contentTypes === undefined) {
      throw new Error('compile bug: [Content_Types].xml was never emitted');
    }
    const record: Record<string, string> = { '[Content_Types].xml': contentTypes };
    for (const [name, content] of this.fileContents) {
      if (name === '[Content_Types].xml') continue;
      record[name] = content;
    }
    return record;
  }
}
