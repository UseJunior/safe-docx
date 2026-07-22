# Safe Docx

**Infraestructura local para agentes que trabajan con documentos Word y OpenDocument.**

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

> La documentación técnica en inglés es la fuente canónica. Esta página ofrece una introducción breve en español.

Safe Docx es un proyecto TypeScript de código abierto para leer, editar, comparar y generar documentos. Su interfaz principal es un servidor MCP local que permite a los agentes modificar archivos `.docx` y `.odt` existentes preservando la estructura y las revisiones.

## Primeros Pasos

```bash
npm install --global @usejunior/safe-docx
```

| Guía | Contenido |
|---|---|
| [Tutorial](docs/tutorial.md) | Una edición completa, desde la configuración hasta la revisión |
| [Arquitectura](docs/architecture.md) | Paquetes, sesiones y ciclo de vida del documento |
| [Referencia de herramientas](packages/docx-mcp/docs/tool-reference.generated.md) | Esquemas generados para todas las herramientas MCP |
| [Confianza y conformidad](docs/trust-and-conformance.md) | Procesamiento local, seguridad y alcance ECMA-376 |
| [Informe ECMA-376](spec-compliance/CONFORMANCE.md) | Secciones objetivo, exclusiones y referencias de verificación |
| [Contribuir](CONTRIBUTING.md) | Flujo de desarrollo y reglas del repositorio |

Safe Docx es infraestructura sin interfaz visual. No ofrece renderizado, colaboración en tiempo real ni garantías de paginación píxel por píxel. Se distribuye bajo la [licencia Apache 2.0](LICENSE).
