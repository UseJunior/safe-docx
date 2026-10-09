## ADDED Requirements

### Requirement: Removing a Section Boundary Carries Its Header/Footer References Forward

When accepting a deleted paragraph mark or rejecting an inserted paragraph mark removes a paragraph-owned `w:sectPr`, the acceptance and rejection engines SHALL treat the next section in document order as the survivor: the next paragraph-owned `w:sectPr`, or else the body-level `w:sectPr`. If the survivor has no `w:headerReference` or `w:footerReference`, the engines SHALL copy every header/footer reference of the removed `w:sectPr` onto it, ahead of its other children. If the survivor has any header/footer reference of its own, the engines SHALL leave its references unchanged. The survivor SHALL keep its own `w:titlePg` and page setup. Native `acceptChanges`/`rejectChanges` and docx-compare's `acceptAllChanges`/`rejectAllChanges` SHALL apply the same rule, matching Word's Accept All and Reject All.

#### Scenario: accepting a deleted section break carries its references to a linked final section

- **GIVEN** a paragraph whose deleted mark owns a `w:sectPr` with default, first-page and even-page header and footer references, followed by a body-level `w:sectPr` with no references
- **WHEN** all changes are accepted
- **THEN** one section remains
- **AND** it is bound to the removed section's six headers and footers

#### Scenario: rejecting an inserted section break carries its references to a linked final section

- **GIVEN** an empty paragraph whose inserted mark owns a `w:sectPr` with header and footer references, followed by a body-level `w:sectPr` with no references
- **WHEN** all changes are rejected
- **THEN** one section remains
- **AND** it is bound to the removed section's headers and footers

#### Scenario: a following paragraph-level section receives the references

- **GIVEN** a removed section boundary followed by a paragraph-owned `w:sectPr` with no references and a final section with its own references
- **WHEN** the boundary is removed by accept or reject
- **THEN** the paragraph-owned survivor is bound to the removed section's headers and footers
- **AND** the final section keeps its own references

#### Scenario: a following section with any reference of its own keeps only its own

- **GIVEN** a removed section boundary with every header and footer type, followed by a section that has only a default header, or only a default footer, or only a first-page header
- **WHEN** the boundary is removed by accept or reject
- **THEN** the survivor's references are unchanged

#### Scenario: the survivor keeps its own title-page setting

- **GIVEN** a removed section boundary with `w:titlePg` and a following section without it, and a removed boundary without `w:titlePg` and a following section with it
- **WHEN** the boundary is removed by accept or reject
- **THEN** each survivor keeps its own `w:titlePg` setting and page size

#### Scenario: a survivor bound to every header and footer is unchanged

- **GIVEN** a removed section boundary followed by a section bound to all six header and footer types
- **WHEN** the boundary is removed by accept or reject
- **THEN** the survivor's `w:sectPr` is unchanged
