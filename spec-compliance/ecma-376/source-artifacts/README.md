# Official ECMA-376 source artifacts

These four ZIP files are unchanged downloads from the [official ECMA-376
publication page](https://ecma-international.org/publications-and-standards/standards/ecma-376/),
downloaded on 2026-07-11. They are the immutable upstream source for generated
ECMA-376 metadata in this repository.

| Part | Title | Edition and publication | File |
| --- | --- | --- | --- |
| 1 | Fundamentals and Markup Language Reference | 5th edition, December 2016 | `ECMA-376-1_5th_edition_december_2016.zip` |
| 2 | Open Packaging Conventions | 5th edition, December 2021 | `ECMA-376-2_5th_edition_december_2021.zip` |
| 3 | Markup Compatibility and Extensibility | 5th edition, December 2015 | `ECMA-376-3_5th_edition_december_2015.zip` |
| 4 | Transitional Migration Features | 5th edition, December 2016 | `ECMA-376-4_5th_edition_december_2016.zip` |

Do not edit or recompress these files. `SHA256SUMS` and
`spec-compliance/manifests/ecma-376-artifacts.json` record their identities;
`npm run check:ecma-376-coverage` verifies them and all derived outputs.

The adjacent `../COPYRIGHT.txt` reproduces the Ecma text copyright notice,
license, and disclaimer. The authentic standard remains the version published
by Ecma International.
