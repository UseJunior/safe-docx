/**
 * IndexTracker manages UTF-16 code unit offset calculations for Google Docs API.
 *
 * Google Docs uses UTF-16 code unit offsets for all index-based operations.
 * This class handles:
 * - Converting between JavaScript string positions and UTF-16 code unit positions
 * - Tracking cumulative offset deltas for multi-edit batchUpdate calls
 * - Ensuring edits are applied in reverse index order
 */
export class IndexTracker {
  private deltas: Array<{ index: number; shift: number }> = [];

  /**
   * Count UTF-16 code units in a string.
   * JavaScript strings are already UTF-16, so .length gives code units.
   * This is explicitly named for clarity.
   */
  static utf16Length(text: string): number {
    return text.length; // JS strings are UTF-16
  }

  /**
   * Convert a JavaScript string index (code unit offset) to a
   * Google Docs absolute index, accounting for accumulated deltas.
   */
  adjustIndex(originalIndex: number): number {
    let adjusted = originalIndex;
    for (const delta of this.deltas) {
      if (originalIndex >= delta.index) {
        adjusted += delta.shift;
      }
    }
    return adjusted;
  }

  /**
   * Record a text deletion at a given index range.
   * Subsequent index adjustments will account for this deletion.
   */
  recordDeletion(startIndex: number, endIndex: number): void {
    const shift = -(endIndex - startIndex);
    this.deltas.push({ index: startIndex, shift });
  }

  /**
   * Record a text insertion at a given index.
   * Subsequent index adjustments will account for this insertion.
   */
  recordInsertion(index: number, text: string): void {
    const shift = IndexTracker.utf16Length(text);
    this.deltas.push({ index, shift });
  }

  /**
   * Record a replacement (deletion + insertion) at a given range.
   * Returns the net shift for this operation.
   */
  recordReplacement(startIndex: number, endIndex: number, newText: string): number {
    const deleteLen = endIndex - startIndex;
    const insertLen = IndexTracker.utf16Length(newText);
    const shift = insertLen - deleteLen;
    this.deltas.push({ index: startIndex, shift });
    return shift;
  }

  /**
   * Sort edit operations in reverse index order for batchUpdate.
   * Google Docs requires edits at higher indices to be applied first
   * to avoid index invalidation.
   */
  static sortEditsReverseOrder<T extends { startIndex: number }>(edits: T[]): T[] {
    return [...edits].sort((a, b) => b.startIndex - a.startIndex);
  }

  /**
   * Check if a character at a given position in a string is part of a surrogate pair.
   * Useful for ensuring we don't split surrogate pairs in index calculations.
   */
  static isSurrogatePair(text: string, index: number): boolean {
    const code = text.charCodeAt(index);
    return code >= 0xD800 && code <= 0xDBFF;
  }

  /**
   * Count the number of surrogate pairs (supplementary characters) in a string.
   * Each surrogate pair takes 2 UTF-16 code units but represents 1 Unicode code point.
   */
  static countSurrogatePairs(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (IndexTracker.isSurrogatePair(text, i)) {
        count++;
        i++; // Skip the low surrogate
      }
    }
    return count;
  }

  /**
   * Convert a Unicode code point offset to a UTF-16 code unit offset.
   * Needed when converting from user-visible character positions to API indices.
   */
  static codePointOffsetToUtf16(text: string, codePointOffset: number): number {
    let utf16Offset = 0;
    let cpCount = 0;
    for (const char of text) {
      if (cpCount >= codePointOffset) break;
      utf16Offset += char.length; // 1 for BMP, 2 for supplementary
      cpCount++;
    }
    return utf16Offset;
  }

  /** Reset all accumulated deltas */
  reset(): void {
    this.deltas = [];
  }
}
