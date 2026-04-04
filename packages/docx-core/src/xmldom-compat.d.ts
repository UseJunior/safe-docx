/**
 * Type augmentation for @xmldom/xmldom 0.9.x
 *
 * xmldom 0.9.x defines module-scoped DOM interfaces (Element, Node, Document)
 * that don't structurally match the global DOM lib types. At runtime they're
 * the same objects — this augmentation tells TypeScript to accept global DOM
 * types where xmldom expects its own.
 */
import '@xmldom/xmldom';

declare module '@xmldom/xmldom' {
  interface XMLSerializer {
    serializeToString(node: globalThis.Node): string;
  }
}
