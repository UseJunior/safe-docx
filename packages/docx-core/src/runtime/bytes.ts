const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode portable DOCX bytes for APIs such as Office.js insertFileFromBase64. */
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  // Bound intermediate strings without spreading large arrays onto the stack.
  for (let start = 0; start < bytes.length; start += 12288) {
    let text = '';
    const end = Math.min(start + 12288, bytes.length);
    for (let i = start; i < end; i += 3) {
      const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
      text += BASE64[a >>> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >>> 4)]! +
        (b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >>> 6)]!) +
        (c === undefined ? '=' : BASE64[c & 63]!);
    }
    chunks.push(text);
  }
  return chunks.join('');
}
