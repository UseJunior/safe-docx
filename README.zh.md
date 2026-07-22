# Safe Docx

**面向处理 Word 与 OpenDocument 文件的智能体的本地文档基础设施。**

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

> 英文技术文档是规范来源。本页提供简短的中文入口。

Safe Docx 是一个开源 TypeScript 项目，用于读取、编辑、比较和生成文档。其主要接口是本地 MCP 服务器，使智能体能够在保留结构和修订语义的前提下修改现有 `.docx` 与 `.odt` 文件。

## 快速开始

```bash
npm install --global @usejunior/safe-docx
```

| 指南 | 内容 |
|---|---|
| [教程](docs/tutorial.md) | 从配置到审阅，完成一次端到端文档编辑 |
| [架构](docs/architecture.md) | 软件包、会话和文档生命周期 |
| [工具参考](packages/docx-mcp/docs/tool-reference.generated.md) | 所有 MCP 工具的生成式模式文档 |
| [信任与合规](docs/trust-and-conformance.md) | 本地处理、安全边界和 ECMA-376 范围 |
| [ECMA-376 报告](spec-compliance/CONFORMANCE.md) | 目标章节、明确排除项和验证引用 |
| [贡献指南](CONTRIBUTING.md) | 开发流程和仓库规则 |

Safe Docx 是无界面的基础设施，不提供可视化渲染、实时协作或像素级分页保证。项目采用 [Apache 2.0 许可证](LICENSE)。
