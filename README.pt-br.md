# Safe Docx

**Infraestrutura local de documentos para agentes que trabalham com Word e OpenDocument.**

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

> A documentação técnica em inglês é a fonte canônica. Esta página oferece uma introdução curta em português.

Safe Docx é um projeto TypeScript de código aberto para ler, editar, comparar e gerar documentos. Sua interface principal é um servidor MCP local que permite a agentes modificar arquivos `.docx` e `.odt` existentes preservando estrutura e semântica de revisão.

## Primeiros Passos

```bash
npm install --global @usejunior/safe-docx
```

| Guia | Conteúdo |
|---|---|
| [Tutorial](docs/tutorial.md) | Uma edição completa, da configuração à revisão |
| [Arquitetura](docs/architecture.md) | Pacotes, sessões e ciclo de vida do documento |
| [Referência de ferramentas](packages/docx-mcp/docs/tool-reference.generated.md) | Esquemas gerados para todas as ferramentas MCP |
| [Confiança e conformidade](docs/trust-and-conformance.md) | Processamento local, segurança e escopo ECMA-376 |
| [Relatório ECMA-376](spec-compliance/CONFORMANCE.md) | Seções-alvo, exclusões e referências de verificação |
| [Contribuição](CONTRIBUTING.md) | Fluxo de desenvolvimento e regras do repositório |

Safe Docx é infraestrutura sem interface visual. Não oferece renderização, colaboração em tempo real nem garantias de paginação pixel a pixel. O projeto usa a [licença Apache 2.0](LICENSE).
