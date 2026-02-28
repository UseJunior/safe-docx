import { describe, expect, it } from 'vitest';
import {
  stripHighlightTags,
} from '../src/primitives/semantic_tags.js';

describe('Traceability: docx-primitives — Semantic Tags', () => {
  it('Scenario: strip highlight tags leaves content intact', async () => {
    const text = 'Some <highlight>important</highlight> text';
    const result = stripHighlightTags(text);
    expect(result).toBe('Some important text');
    expect(result).not.toContain('<highlight>');
  });

  it('Scenario: strip legacy highlighting tags leaves content intact', async () => {
    const text = 'Some <highlighting>important</highlighting> text';
    const result = stripHighlightTags(text);
    expect(result).toBe('Some important text');
    expect(result).not.toContain('<highlighting>');
  });
});
