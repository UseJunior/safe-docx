# mcp-server Spec Delta: Multi-Platform MCP Discovery

## ADDED Requirements

### Requirement: Multi-Platform Discovery Artifacts

SafeDocX SHALL provide discovery artifacts (extension manifest, install guide, context file) so that MCP-compatible AI agents beyond Claude Desktop can locate and configure the server.

#### Scenario: Gemini CLI discovers SafeDocX via extension manifest
- **GIVEN** the SafeDocX npm package is installed
- **WHEN** a Gemini CLI agent scans for MCP extension manifests
- **THEN** a valid extension manifest file is present in the package

#### Scenario: Extension manifest is valid JSON with required fields
- **GIVEN** the extension manifest file exists
- **WHEN** parsed as JSON
- **THEN** it contains the required fields for MCP server discovery

#### Scenario: AI agent configures SafeDocX from install guide
- **GIVEN** the SafeDocX install guide is present
- **WHEN** an AI agent reads the install guide
- **THEN** the guide provides sufficient information to configure the MCP server

#### Scenario: Gemini model reads context file for tool guidance
- **GIVEN** the SafeDocX context file is present
- **WHEN** a Gemini model reads the context file
- **THEN** the file provides tool usage guidance for the MCP server
