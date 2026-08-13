import { createHash } from 'node:crypto';

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
