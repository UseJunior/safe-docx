export const TRACKED_CHANGE_ELEMENT_NAMES = [
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'pPrChange',
  'rPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
  'cellMerge',
] as const;

export type TrackedChangeElementName = typeof TRACKED_CHANGE_ELEMENT_NAMES[number];

export const TRACKED_CHANGE_ELEMENT_NAME_SET = new Set<string>(TRACKED_CHANGE_ELEMENT_NAMES);

export const REVISION_RANGE_ELEMENT_NAMES = [
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
] as const;

export const REVISION_ID_ELEMENT_NAMES = [
  ...TRACKED_CHANGE_ELEMENT_NAMES,
  ...REVISION_RANGE_ELEMENT_NAMES,
] as const;

export const REVISION_ID_ELEMENT_NAME_SET = new Set<string>(REVISION_ID_ELEMENT_NAMES);
