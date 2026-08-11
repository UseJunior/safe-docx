/**
 * Markup Compatibility and Extensibility (MCE) branch selection.
 *
 * Word stores one modern shape twice inside a single `mc:AlternateContent`: an
 * `mc:Choice Requires="wps"` holding the DrawingML spelling and an
 * `mc:Fallback` holding the VML spelling. Both carry a complete
 * `w:txbxContent` with real `w:p`/`w:r`/`w:t`, and exactly one of them is ever
 * rendered. A walk that does not know this counts one visual text box as two
 * and projects its text more than once.
 *
 * Two kinds of walk exist in this package and they want opposite behaviour:
 *
 * - **Presentation walks** — counting objects, numbering the user-facing
 *   ordinals in a diagnostic locator, projecting the text a reader sees — must
 *   visit exactly one branch per `mc:AlternateContent`. Those are served here.
 * - **Preservation walks** — canonicalization, scaffold fingerprinting,
 *   byte-identity checks, and any mutation that has to keep the branches
 *   consistent with each other — must visit *every* branch. Those must keep
 *   using the unfiltered DOM API; filtering them would drop content.
 *
 * Getting that distinction wrong in the second direction loses content, so the
 * selector here never returns "nothing" for an `mc:AlternateContent` that has
 * at least one branch, and `groupElementsByTagNameNS` reaches every stored copy
 * even when the branches do not correspond.
 *
 * **What the default selection policy is, and is not.** safe-docx is not a
 * renderer and performs no MCE capability detection. The default policy selects
 * the first `mc:Choice` whose `Requires` prefixes are all *declared in scope*,
 * otherwise the `mc:Fallback`. A declared prefix means the name resolves, not
 * that any consumer implements that namespace, so on a document whose
 * `mc:Choice` requires an extension the reading Word does not implement, this
 * policy selects the `mc:Choice` where that Word would render the
 * `mc:Fallback`. What the policy guarantees is that it is deterministic, that
 * it picks exactly one branch, and that it agrees with the *authoring* Word for
 * the modern text-box shapes this package identifies — which is the class the
 * text-box ordinals here exist to describe. It does not claim agreement across
 * Word versions: a document a newer Word wrote can be opened by an older Word
 * that selects the fallback. A caller modelling a particular consumer supplies
 * `isChoiceSatisfiable`; the alternative default, a hard-coded list of Office
 * extension namespaces, rots with every release and every stale entry silently
 * moves an ordinal onto the wrong object.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */

/** The Markup Compatibility and Extensibility namespace. */
export const MC_NAMESPACE =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** A namespace prefix named by an `mc:Choice` `Requires` attribute. */
export interface RequiredNamespace {
  /** The prefix exactly as written in `Requires`. */
  prefix: string;
  /** The namespace the prefix resolves to in scope, or `null` when unbound. */
  namespaceURI: string | null;
}

