# Revision Identifier Policy

Safe Docx treats repeated tracked-change identifiers as a scoped comparison
safety question, not as a universal OOXML uniqueness rule. The vendored
ECMA-376 Transitional schema types tracked-change `w:id` values as decimal
numbers but does not declare an XML Schema uniqueness constraint for revision
wrappers.

## Repository Policy

One numeric revision identifier may occur on more than one sibling wrapper only
when every wrapper has the same logical signature:

- normalized revision family;
- author;
- timestamp; and
- nearest containing paragraph, table cell, table row, or table scope.

This permits serialization to split one logical deletion around a bookmark or
another non-revision boundary without inventing a second logical revision. It
does not permit an identifier to join unrelated changes. Reuse across scopes,
authors, timestamps, or normalized revision families fails the corpus safety
gate as `revision-id-reused-across-identities`.

Property-change elements are one deliberate normalization. Paragraph, run,
section, and table property-change records can be linked facets of one
formatting revision, so the gate maps those raw element kinds to one
`formatting-property-change` family when their remaining signature components
match. An insertion and deletion, by contrast, are different normalized
families and cannot share an identifier merely because they are adjacent.

Comparison-authored identifiers are also checked against identifiers already
present in the inputs. Reuse with a different signature fails as
`comparison-id-collides-with-source`.

The executable evidence is intentionally centralized in
`collectRevisionIdIssues()` and the existing strategy-differential suite. The
focused policy scenarios build minimal DOCX packages through the shared OOXML
fixture builder; they do not introduce a second validator or a hand-built ZIP
fixture.

## Consumer Evidence

The policy is narrower than any one consumer's serialization preference. The
public minimized fixture behind [issue #926](https://github.com/UseJunior/safe-docx/issues/926)
contains two same-ID sibling deletion fragments from one signature, separated
by a bookmark boundary. It validates after the repository schema checker's
Markup Compatibility preprocessing.

| Consumer | Observed behavior on the public focused fixture | Boundary |
|---|---|---|
| Aspose.Words 25.7 | Loaded 14 revisions from the eight-wrapper input. An identity save retained 14 revisions but serialized 14 uniquely identified wrappers. Accept and Reject removed every revision and retained balanced bookmarks and resolved field targets. | Aspose normalization shows that it consumes the shared-ID input but prefers unique wrapper IDs when saving. It does not establish a normative rule. |
| LibreOffice 26.2.5.2 | Opened and saved the input, and normalized the two sibling deletion fragments into one content-deletion wrapper. Its Accept projection matched Aspose exactly. | LibreOffice Reject produced three paragraphs and 77 package-visible characters, while Aspose produced three and 55; 55 matches the constructed original. Reject is therefore an explicit oracle disagreement, not ground truth. |
| Microsoft Word | No safe isolated result is recorded yet because a user-document modal blocked the non-destructive probe. | No Word compatibility claim is made until that probe completes. |

The public ILPA pair provides a broader Aspose check: its comparison serialized
602 revision wrappers with unique IDs, balanced bookmarks, and resolved
REF-family targets. Reject reproduced the original main-story text exactly.
Accept had the revised document's paragraph and character counts but retained a
small residual comparison difference, so full ILPA semantic equality is not
claimed.

## Decision Boundary

The evidence supports accepting same-signature sibling fragments as one logical
revision in the corpus gate. It does not show that every repeated-ID topology is
safe, require Safe Docx to emit repeated IDs, or turn a consumer's rewrite into
an ECMA-376 mandate. Cross-scope and cross-family collisions remain failures,
and [issue #926](https://github.com/UseJunior/safe-docx/issues/926) remains open
until the safe Word probe completes.
