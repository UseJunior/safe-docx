import { describe, it, expect } from 'vitest';
import {
  parseAnchorId,
  createAnchorId,
  isToolSupported,
  PROVIDER_CAPABILITIES,
} from '../types.js';

describe('Anchor ID parsing', () => {
  it('parses tabId:bookmarkId format', () => {
    const parsed = parseAnchorId('tab1:_bk_000000000001');
    expect(parsed.tabId).toBe('tab1');
    expect(parsed.bookmarkId).toBe('_bk_000000000001');
  });

  it('parses bookmarkId-only format (no tab)', () => {
    const parsed = parseAnchorId('_bk_000000000001');
    expect(parsed.tabId).toBeNull();
    expect(parsed.bookmarkId).toBe('_bk_000000000001');
  });

  it('handles empty string', () => {
    const parsed = parseAnchorId('');
    expect(parsed.tabId).toBeNull();
    expect(parsed.bookmarkId).toBe('');
  });

  it('handles multiple colons (first colon is separator)', () => {
    const parsed = parseAnchorId('tab:id:extra');
    expect(parsed.tabId).toBe('tab');
    expect(parsed.bookmarkId).toBe('id:extra');
  });
});

describe('Anchor ID creation', () => {
  it('creates tabId:bookmarkId when tabId provided', () => {
    expect(createAnchorId('tab1', '_bk_001')).toBe('tab1:_bk_001');
  });

  it('creates bookmarkId-only when tabId is null', () => {
    expect(createAnchorId(null, '_bk_001')).toBe('_bk_001');
  });
});

describe('Provider capabilities', () => {
  it('docx supports all core tools', () => {
    expect(isToolSupported('docx', 'read_file')).toBe(true);
    expect(isToolSupported('docx', 'replace_text')).toBe(true);
    expect(isToolSupported('docx', 'compare_documents')).toBe(true);
    expect(isToolSupported('docx', 'accept_changes')).toBe(true);
  });

  it('gdocs supports read/write tools', () => {
    expect(isToolSupported('gdocs', 'read_file')).toBe(true);
    expect(isToolSupported('gdocs', 'replace_text')).toBe(true);
    expect(isToolSupported('gdocs', 'insert_paragraph')).toBe(true);
    expect(isToolSupported('gdocs', 'grep')).toBe(true);
    expect(isToolSupported('gdocs', 'save')).toBe(true);
    expect(isToolSupported('gdocs', 'format_layout')).toBe(true);
  });

  it('gdocs does NOT support comparison/tracked changes tools', () => {
    expect(isToolSupported('gdocs', 'compare_documents')).toBe(false);
    expect(isToolSupported('gdocs', 'accept_changes')).toBe(false);
    expect(isToolSupported('gdocs', 'has_tracked_changes')).toBe(false);
    expect(isToolSupported('gdocs', 'add_comment')).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(isToolSupported('docx', 'nonexistent_tool')).toBe(false);
    expect(isToolSupported('gdocs', 'nonexistent_tool')).toBe(false);
  });

  it('gdocs capability set is a subset of docx', () => {
    for (const tool of PROVIDER_CAPABILITIES.gdocs) {
      expect(PROVIDER_CAPABILITIES.docx.has(tool)).toBe(true);
    }
  });
});
