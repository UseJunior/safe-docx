import { describe, it, expect } from 'vitest';
import { buildBatchUpdateRequests, buildParagraphStyleRequest, type EditOperation } from '../write-operations.js';

describe('Write Operations', () => {
  describe('buildBatchUpdateRequests', () => {
    it('builds delete request', () => {
      const edits: EditOperation[] = [
        { type: 'delete', startIndex: 5, endIndex: 10 },
      ];
      const requests = buildBatchUpdateRequests(edits);
      expect(requests).toHaveLength(1);
      expect(requests[0].deleteContentRange).toBeDefined();
      expect(requests[0].deleteContentRange!.range!.startIndex).toBe(5);
      expect(requests[0].deleteContentRange!.range!.endIndex).toBe(10);
    });

    it('builds insert request', () => {
      const edits: EditOperation[] = [
        { type: 'insert', startIndex: 5, text: 'hello' },
      ];
      const requests = buildBatchUpdateRequests(edits);
      expect(requests).toHaveLength(1);
      expect(requests[0].insertText).toBeDefined();
      expect(requests[0].insertText!.location!.index).toBe(5);
      expect(requests[0].insertText!.text).toBe('hello');
    });

    it('builds replace as delete+insert', () => {
      const edits: EditOperation[] = [
        { type: 'replace', startIndex: 5, endIndex: 10, text: 'world' },
      ];
      const requests = buildBatchUpdateRequests(edits);
      expect(requests).toHaveLength(2);
      expect(requests[0].deleteContentRange).toBeDefined();
      expect(requests[1].insertText).toBeDefined();
    });

    it('sorts edits in reverse index order', () => {
      const edits: EditOperation[] = [
        { type: 'delete', startIndex: 5, endIndex: 10 },
        { type: 'delete', startIndex: 20, endIndex: 25 },
        { type: 'delete', startIndex: 10, endIndex: 15 },
      ];
      const requests = buildBatchUpdateRequests(edits);
      // Should process index 20 first, then 10, then 5
      expect(requests[0].deleteContentRange!.range!.startIndex).toBe(20);
      expect(requests[1].deleteContentRange!.range!.startIndex).toBe(10);
      expect(requests[2].deleteContentRange!.range!.startIndex).toBe(5);
    });

    it('includes tabId when provided', () => {
      const edits: EditOperation[] = [
        { type: 'insert', startIndex: 5, text: 'test', tabId: 'tab1' },
      ];
      const requests = buildBatchUpdateRequests(edits);
      expect(requests[0].insertText!.location!.tabId).toBe('tab1');
    });
  });

  describe('buildParagraphStyleRequest', () => {
    it('builds alignment update', () => {
      const req = buildParagraphStyleRequest(0, 10, { alignment: 'CENTER' });
      expect(req.updateParagraphStyle).toBeDefined();
      expect(req.updateParagraphStyle!.fields).toContain('alignment');
    });

    it('builds indent update', () => {
      const req = buildParagraphStyleRequest(0, 10, { indentStart: 36 });
      expect(req.updateParagraphStyle!.fields).toContain('indentStart');
    });

    it('includes tabId when provided', () => {
      const req = buildParagraphStyleRequest(0, 10, { alignment: 'LEFT' }, 'tab1');
      expect(req.updateParagraphStyle!.range!.tabId).toBe('tab1');
    });
  });
});
