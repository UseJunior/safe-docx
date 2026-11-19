/**
 * Compile-time state shared by the part emitters.
 *
 * The context owns the part registry (part name → content type + optional
 * document-level relationship), the relationship-id allocator, and the
 * ordered file map handed to the zip assembler. All allocation is
 * deterministic: ids are sequential counters, never random, and no part of
 * the compiler reads the clock.
 * This is greenfield compilation state, not an existing-package registry.
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
  private readonly reservedPartNames = new Set<string>();
  private nextRid = 1;
  private nextHeaderIndex = 1;
  private nextFooterIndex = 1;

  /**
   * Register a part that needs a content-type Override (content set separately).
   * Identical metadata is idempotent; conflicts fail before consuming an rId.
   */
  registerPart(name: string, contentType: string, documentRelType?: string): RegisteredPart {
    const existing = this.partsByName.get(name);
    if (existing) {
      if (existing.contentType !== contentType || existing.documentRel?.type !== documentRelType) {
        throw new GenerationInternalError(`Conflicting registration for part: ${name}`);
      }
      return existing;
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
    let name: string;
    do {
      name = `word/header${this.nextHeaderIndex++}.xml`;
    } while (this.isPartNameClaimed(name));
    return this.reservePartName(name);
  }

  allocateFooterPartName(): string {
    let name: string;
    do {
      name = `word/footer${this.nextFooterIndex++}.xml`;
    } while (this.isPartNameClaimed(name));
    return this.reservePartName(name);
  }

  private isPartNameClaimed(name: string): boolean {
    return this.reservedPartNames.has(name) || this.partsByName.has(name) || this.fileContents.has(name);
  }

  // A reservation prevents allocation collisions without promising a part or rId.
  private reservePartName(name: string): string {
    this.reservedPartNames.add(name);
    return name;
  }

  setFileContent(name: string, content: string): void {
    this.fileContents.set(name, content);
  }

  getFileContent(name: string): string | undefined {
    return this.fileContents.get(name);
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
   * Registered parts must have content; unused reservations need not be emitted.
   * Validation does not seal the context, so a missing emission can be supplied
   * and assembly retried without changing ids or ordering.
   */
  toFileRecord(): Record<string, string> {
    for (const part of this.partsByName.values()) {
      if (!this.fileContents.has(part.name)) {
        throw new GenerationInternalError(`Registered part has no content: ${part.name}`);
      }
    }
    const contentTypes = this.fileContents.get('[Content_Types].xml');
    if (contentTypes === undefined) {
      throw new GenerationInternalError('compile bug: [Content_Types].xml was never emitted');
    }
    const record: Record<string, string> = { '[Content_Types].xml': contentTypes };
    for (const [name, content] of this.fileContents) {
      if (name === '[Content_Types].xml') continue;
      record[name] = content;
    }
    return record;
  }
}
