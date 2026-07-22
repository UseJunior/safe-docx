## ADDED Requirements

### Requirement: DOCX to ODT conversion tool (`convert_to_odt`)

The MCP server SHALL provide a `convert_to_odt` tool that converts a DOCX document to an
OpenDocument Text file using odf-core's native converter. The tool SHALL accept `file_path`
(resolving or auto-opening the DOCX session by canonical path), an optional `output_path`
(defaulting to the source path with an `.odt` extension), and `allow_overwrite`. The tool's
description SHALL state that conversion is semantic and intentionally lossy.

The tool SHALL refuse to write over the source document, SHALL refuse to overwrite an existing
output file unless `allow_overwrite` is set, SHALL validate the converted package with
`validateOdfArchiveSafety` before writing (refusing to write on failure), and SHALL reach odf-core
only through the lazy `loadOdfCore()` provider loader, returning a structured `ODF_UNAVAILABLE`
error when the provider cannot be loaded. On success it SHALL return the written path, bytes
written, and the converter's lossiness summary.

#### Scenario: [OCNV-01] convert_to_odt writes a valid .odt and reports lossiness
- **WHEN** `convert_to_odt` is invoked with the `file_path` of a `.docx` and an `output_path`
- **THEN** a valid `.odt` passing `validateOdfArchiveSafety` is written there and the response carries `output_path`, `bytes_written`, and the `lossiness` summary

#### Scenario: [OCNV-02] convert_to_odt defaults the output path to the source with .odt
- **WHEN** `convert_to_odt` is invoked without `output_path`
- **THEN** the output is written next to the source with the `.docx` extension replaced by `.odt` and the response echoes that path

#### Scenario: [OCNV-03] convert_to_odt refuses to overwrite without allow_overwrite
- **WHEN** `convert_to_odt` targets an existing output file without `allow_overwrite`
- **THEN** a structured error is returned, the file is untouched, and retrying with `allow_overwrite: true` succeeds

#### Scenario: [OCNV-04] convert_to_odt refuses to clobber the source document
- **WHEN** `convert_to_odt` is invoked with an `output_path` that resolves to the source document itself
- **THEN** a structured error is returned and the source file is untouched

#### Scenario: [OCNV-05] convert_to_odt returns ODF_UNAVAILABLE when the provider is missing
- **WHEN** `convert_to_odt` is invoked while `loadOdfCore()` resolves to null
- **THEN** the tool returns a structured `ODF_UNAVAILABLE` error instead of throwing
