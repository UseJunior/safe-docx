# Proprietary comparison-oracle snapshots

`aspose-field-oracle.v1.json` is reproducible minimal-pair evidence generated locally with
`aspose-words==25.10`. `word-aspose-ilpa-measurements.v1.json` is a separately dated manual measurement record;
the minimal-pair refresh does not silently restamp it. Aspose and its license are never installed in CI.
Microsoft Word remains the primary behavioral oracle.

Refresh locally:

```bash
SAFE_DOCX_ASPOSE_PYTHON=/path/to/aspose-venv/bin/python \
SAFE_DOCX_ASPOSE_LICENSE=/path/to/Aspose.Words.lic \
npm run oracle:aspose-fields
```

With neither variable configured, the command skips without changing the snapshot. Invalid explicit
configuration fails and leaves the snapshot untouched. Diagnostics never print the license path or contents.

CI verifies deterministic fixture hashes without importing Aspose:

```bash
python3 scripts/aspose_field_oracle.py \
  --output packages/docx-compare/src/testing/oracles/aspose-field-oracle.v1.json \
  --check
python3 scripts/aspose_field_oracle.py \
  --output packages/docx-compare/src/testing/oracles/aspose-field-oracle.v1.json \
  --self-test
```
