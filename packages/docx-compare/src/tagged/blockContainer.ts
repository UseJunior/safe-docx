import { childElements } from '@usejunior/docx-core';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Distinguish block-level containers from run-level controls before revision wrapping.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.5.2.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see #1075
 */
export function isBlockContainer(element: Element): boolean {
  if (element.namespaceURI !== W_NS || !['sdt', 'customXml'].includes(element.localName)) return false;
  const hasBlockContent = (container: Element): boolean => {
    const children = container.localName === 'sdt'
      ? childElements(container)
        .filter((child) => child.namespaceURI === W_NS && child.localName === 'sdtContent')
        .flatMap((content) => childElements(content))
      : childElements(container);
    return children.some((child) => child.namespaceURI === W_NS
      && (['p', 'tbl'].includes(child.localName)
        || (['sdt', 'customXml'].includes(child.localName) && hasBlockContent(child))));
  };
  return hasBlockContent(element);
}
