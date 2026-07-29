export const OOXML = {
  // Main WordprocessingML namespace.
  W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  // Relationships, package, etc. kept for future parts.
  REL_NS: 'http://schemas.openxmlformats.org/package/2006/relationships',
  // Relationship namespace used inside .rels parts (document relationships).
  R_NS: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  // Hyperlink relationship type URI.
  HYPERLINK_REL_TYPE: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  // Word 2010 extensions (paraId attributes).
  W14_NS: 'http://schemas.microsoft.com/office/word/2010/wordml',
  // Word 2012 extensions (commentsExtended, threaded replies).
  W15_NS: 'http://schemas.microsoft.com/office/word/2012/wordml',
  // People part namespace.
  WPC_NS: 'http://schemas.microsoft.com/office/word/2012/wordml',
  // Content-types part namespace.
  CT_NS: 'http://schemas.openxmlformats.org/package/2006/content-types',
} as const;

export const W = {
  document: 'document',
  body: 'body',
  p: 'p',
  r: 'r',
  t: 't',
  pPr: 'pPr',
  pBdr: 'pBdr',
  rPr: 'rPr',
  bookmarkStart: 'bookmarkStart',
  bookmarkEnd: 'bookmarkEnd',

  // Paragraph formatting
  pStyle: 'pStyle',
  outlineLvl: 'outlineLvl',
  jc: 'jc',
  ind: 'ind',
  spacing: 'spacing',
  before: 'before',
  after: 'after',
  line: 'line',
  lineRule: 'lineRule',

  // Run formatting
  rFonts: 'rFonts',
  b: 'b',
  i: 'i',
  caps: 'caps',
  smallCaps: 'smallCaps',
  strike: 'strike',
  emboss: 'emboss',
  imprint: 'imprint',
  outline: 'outline',
  shadow: 'shadow',
  vanish: 'vanish',
  u: 'u',
  highlight: 'highlight',
  sz: 'sz',
  szCs: 'szCs',
  color: 'color',
  vertAlign: 'vertAlign',
  position: 'position',

  // Styles part
  style: 'style',
  name: 'name',
  basedOn: 'basedOn',

  // Numbering
  numPr: 'numPr',
  numId: 'numId',
  ilvl: 'ilvl',
  numbering: 'numbering',
  abstractNum: 'abstractNum',
  lvl: 'lvl',
  start: 'start',
  numFmt: 'numFmt',
  lvlText: 'lvlText',
  suff: 'suff',
  num: 'num',
  abstractNumId: 'abstractNumId',
  lvlOverride: 'lvlOverride',
  startOverride: 'startOverride',
  lvlJc: 'lvlJc',
  multiLevelType: 'multiLevelType',

  // Tables + layout
  tbl: 'tbl',
  tr: 'tr',
  tc: 'tc',
  trPr: 'trPr',
  tcPr: 'tcPr',
  trHeight: 'trHeight',
  tcMar: 'tcMar',
  tblPr: 'tblPr',
  tblGrid: 'tblGrid',
  gridCol: 'gridCol',
  tblW: 'tblW',
  tblLayout: 'tblLayout',
  tblBorders: 'tblBorders',
  tcBorders: 'tcBorders',
  tcW: 'tcW',
  gridSpan: 'gridSpan',
  vMerge: 'vMerge',
  vAlign: 'vAlign',
  shd: 'shd',
  tblHeader: 'tblHeader',
  insideH: 'insideH',
  insideV: 'insideV',
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  between: 'between',
  end: 'end',
  val: 'val',
  hRule: 'hRule',
  w: 'w',
  type: 'type',

  // Sections + page setup (generation emitters)
  sectPr: 'sectPr',
  pgSz: 'pgSz',
  pgMar: 'pgMar',
  pgNumType: 'pgNumType',
  headerReference: 'headerReference',
  footerReference: 'footerReference',
  titlePg: 'titlePg',
  hdr: 'hdr',
  ftr: 'ftr',
  settings: 'settings',
  evenAndOddHeaders: 'evenAndOddHeaders',
  clrSchemeMapping: 'clrSchemeMapping',
  compat: 'compat',
  compatSetting: 'compatSetting',

  // Styles part + paragraph/run formatting (generation emitters)
  docDefaults: 'docDefaults',
  pPrDefault: 'pPrDefault',
  rPrDefault: 'rPrDefault',
  next: 'next',
  qFormat: 'qFormat',
  bCs: 'bCs',
  iCs: 'iCs',
  keepNext: 'keepNext',
  keepLines: 'keepLines',
  pageBreakBefore: 'pageBreakBefore',
  tabs: 'tabs',

  // Fields + special runs
  fldChar: 'fldChar',
  instrText: 'instrText',
  fldSimple: 'fldSimple',
  tab: 'tab',
  br: 'br',

  // Hyperlinks + character styles
  hyperlink: 'hyperlink',
  rStyle: 'rStyle',

  // Comments
  comment: 'comment',
  comments: 'comments',
  commentRangeStart: 'commentRangeStart',
  commentRangeEnd: 'commentRangeEnd',
  commentReference: 'commentReference',
  annotationRef: 'annotationRef',

  // Footnotes
  footnote: 'footnote',
  footnotes: 'footnotes',
  footnoteReference: 'footnoteReference',
  footnoteRef: 'footnoteRef',
  separator: 'separator',
  continuationSeparator: 'continuationSeparator',

  // Endnotes
  endnoteReference: 'endnoteReference',

  // Embedded visual content (run-level children)
  drawing: 'drawing',
  pict: 'pict',
  object: 'object',

  // Revision wrappers
  del: 'del',
  moveFrom: 'moveFrom',

  // Font table (word/fontTable.xml)
  font: 'font',
  charset: 'charset',
  family: 'family',
  pitch: 'pitch',
} as const;
