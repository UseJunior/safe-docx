/**
 * OpenDocument Format (ODF) XML namespace URIs and the OpenDocument text mimetype.
 *
 * ODF content is heavily namespaced; the document view MUST resolve elements via
 * `getElementsByTagNameNS` / `localName` rather than prefixed tag names, because
 * prefixes are not guaranteed by the spec.
 */
export const ODF_NS = {
  OFFICE: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  TEXT: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  STYLE: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  TABLE: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  MANIFEST: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  // Dublin Core — carries annotation/change author (`dc:creator`) and date (`dc:date`).
  DC: 'http://purl.org/dc/elements/1.1/',
  // W3C XML namespace — carries `xml:id` on `text:changed-region` for tracked changes.
  XML: 'http://www.w3.org/XML/1998/namespace',
  // XSL-FO-compatible properties (`fo:font-weight`, `fo:font-style`, …) used by style definitions.
  FO: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  // XLink — carries `xlink:href` on `text:a` hyperlinks.
  XLINK: 'http://www.w3.org/1999/xlink',
  // SVG-compatible properties (`svg:font-family` on `style:font-face` declarations).
  SVG: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  // ODF meta elements (`meta:generator`) in `meta.xml`.
  META: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
} as const;

/** The mimetype value an OpenDocument text package declares. */
export const ODT_MIMETYPE = 'application/vnd.oasis.opendocument.text';

/** Standard part paths within an ODF package. */
export const ODF_PATHS = {
  MIMETYPE: 'mimetype',
  CONTENT: 'content.xml',
  STYLES: 'styles.xml',
  META: 'meta.xml',
  MANIFEST: 'META-INF/manifest.xml',
} as const;
