# Safe Docx Conformance Assets

- Fixture manifest:
  - `fixtures.manifest.json`
- Manifest schema:
  - `fixtures.manifest.schema.v1.json`
- Report schema:
  - `report.schema.v1.json`

## Commands

- Discover fixture candidates (one-time, with provenance and SHA-256):
  - `npm run conformance:discover -w @usejunior/safe-docx`
- Run full conformance harness:
  - `npm run conformance:run -w @usejunior/safe-docx`
- Run fast smoke subset:
  - `npm run conformance:smoke -w @usejunior/safe-docx`

## Fixture Entry Fields

Each manifest fixture entry includes:

- `fixture_id`
- `source_path`
- `source_type`
- `category`
- `operations_to_run`
- `expected_checks`
- `notes`

Optional:

- `edit_spec` (`old_string`, `new_string`) for deterministic edit/tracked checks.
