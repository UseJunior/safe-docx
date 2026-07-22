# Safe Docx

**Lokale Dokumentinfrastruktur für Agenten, die mit Word- und OpenDocument-Dateien arbeiten.**

<!-- SYNC:badges BEGIN -->
[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)
[![npm version](https://img.shields.io/npm/v/@usejunior/safe-docx)](https://www.npmjs.com/package/@usejunior/safe-docx)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache--2.0-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/commits/main)
[![GitHub issues closed](https://img.shields.io/github/issues-closed/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/issues?q=is%3Aissue+is%3Aclosed)
<!-- SYNC:badges END -->

<!-- SYNC:lang-nav BEGIN -->
[English](./README.md) · [Español](./README.es.md) · [简体中文](./README.zh.md) · [Português](./README.pt-br.md) · [Deutsch](./README.de.md)
<!-- SYNC:lang-nav END -->

> Die englische technische Dokumentation ist die kanonische Quelle. Diese Seite bietet einen kurzen deutschen Einstieg.

Safe Docx ist ein quelloffenes TypeScript-Projekt zum Lesen, Bearbeiten, Vergleichen und Erzeugen von Dokumenten. Die primäre Schnittstelle ist ein lokaler MCP-Server, über den Agenten vorhandene `.docx`- und `.odt`-Dateien strukturerhaltend bearbeiten können.

## Erste Schritte

```bash
npm install --global @usejunior/safe-docx
```

| Leitfaden | Inhalt |
|---|---|
| [Tutorial](docs/tutorial.md) | Eine vollständige Bearbeitung von Einrichtung bis Prüfung |
| [Architektur](docs/architecture.md) | Pakete, Sitzungen und Dokumentlebenszyklus |
| [Werkzeugreferenz](packages/docx-mcp/docs/tool-reference.generated.md) | Generierte Schemas aller MCP-Werkzeuge |
| [Vertrauen und Konformität](docs/trust-and-conformance.md) | Lokale Verarbeitung, Sicherheit und ECMA-376-Umfang |
| [ECMA-376-Bericht](spec-compliance/CONFORMANCE.md) | Zielabschnitte, Ausschlüsse und Prüfnachweise |
| [Mitwirken](CONTRIBUTING.md) | Entwicklungsablauf und Repository-Regeln |

Safe Docx ist eine Infrastruktur ohne visuelle Oberfläche. Es bietet kein Rendering, keine Echtzeit-Zusammenarbeit und keine pixelgenauen Paginierungsgarantien. Das Projekt steht unter der [Apache-2.0-Lizenz](LICENSE).
