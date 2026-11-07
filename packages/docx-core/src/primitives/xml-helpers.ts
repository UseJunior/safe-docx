/**
 * Defensive XML access helpers for OOXML-style DOMs.
 *
 * DOCX parts in the wild may mix namespace-bound attributes/elements with
 * prefixed or bare names. These helpers centralize the fallback order without
 * changing each caller's null handling.
 */

export type AttributeSafeOptions = {
  /**
   * Treat empty strings as missing and continue through fallbacks.
   * Leave false for the canonical DOM getAttributeNS/getAttribute semantics.
   */
  emptyIsMissing?: boolean;
  /** Include a final bare local-name lookup after namespace/prefix fallbacks. */
  bareFallback?: boolean;
};

/**
 * Read an attribute by namespace, then optional prefix, then bare local name.
 */
export function getAttributeSafe(
  el: Element,
  ns: string,
  localName: string,
  prefix?: string,
  options?: AttributeSafeOptions,
): string | null {
  const useBareFallback = options?.bareFallback ?? true;

  if (options?.emptyIsMissing) {
    return (
      el.getAttributeNS(ns, localName) ||
      (prefix ? el.getAttribute(`${prefix}:${localName}`) : null) ||
      (useBareFallback ? el.getAttribute(localName) : null) ||
      null
    );
  }

  return (
    el.getAttributeNS(ns, localName) ??
    (prefix ? el.getAttribute(`${prefix}:${localName}`) : null) ??
    (useBareFallback ? el.getAttribute(localName) : null)
  );
}

/**
 * Return the first direct child element matching namespace/local-name, or null.
 * When `parent` is a Document, inspects direct children of `documentElement`
 * (or the document root).
 */
export function getFirstChild(parent: Element | Document, ns: string, localName: string): Element | null {
  const root: Node = parent.nodeType === 9 ? ((parent as Document).documentElement ?? parent) : parent;
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.localName === localName && el.namespaceURI === ns) return el;
  }
  return null;
}

/**
 * Return the first descendant element matching tag name, or null.
 */
export function findChild(parent: Element | Document, tagName: string): Element | null {
  return parent.getElementsByTagName(tagName).item(0) as Element | null;
}
