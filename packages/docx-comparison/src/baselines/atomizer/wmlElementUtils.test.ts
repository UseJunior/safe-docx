import { describe, expect } from 'vitest';
import { itAllure as it } from '../../testing/allure-test.js';
import type { WmlElement } from '../../core-types.js';
import {
  removeChild,
  removeAllByTagName,
  unwrapElement,
  unwrapAllByTagName,
  renameElement,
  findAllByTagName,
  findByTagName,
  clearChildren,
  appendChild,
  insertChildAt,
  findChildByTagName,
  getChildrenByTagName,
  replaceElement,
  cloneElement,
  backfillParentReferences,
} from './wmlElementUtils.js';

/**
 * Helper to create a WmlElement with children and parent refs backfilled.
 */
function createElement(
  tagName: string,
  attrs: Record<string, string> = {},
  children?: WmlElement[],
  textContent?: string
): WmlElement {
  const el: WmlElement = { tagName, attributes: attrs };
  if (children) el.children = children;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

/**
 * Build a tree structure with parent references.
 */
function buildTree(): WmlElement {
  // Create: root > body > [p1, p2]
  // p1 > [ins > [r > t]]
  // p2 > [del > [r > t], r > t]
  const t1 = createElement('w:t', {}, undefined, 'inserted text');
  const r1 = createElement('w:r', {}, [t1]);
  const ins = createElement('w:ins', { 'w:id': '1' }, [r1]);
  const p1 = createElement('w:p', {}, [ins]);

  const t2 = createElement('w:delText', {}, undefined, 'deleted text');
  const r2 = createElement('w:r', {}, [t2]);
  const del = createElement('w:del', { 'w:id': '2' }, [r2]);

  const t3 = createElement('w:t', {}, undefined, 'normal text');
  const r3 = createElement('w:r', {}, [t3]);
  const p2 = createElement('w:p', {}, [del, r3]);

  const body = createElement('w:body', {}, [p1, p2]);
  const root = createElement('w:document', {}, [body]);

  backfillParentReferences(root);
  return root;
}

describe('wmlElementUtils', () => {
  describe('removeChild', () => {
    it('should remove a child from parent', () => {
      const child = createElement('w:t', {}, undefined, 'text');
      const parent = createElement('w:r', {}, [child]);
      backfillParentReferences(parent);

      expect(parent.children).toHaveLength(1);
      const result = removeChild(parent, child);

      expect(result).toBe(true);
      expect(parent.children).toHaveLength(0);
      expect(child.parent).toBeUndefined();
    });

    it('should return false if child not found', () => {
      const child1 = createElement('w:t', {}, undefined, 'text1');
      const child2 = createElement('w:t', {}, undefined, 'text2');
      const parent = createElement('w:r', {}, [child1]);
      backfillParentReferences(parent);

      const result = removeChild(parent, child2);
      expect(result).toBe(false);
      expect(parent.children).toHaveLength(1);
    });

    it('should return false if parent has no children', () => {
      const child = createElement('w:t');
      const parent = createElement('w:r');

      const result = removeChild(parent, child);
      expect(result).toBe(false);
    });
  });

  describe('removeAllByTagName', () => {
    it('should remove all elements with matching tag', () => {
      const root = buildTree();

      // Find w:ins and w:del elements
      const insCount = findAllByTagName(root, 'w:ins').length;
      const delCount = findAllByTagName(root, 'w:del').length;
      expect(insCount).toBe(1);
      expect(delCount).toBe(1);

      // Remove all w:del elements
      const removed = removeAllByTagName(root, 'w:del');
      expect(removed).toBe(1);

      // Verify w:del is gone
      expect(findAllByTagName(root, 'w:del')).toHaveLength(0);

      // Verify w:ins is still there
      expect(findAllByTagName(root, 'w:ins')).toHaveLength(1);
    });

    it('should handle nested elements', () => {
      // Create nested structure: outer > inner > content
      const content = createElement('w:t', {}, undefined, 'text');
      const inner = createElement('w:ins', {}, [content]);
      const outer = createElement('w:ins', {}, [inner]);
      const root = createElement('w:p', {}, [outer]);
      backfillParentReferences(root);

      expect(findAllByTagName(root, 'w:ins')).toHaveLength(2);

      const removed = removeAllByTagName(root, 'w:ins');
      // Both elements are removed - outer first, then inner fails silently
      // (its parent is already gone), but we count both attempts
      expect(removed).toBe(2);
      expect(findAllByTagName(root, 'w:ins')).toHaveLength(0);
    });
  });

  describe('unwrapElement', () => {
    it('should replace element with its children', () => {
      const t = createElement('w:t', {}, undefined, 'text');
      const r = createElement('w:r', {}, [t]);
      const ins = createElement('w:ins', { 'w:id': '1' }, [r]);
      const p = createElement('w:p', {}, [ins]);
      backfillParentReferences(p);

      expect(p.children).toHaveLength(1);
      expect(p.children![0]).toBe(ins);

      const result = unwrapElement(ins);

      expect(result).toBe(true);
      expect(p.children).toHaveLength(1);
      expect(p.children![0]).toBe(r);
      expect(r.parent).toBe(p);
      expect(ins.parent).toBeUndefined();
    });

    it('should handle element with multiple children', () => {
      const r1 = createElement('w:r');
      const r2 = createElement('w:r');
      const ins = createElement('w:ins', {}, [r1, r2]);
      const p = createElement('w:p', {}, [ins]);
      backfillParentReferences(p);

      unwrapElement(ins);

      expect(p.children).toHaveLength(2);
      expect(p.children![0]).toBe(r1);
      expect(p.children![1]).toBe(r2);
    });

    it('should handle element with no children', () => {
      const ins = createElement('w:ins', {});
      const p = createElement('w:p', {}, [ins]);
      backfillParentReferences(p);

      unwrapElement(ins);

      expect(p.children).toHaveLength(0);
    });

    it('should return false for root element', () => {
      const root = createElement('w:document');

      const result = unwrapElement(root);
      expect(result).toBe(false);
    });
  });

  describe('unwrapAllByTagName', () => {
    it('should unwrap all matching elements', () => {
      const root = buildTree();

      // Before: p1 > ins > r > t
      const insBefore = findAllByTagName(root, 'w:ins');
      expect(insBefore).toHaveLength(1);

      const count = unwrapAllByTagName(root, 'w:ins');

      expect(count).toBe(1);
      expect(findAllByTagName(root, 'w:ins')).toHaveLength(0);

      // The w:r should now be direct child of w:p
      const p1 = findAllByTagName(root, 'w:p')[0]!;
      expect(p1.children![0]!.tagName).toBe('w:r');
    });

    it('should handle nested elements correctly (deepest first)', () => {
      // Create: p > outer(ins) > inner(ins) > r
      const r = createElement('w:r');
      const inner = createElement('w:ins', { 'w:id': '2' }, [r]);
      const outer = createElement('w:ins', { 'w:id': '1' }, [inner]);
      const p = createElement('w:p', {}, [outer]);
      backfillParentReferences(p);

      expect(findAllByTagName(p, 'w:ins')).toHaveLength(2);

      const count = unwrapAllByTagName(p, 'w:ins');

      expect(count).toBe(2);
      expect(findAllByTagName(p, 'w:ins')).toHaveLength(0);
      // p should now directly contain r
      expect(p.children![0]).toBe(r);
    });
  });

  describe('renameElement', () => {
    it('should rename element tag', () => {
      const el = createElement('w:delText', {}, undefined, 'text');

      renameElement(el, 'w:t');

      expect(el.tagName).toBe('w:t');
      expect(el.textContent).toBe('text');
    });
  });

  describe('findAllByTagName', () => {
    it('should find all matching elements', () => {
      const root = buildTree();

      const runs = findAllByTagName(root, 'w:r');
      expect(runs).toHaveLength(3);

      const paragraphs = findAllByTagName(root, 'w:p');
      expect(paragraphs).toHaveLength(2);

      const texts = findAllByTagName(root, 'w:t');
      expect(texts).toHaveLength(2);
    });

    it('should return empty array if none found', () => {
      const root = buildTree();

      const result = findAllByTagName(root, 'w:nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('findByTagName', () => {
    it('should find first matching element', () => {
      const root = buildTree();

      const body = findByTagName(root, 'w:body');
      expect(body).toBeDefined();
      expect(body!.tagName).toBe('w:body');
    });

    it('should return undefined if not found', () => {
      const root = buildTree();

      const result = findByTagName(root, 'w:nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('clearChildren', () => {
    it('should remove all children', () => {
      const c1 = createElement('w:r');
      const c2 = createElement('w:r');
      const parent = createElement('w:p', {}, [c1, c2]);
      backfillParentReferences(parent);

      clearChildren(parent);

      expect(parent.children).toHaveLength(0);
      expect(c1.parent).toBeUndefined();
      expect(c2.parent).toBeUndefined();
    });
  });

  describe('appendChild', () => {
    it('should append child to parent', () => {
      const parent = createElement('w:p');
      const child = createElement('w:r');

      appendChild(parent, child);

      expect(parent.children).toHaveLength(1);
      expect(parent.children![0]).toBe(child);
      expect(child.parent).toBe(parent);
    });

    it('should create children array if not exists', () => {
      const parent: WmlElement = { tagName: 'w:p', attributes: {} };
      const child = createElement('w:r');

      appendChild(parent, child);

      expect(parent.children).toBeDefined();
      expect(parent.children).toHaveLength(1);
    });
  });

  describe('insertChildAt', () => {
    it('should insert at correct index', () => {
      const c1 = createElement('w:r');
      const c2 = createElement('w:r');
      const parent = createElement('w:p', {}, [c1, c2]);
      backfillParentReferences(parent);

      const newChild = createElement('w:ins');
      insertChildAt(parent, newChild, 1);

      expect(parent.children).toHaveLength(3);
      expect(parent.children![1]).toBe(newChild);
      expect(newChild.parent).toBe(parent);
    });
  });

  describe('findChildByTagName', () => {
    it('should find direct child', () => {
      const c1 = createElement('w:pPr');
      const c2 = createElement('w:r');
      const parent = createElement('w:p', {}, [c1, c2]);

      const result = findChildByTagName(parent, 'w:pPr');
      expect(result).toBe(c1);
    });

    it('should not find nested elements', () => {
      const nested = createElement('w:pPr');
      const wrapper = createElement('w:ins', {}, [nested]);
      const parent = createElement('w:p', {}, [wrapper]);

      const result = findChildByTagName(parent, 'w:pPr');
      expect(result).toBeUndefined();
    });
  });

  describe('getChildrenByTagName', () => {
    it('should return all matching children', () => {
      const r1 = createElement('w:r');
      const r2 = createElement('w:r');
      const pPr = createElement('w:pPr');
      const parent = createElement('w:p', {}, [pPr, r1, r2]);

      const runs = getChildrenByTagName(parent, 'w:r');
      expect(runs).toHaveLength(2);
      expect(runs).toContain(r1);
      expect(runs).toContain(r2);
    });
  });

  describe('replaceElement', () => {
    it('should replace element in parent', () => {
      const old = createElement('w:ins', {}, [createElement('w:r')]);
      const replacement = createElement('w:r');
      const parent = createElement('w:p', {}, [old]);
      backfillParentReferences(parent);

      const result = replaceElement(old, replacement);

      expect(result).toBe(true);
      expect(parent.children![0]).toBe(replacement);
      expect(replacement.parent).toBe(parent);
      expect(old.parent).toBeUndefined();
    });

    it('should return false for root element', () => {
      const root = createElement('w:document');
      const replacement = createElement('w:document');

      const result = replaceElement(root, replacement);
      expect(result).toBe(false);
    });
  });

  describe('cloneElement', () => {
    it('should create deep copy', () => {
      const original = buildTree();

      const clone = cloneElement(original);

      // Same structure
      expect(clone.tagName).toBe(original.tagName);
      expect(clone.children).toHaveLength(original.children!.length);

      // But different objects
      expect(clone).not.toBe(original);
      expect(clone.children![0]).not.toBe(original.children![0]);

      // No parent references in clone
      expect(clone.parent).toBeUndefined();
    });

    it('should copy text content', () => {
      const original = createElement('w:t', {}, undefined, 'hello');

      const clone = cloneElement(original);

      expect(clone.textContent).toBe('hello');
    });

    it('should copy attributes', () => {
      const original = createElement('w:ins', { 'w:id': '1', 'w:author': 'test' });

      const clone = cloneElement(original);

      expect(clone.attributes).toEqual({ 'w:id': '1', 'w:author': 'test' });
      // Different object
      expect(clone.attributes).not.toBe(original.attributes);
    });
  });

  describe('backfillParentReferences', () => {
    it('should set parent references', () => {
      const child = createElement('w:t');
      const parent = createElement('w:r', {}, [child]);
      const root = createElement('w:p', {}, [parent]);

      expect(child.parent).toBeUndefined();
      expect(parent.parent).toBeUndefined();

      backfillParentReferences(root);

      expect(root.parent).toBeUndefined();
      expect(parent.parent).toBe(root);
      expect(child.parent).toBe(parent);
    });
  });
});
