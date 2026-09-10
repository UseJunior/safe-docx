import { open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/** Refuse existing destinations and roll back this invocation's files on error.
 * All names are reserved before writing. Separate output paths are not crash-atomic.
 */
export async function writeNewFiles(files: Array<[string, Buffer | string]>): Promise<void> {
  const created: Array<{ name: string; handle: FileHandle; content: Buffer | string }> = [];
  try {
    for (const [name, content] of files) {
      created.push({ name, content, handle: await open(name, 'wx') });
    }
    for (const file of created) await file.handle.writeFile(file.content);
  } catch (error) {
    // Close before unlinking for platforms that cannot remove open files.
    await Promise.allSettled(created.map((file) => file.handle.close()));
    await Promise.allSettled(created.map((file) => unlink(file.name)));
    throw error;
  } finally {
    await Promise.allSettled(created.map((file) => file.handle.close()));
  }
}
