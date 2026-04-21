# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.9.x` | Yes |
| `main` | Yes |
| `< 0.9` | No |

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

- Initial acknowledgement target: within 2 business days.
- Triage and severity assessment target: within 7 business days.
- Status update target for active reports: at least every 7 business days until mitigation or resolution.
- Fix timeline depends on severity and complexity.

## Scope

In scope for this document processing library:

- arbitrary code execution, command injection, or unsafe parser behavior triggered by opening, comparing, editing, or saving `.docx` files
- arbitrary file read/write, path traversal, zip slip, or temp-file leakage outside the user-requested workspace
- document content disclosure, unexpected network egress, or bypasses of the local-first execution model
- denial-of-service issues caused by hostile Office documents that can exhaust CPU, memory, or disk substantially beyond normal operation
- dependency vulnerabilities with a material confidentiality, integrity, or availability impact

Not usually treated as security vulnerabilities:

- formatting bugs, diff quality issues, or tracked-changes mismatches without a confidentiality, integrity, or availability impact
- feature requests, parser edge cases, or hardening ideas without a demonstrated exploit path
- reports against unsupported versions without a reproducible impact on a supported release

## Disclosure Policy

We follow coordinated disclosure. Reporters will be credited in the release notes accompanying the fix unless they prefer anonymity. We will coordinate with reporters on disclosure timing.

## Architecture Notes

- `safe-docx` is intended for local execution and local file editing workflows.
- All document processing runs locally. No document content is transmitted to external servers by default.
- External dependencies are monitored through normal dependency updates and CI.
