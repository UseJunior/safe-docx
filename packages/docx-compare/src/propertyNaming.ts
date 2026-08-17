import { childElements, getLeafText } from '@usejunior/docx-core';

/** Portable, deterministic representation of one direct OOXML property. */
export interface NormalizedProperty {
  tagName: string;
  attrs: [string, string][];
  text?: string;
}

/** Portable, deterministic representation of a direct OOXML property set. */
export interface NormalizedProperties {
  children: NormalizedProperty[];
}

const FRIENDLY_PROPERTY_NAMES: Readonly<Record<string, string>> = {
  'w:b': 'bold',
  'w:i': 'italic',
  'w:u': 'underline',
  'w:color': 'color',
  'w:sz': 'fontSize',
  'w:rFonts': 'fontFamily',
  'w:strike': 'strike',
  'w:highlight': 'highlight',
  'w:vertAlign': 'verticalAlign',
  'w:caps': 'caps',
  'w:bCs': 'boldComplex',
  'w:iCs': 'italicComplex',
  'w:dstrike': 'doubleStrike',
  'w:szCs': 'fontSizeComplex',
  'w:smallCaps': 'smallCaps',
  'w:vanish': 'hidden',
  'w:emboss': 'emboss',
  'w:imprint': 'imprint',
  'w:outline': 'outline',
  'w:shadow': 'shadow',
  'w:spacing': 'spacing',
  'w:w': 'width',
  'w:kern': 'kerning',
  'w:position': 'position',
  'w:jc': 'alignment',
  'w:ind': 'indentation',
  'w:pStyle': 'style',
  'w:numPr': 'numbering',
  'w:pBdr': 'borders',
  'w:shd': 'shading',
  'w:tabs': 'tabs',
  'w:keepNext': 'keepWithNext',
  'w:keepLines': 'keepLinesTogether',
  'w:pageBreakBefore': 'pageBreakBefore',
  'w:widowControl': 'widowControl',
  'w:outlineLvl': 'outlineLevel',
};

function isPriorPropertyRevision(element: Element): boolean {
  return element.localName.endsWith('PrChange');
}

/** Normalize a direct OOXML property container without retaining DOM identity. */
export function normalizeDirectProperties(properties: Element | null): NormalizedProperties {
  if (!properties) return { children: [] };
  const children = childElements(properties)
    .filter((element) => !isPriorPropertyRevision(element))
    .sort((left, right) => left.tagName.localeCompare(right.tagName))
    .map((element): NormalizedProperty => {
      const attrs: [string, string][] = [];
      for (let index = 0; index < element.attributes.length; index++) {
        const attribute = element.attributes.item(index)!;
        attrs.push([attribute.name, attribute.value]);
      }
      attrs.sort(([left], [right]) => left.localeCompare(right));
      const text = getLeafText(element);
      return text === undefined
        ? { tagName: element.tagName, attrs }
        : { tagName: element.tagName, attrs, text };
    });
  return { children };
}

function serialize(properties: NormalizedProperties): string {
  return properties.children.map((property) => JSON.stringify(property)).join('\n');
}

/** Normalize run properties for callers that need a portable comparison value. */
export function normalizeRunProperties(properties: Element | null): NormalizedProperties {
  return normalizeDirectProperties(properties);
}

/** Compare direct run-property sets without depending on DOM node identity. */
export function areRunPropertiesEqual(left: Element | null, right: Element | null): boolean {
  return serialize(normalizeDirectProperties(left)) === serialize(normalizeDirectProperties(right));
}

export { areRunPropertiesEqual as areNormalizedRunPropertiesEqual };

function propertyMap(properties: Element | null): Map<string, NormalizedProperty> {
  return new Map(normalizeDirectProperties(properties).children.map((property) => [property.tagName, property]));
}

function propertyName(tagName: string): string {
  return FRIENDLY_PROPERTY_NAMES[tagName] ?? tagName;
}

/** Return stable friendly names for every changed direct OOXML property. */
export function getChangedPropertyNames(
  original: Element | null,
  revised: Element | null,
): string[] {
  const before = propertyMap(original);
  const after = propertyMap(revised);
  const tags = new Set([...before.keys(), ...after.keys()]);
  return [...tags]
    .filter((tag) => JSON.stringify(before.get(tag)) !== JSON.stringify(after.get(tag)))
    .map(propertyName)
    .sort();
}

/** Categorize direct OOXML property changes using the same stable names. */
export function categorizePropertyChanges(
  original: Element | null,
  revised: Element | null,
): { added: string[]; removed: string[]; changed: string[] } {
  const before = propertyMap(original);
  const after = propertyMap(revised);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const tag of after.keys()) {
    if (!before.has(tag)) added.push(propertyName(tag));
  }
  for (const tag of before.keys()) {
    if (!after.has(tag)) removed.push(propertyName(tag));
    else if (JSON.stringify(before.get(tag)) !== JSON.stringify(after.get(tag))) {
      changed.push(propertyName(tag));
    }
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
  };
}
