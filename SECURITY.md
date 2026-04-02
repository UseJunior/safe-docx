# Security Policy

## Supported Versions

Security fixes are prioritized for the latest published `0.x` release line and `main`.

This policy covers the published npm packages (`@usejunior/safe-docx`, `@usejunior/docx-mcp`, `@usejunior/docx-core`), the MCP server, and the CLI entrypoint.

## Reporting a Vulnerability

Please report vulnerabilities privately to `security@usejunior.com`.

Include:

- affected package(s) and version(s)
- reproduction steps or proof of concept
- impact assessment
- suggested mitigation (if available)

Do not open a public issue for an unpatched vulnerability.

## Response Expectations

- Initial acknowledgement target: within 3 business days.
- Triage and severity assessment target: within 7 business days.
- Fix timeline depends on severity and complexity.

## Disclosure Policy

We follow coordinated disclosure. Reporters will be credited in the release notes accompanying the fix unless they prefer anonymity. We will coordinate with reporters on disclosure timing.

## Scope Notes

- `safe-docx` is intended for local execution and local file editing workflows.
- All document processing runs locally. No document content is transmitted to external servers.
- External dependencies are monitored through normal dependency updates and CI.
