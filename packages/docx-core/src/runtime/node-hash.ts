import { createHash } from 'node:crypto';
import { setHashBackend } from './hash.js';
// Preserve native throughput for media-heavy Node comparisons. The portable
// implementation remains the only backend reachable from the default graph.
setHashBackend((input, algorithm) => {
  const digest = createHash(algorithm);
  for (const chunk of Array.isArray(input) ? input : [input]) digest.update(chunk);
  return digest.digest('hex');
});