export interface MarkupCompatibilityOptions {
  /**
   * Decide whether an `mc:Choice` branch is one this consumer can select.
   *
   * The default is a *comparison policy*, not capability detection: it accepts
   * any `mc:Choice` whose `Requires` prefixes are all declared in scope. See
   * the module header for what that does and does not guarantee. Supply a
   * predicate here to model a specific consumer's real capabilities.
   */
  isChoiceSatisfiable?: (
    choice: Element,
    requires: readonly RequiredNamespace[],
  ) => boolean;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** True for an `mc:AlternateContent` element. */
export function isAlternateContent(node: Node): node is Element {
  return (
    isElement(node) &&
    node.namespaceURI === MC_NAMESPACE &&
    node.localName === 'AlternateContent'
  );
}

function branchKind(node: Node): 'Choice' | 'Fallback' | undefined {
  if (!isElement(node) || node.namespaceURI !== MC_NAMESPACE) return undefined;
  if (node.localName === 'Choice') return 'Choice';
  if (node.localName === 'Fallback') return 'Fallback';
  return undefined;
}

/** The namespace prefixes an `mc:Choice` declares it requires. */
export function requiredNamespaces(choice: Element): RequiredNamespace[] {
  const attribute =
    choice.getAttribute('Requires') ?? choice.getAttributeNS(null, 'Requires');
  return (attribute ?? '')
    .trim()
    .split(/\s+/u)
    .filter((prefix) => prefix.length > 0)
    .map((prefix) => ({
      prefix,
      namespaceURI: choice.lookupNamespaceURI(prefix),
    }));
}

function everyRequiredPrefixIsBound(
  _choice: Element,
  requires: readonly RequiredNamespace[],
): boolean {
  return requires.every((required) => required.namespaceURI !== null);
}

/**
 * The single `mc:Choice` or `mc:Fallback` branch this policy selects.
 *
 * Selection follows the MCE shape: the first satisfiable `mc:Choice`, otherwise
 * the `mc:Fallback`. "Satisfiable" is decided by
 * {@link MarkupCompatibilityOptions.isChoiceSatisfiable}, whose default is a
 * declaration check rather than capability detection — see the module header.
 *
 * When no `mc:Choice` is satisfiable and there is no `mc:Fallback`, the first
 * branch present is returned rather than nothing. A strict MCE processor would
 * render nothing there, but a comparison engine that walked away from authored
 * content would hide a real change behind an equality check that agrees with
 * itself.
 *
 * Returns `undefined` only for an `mc:AlternateContent` with no branches at
 * all.
 */
export function selectAlternateContentBranch(
  alternateContent: Element,
  options: MarkupCompatibilityOptions = {},
): Element | undefined {
  const isChoiceSatisfiable =
    options.isChoiceSatisfiable ?? everyRequiredPrefixIsBound;
  let firstBranch: Element | undefined;
  let fallback: Element | undefined;
  for (
    let child = alternateContent.firstChild;
    child;
    child = child.nextSibling
  ) {
    const kind = branchKind(child);
    if (!kind) continue;
    const branch = child as Element;
    firstBranch ??= branch;
    if (kind === 'Fallback') {
      fallback ??= branch;
      continue;
    }
    if (isChoiceSatisfiable(branch, requiredNamespaces(branch))) return branch;
  }
  return fallback ?? firstBranch;
}

/**
 * True when `node` sits inside an `mc:AlternateContent` branch this consumer
 * does not select — the content a reader never sees.
 *
 * Use this to filter an existing `getElementsByTagNameNS` result without
 * rewriting the walk around it.
 */
export function isUnselectedAlternateContentDescendant(
  node: Node,
  options: MarkupCompatibilityOptions = {},
): boolean {
  let current: Node | null = node;
  while (current) {
    const parent: Node | null = current.parentNode;
    if (
      parent &&
      branchKind(current) &&
      isAlternateContent(parent) &&
      selectAlternateContentBranch(parent, options) !== current
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

/**
 * One visual object and every redundant spelling of it.
 *
 * `selected` is the element a reader sees. `unselected` holds the same
 * object's copies in `mc:AlternateContent` branches nobody renders — a caller
 * that rewrites `selected` needs these so the unrendered spellings do not
 * drift away from the one on screen.
 */
export interface MarkupCompatibilityGroup {
  selected: Element;
  unselected: Element[];
  /**
   * True when the owning `mc:AlternateContent` could not be read as one object
   * stored several ways: an unselected branch held a different number of
   * matches than the selected branch, or a match sat under a child that is
   * neither `mc:Choice` nor `mc:Fallback`. The copies were still collected —
   * nothing is ever dropped — but they were paired by position against a
   * sequence that does not line up, so no caller should treat them as
   * interchangeable spellings of one thing.
   */
  unbalanced: boolean;
}

function matches(
  element: Element,
  namespaceURI: string,
  localName: string,
): boolean {
  return (
    element.namespaceURI === namespaceURI && element.localName === localName
  );
}

/**
 * Group every `namespaceURI`/`localName` match under `root` by the visual
 * object it belongs to, pairing each `mc:AlternateContent` branch's matches
 * with the selected branch's by position. Groups are in document order, except
 * that a copy belonging to no rendered object is emitted after the groups of
 * the `mc:AlternateContent` that owns it.
 *
 * **Totality:** every match the unfiltered DOM walk would return appears in
 * exactly one group, as either its `selected` or one of its `unselected`
 * elements. Matches that cannot be paired — a branch holding more copies than
 * the selected one, or a child of `mc:AlternateContent` that is neither
 * `mc:Choice` nor `mc:Fallback` — are still collected, and their group is
 * marked `unbalanced`. A caller that hashes `[selected, ...unselected]` across
 * every group therefore sees the whole document, which is what lets a
 * fail-closed guard count visually without going blind to content it does not
 * show.
 *
 * This is the walk to use when counting objects, numbering user-facing locator
 * ordinals, or projecting visible text. It is *not* the walk to use when
 * preserving or canonicalizing markup — see the module header.
 *
 * Companion work: `w:sym` glyph projection (#793) is the other place a naive
 * text walk disagrees with what Word shows; it lands separately.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 * @see https://github.com/UseJunior/safe-docx/issues/793
 */
export function groupElementsByTagNameNS(
  root: Node,
  namespaceURI: string,
  localName: string,
  options: MarkupCompatibilityOptions = {},
): MarkupCompatibilityGroup[] {
  function visit(node: Node, into: MarkupCompatibilityGroup[]): void {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!isElement(child)) continue;
      if (matches(child, namespaceURI, localName)) {
        into.push({ selected: child, unselected: [], unbalanced: false });
      }
      if (isAlternateContent(child)) {
        into.push(...alternateContentGroups(child));
        continue;
      }
      visit(child, into);
    }
  }

  function alternateContentGroups(
    alternateContent: Element,
  ): MarkupCompatibilityGroup[] {
    const chosen = selectAlternateContentBranch(alternateContent, options);
    const selectedGroups: MarkupCompatibilityGroup[] = [];
    if (chosen) visit(chosen, selectedGroups);
    // Matches that belong to no rendered object. They are still real bytes in
    // the package, so they are carried rather than dropped.
    const unpairable: MarkupCompatibilityGroup[] = [];
    for (
      let branch = alternateContent.firstChild;
      branch;
      branch = branch.nextSibling
    ) {
      if (!isElement(branch) || branch === chosen) continue;
      const branchGroups: MarkupCompatibilityGroup[] = [];
      if (matches(branch, namespaceURI, localName)) {
        branchGroups.push({
          selected: branch,
          unselected: [],
          unbalanced: false,
        });
      }
      visit(branch, branchGroups);
      if (branchGroups.length === 0) continue;
      const balanced =
        branchKind(branch) !== undefined &&
        branchGroups.length === selectedGroups.length;
      for (const [index, group] of selectedGroups.entries()) {
        if (!balanced) group.unbalanced = true;
        const twin = branchGroups[index];
        if (!twin) continue;
        group.unselected.push(twin.selected, ...twin.unselected);
        if (twin.unbalanced) group.unbalanced = true;
      }
      for (const extra of branchGroups.slice(selectedGroups.length)) {
        const last = selectedGroups[selectedGroups.length - 1];
        if (last) {
          last.unbalanced = true;
          last.unselected.push(extra.selected, ...extra.unselected);
          continue;
        }
        extra.unbalanced = true;
        unpairable.push(extra);
      }
    }
    return [...selectedGroups, ...unpairable];
  }

  const groups: MarkupCompatibilityGroup[] = [];
  if (isElement(root) && isAlternateContent(root)) {
    groups.push(...alternateContentGroups(root));
  } else {
    visit(root, groups);
  }
  return groups;
}

/**
 * `getElementsByTagNameNS` restricted to the selected branch of every
 * `mc:AlternateContent` — one entry per visual object rather than one per
 * stored copy. Results are in document order, matching the unfiltered DOM API.
 *
 * Copies in unselected branches are dropped from the result. When you need
 * them — to hash them, or to keep them in step with the copy you rewrote — use
 * {@link groupElementsByTagNameNS}, which is total over the document.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/794
 */
export function selectedElementsByTagNameNS(
  root: Node,
  namespaceURI: string,
  localName: string,
  options: MarkupCompatibilityOptions = {},
): Element[] {
  return groupElementsByTagNameNS(
    root,
    namespaceURI,
    localName,
    options,
  ).map((group) => group.selected);
}
