/**
 * Compile-time state shared by the part emitters.
 *
 * The context owns the part registry (part name -> content type + optional
 * document-level relationship), the relationship-id allocator, and the
 * ordered file map handed to the zip assembler. All allocation is
 * deterministic: ids are sequential counters, never random, and no part of
 * the compiler reads the clock.
 */

import { GenerationInternalError } from './errors.js';

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
  private readonly reservedNames = new Set<string>();
  private nextRid = 1;
  private nextHeaderIndex = 1;
  private nextFooterIndex = 1;
  private finalized = false;

  private assertNotFinalized(): void {
    if (this.finalized) {
      throw new GenerationInternalError('compile bug: cannot modify finalized CompileContext');
    }
  }

  /**
   * Reserve one or more part names in advance.
   *
   * Dynamic allocators (allocateHeaderPartName, allocateFooterPartName) will skip
   * reserved part names to prevent collisions.
   */
  reservePartName(name: string): void {
    this.assertNotFinalized();
    const cleanName = name.replace(/^\/+/, '');
    if (!cleanName) {
      throw new GenerationInternalError('compile bug: cannot reserve empty part name');
    }
    this.reservedNames.add(cleanName);
  }

  /** True if the part name has been explicitly reserved or registered. */
  isPartNameReserved(name: string): boolean {
    const cleanName = name.replace(/^\/+/, '');
    return this.reservedNames.has(cleanName) || this.partsByName.has(cleanName);
  }

  /** True if the part name is claimed by reservation, registration, or file content. */
  isPartNameClaimed(name: string): boolean {
    const cleanName = name.replace(/^\/+/, '');
    return (
      this.reservedNames.has(cleanName) ||
      this.partsByName.has(cleanName) ||
      this.fileContents.has(cleanName)
    );
  }

  /** True if the context has been finalized into a file record. */
  isFinalized(): boolean {
    return this.finalized;
  }

  /**
   * Register a part that needs a content-type Override (content set separately).
   *
   * Re-registering with the exact same contentType and documentRelType is idempotent.
   * Conflicting registrations (differing content types or relationship types) throw GenerationInternalError.
   */
  registerPart(name: string, contentType: string, documentRelType?: string): RegisteredPart {
    this.assertNotFinalized();
    const cleanName = name.replace(/^\/+/, '');
    if (!cleanName) {
      throw new GenerationInternalError('compile bug: cannot register empty part name');
    }
    if (this.partsByName.has(cleanName)) {
      const existing = this.partsByName.get(cleanName)!;
      if (existing.contentType !== contentType) {
        throw new GenerationInternalError(
          `Conflicting registration for part '${cleanName}': content type mismatch ('${existing.contentType}' vs '${contentType}')`,
        );
      }
      const existingRelType = existing.documentRel?.type;
      if (existingRelType !== documentRelType) {
        throw new GenerationInternalError(
          `Conflicting registration for part '${cleanName}': relationship type mismatch ('${existingRelType ?? 'none'}' vs '${documentRelType ?? 'none'}')`,
        );
      }
      return existing;
    }

    this.reservedNames.add(cleanName);
    const part: RegisteredPart = { name: cleanName, contentType };
    if (documentRelType) {
      part.documentRel = { type: documentRelType, rId: this.allocateRid() };
    }
    this.partsByName.set(cleanName, part);
    return part;
  }

  allocateRid(): string {
    this.assertNotFinalized();
    return `rId${this.nextRid++}`;
  }

  allocateHeaderPartName(): string {
    this.assertNotFinalized();
    while (true) {
      const name = `word/header${this.nextHeaderIndex++}.xml`;
      if (!this.isPartNameClaimed(name)) {
        this.reservedNames.add(name);
        return name;
      }
    }
  }

  allocateFooterPartName(): string {
    this.assertNotFinalized();
    while (true) {
      const name = `word/footer${this.nextFooterIndex++}.xml`;
      if (!this.isPartNameClaimed(name)) {
        this.reservedNames.add(name);
        return name;
      }
    }
  }

  setFileContent(name: string, content: string): void {
    this.assertNotFinalized();
    const cleanName = name.replace(/^\/+/, '');
    this.fileContents.set(cleanName, content);
  }

  getFileContent(name: string): string | undefined {
    const cleanName = name.replace(/^\/+/, '');
    return this.fileContents.get(cleanName);
  }

  registeredParts(): RegisteredPart[] {
    return Array.from(this.partsByName.values());
  }

  documentRelParts(): RegisteredPart[] {
    return this.registeredParts().filter((p) => p.documentRel);
  }

  /**
   * Assemble the final zip-file record. [Content_Types].xml is placed first -
   * createZipBuffer preserves insertion order but does not enforce ordering
   * itself, so the contract lives here.
   *
   * Enforces finalization invariants:
   * - [Content_Types].xml must have been emitted.
   * - Every registered part must have corresponding content in the file map.
   * - Marks context as finalized against subsequent mutations.
   */
  toFileRecord(): Record<string, string> {
    const contentTypes = this.fileContents.get('[Content_Types].xml');
    if (contentTypes === undefined) {
      throw new GenerationInternalError('compile bug: [Content_Types].xml was never emitted');
    }

    // Reject registered parts lacking content
    for (const part of this.partsByName.values()) {
      if (!this.fileContents.has(part.name) || this.fileContents.get(part.name) === undefined) {
        throw new GenerationInternalError(`compile bug: registered part '${part.name}' lacks content`);
      }
    }

    this.finalized = true;

    const record: Record<string, string> = { '[Content_Types].xml': contentTypes };
    for (const [name, content] of this.fileContents) {
      if (name === '[Content_Types].xml') continue;
      record[name] = content;
    }
    return record;
  }
}
