# Fixture provenance and redistribution status

Every fixture is synthetic, authored for Safe DOCX test coverage, and released
under Apache-2.0 with this repository. The strings are neutral (`Alpha`,
`Beta`, `Synthetic Comment`) and are not minimized client matter content.

Leak scan (run before adding a fixture):

```sh
rg -n -i 'hawthorn|bylaws|@|[0-9]{3}-[0-9]{2}-[0-9]{4}' \
  --glob '*.xml' --glob 'index.json' packages/docx-render-verifier/fixtures
```

The scan intentionally includes XML comments and fixture metadata. A hit
requires a human provenance review before the fixture is tracked.
