# Safe DOCX Suite

[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)
[![npm version](https://img.shields.io/npm/v/@usejunior/safe-docx)](https://www.npmjs.com/package/@usejunior/safe-docx)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/UseJunior/safe-docx/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/commits/main)
[![GitHub issues closed](https://img.shields.io/github/issues-closed/UseJunior/safe-docx)](https://github.com/UseJunior/safe-docx/issues?q=is%3Aissue+is%3Aclosed)

[English](./README.md) | [Español](./README.es.md) | [简体中文](./README.zh.md) | [Português (Brasil)](./README.pt-br.md) | [Deutsch](./README.de.md)

> **翻译说明：** 英文版 `README.md` 是规范的事实来源。此翻译可能会有短暂滞后。英文 README 的重大更新应在 72 小时内同步到本文件。

**safe-docx** 由 [UseJunior](https://usejunior.com) 开发 — 让编程代理也能处理文书工作。

隶属于 [UseJunior 开发者工具](https://usejunior.com/developer-tools/safe-docx)。

Safe Docx 是一套开源 TypeScript 技术栈，用于对现有 Microsoft Word `.docx` 文件进行精确编辑。它专为代理提出更改建议、人工仍需可靠且保留格式的文档编辑场景而构建。

如果你使用 AI 审阅合同，最慢的步骤往往是在 Word 中应用已接受的建议。Safe Docx 将其转化为确定性工具调用。

## 为什么需要这个项目

AI 编程 CLI 在处理代码和文本文件方面表现出色，但在编辑已有 `.docx` 文件时能力不足。商业和法律工作流仍然依赖 Word 文档，因此我们构建了原生 TypeScript 路径：

- 以 token 高效的格式读取和搜索现有文档
- 在不破坏格式的前提下进行精确编辑
- 生成干净的/带修订标记的输出和修订提取产物

使命：让编程代理也能处理文书工作。Safe Docx 专注于对现有 Word 文件的确定性编辑，确保格式和审阅语义在自动化过程中得以保留。

## 定位

Safe Docx 针对需要确定性、本地优先编辑现有 `.docx` 文件的代理工作流进行了优化：

- 用于编辑、比较、修订提取、批注、脚注和布局的类型化 MCP 工具
- 具备测试证据和可追溯性产物的可审计行为
- TypeScript 运行时分发，支持的使用场景无需 Python 或 LibreOffice

Safe Docx 不旨在替代以生成为主的 `.docx` 库。

## 标准合规性

safe-docx 针对 **ECMA-376 第 5 版** 的一个明确定义的子集。完整的范围
（目标章节、明确的非目标、验证状态）见
[spec-compliance/CONFORMANCE.md](spec-compliance/CONFORMANCE.md)。
该文件由注册表自动生成，仅以英文维护为权威版本。

## 信赖我们的用户

- **Am Law 十强律所** — 多步骤合同翻译流水线
- **150人规模区域律所** — 处理超过2200万 tokens 的合同标注
- **Gemini CLI** — 兼容的 Word 编辑 MCP 扩展

## 从这里开始

```bash
npx -y @usejunior/safe-docx
```

详细设置和工具参考请参阅 `packages/docx-mcp/README.md`。

### 示例：代理编辑合同

当你向已安装 Safe Docx 的编程代理（Claude Code、Cursor、Gemini CLI）发出提示时，代理会执行如下 MCP 工具调用：

```text
用户：编辑 ~/docs/NDA.docx 中的保密协议 — 将准据法从
      "State of New York" 改为 "State of Delaware"，
      同时保存一份干净副本和一份带修订标记的副本。

代理调用：

  1. read_file(file_path="~/docs/NDA.docx", format="toon")
     → 返回带有稳定 ID 的段落：_bk_1、_bk_2 ...

  2. grep(file_path="~/docs/NDA.docx", pattern="State of New York")
     → 在段落 _bk_47 中找到匹配

  3. replace_text(
       file_path="~/docs/NDA.docx",
       target_paragraph_id="_bk_47",
       old_string="State of New York",
       new_string="State of Delaware",
       instruction="Change governing law to Delaware"
     )

  4. save(
       file_path="~/docs/NDA.docx",
       save_to_local_path="~/docs/NDA-clean.docx",
       tracked_save_to_local_path="~/docs/NDA-tracked.docx",
       save_format="both"
     )
```

代理自动处理工具调用。你会得到一份干净文件和一份带修订标记的文件供人工审阅。

## MCP 快速开始

### Claude Code

```bash
claude mcp add safe-docx -- npx -y @usejunior/safe-docx
```

### Claude Desktop

添加到 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx"]
    }
  }
}
```

### Gemini CLI

```json
{
  "mcpServers": {
    "safe-docx": {
      "command": "npx",
      "args": ["-y", "@usejunior/safe-docx"]
    }
  }
}
```

### 任意 MCP 客户端

- **命令：** `npx`
- **参数：** `["-y", "@usejunior/safe-docx"]`
- **传输协议：** stdio

## Safe Docx 擅长什么

- 对现有 `.docx` 文件的棕地编辑
- 保留格式的文本替换和段落插入
- 批注和脚注工作流
- 带修订标记的输出供审阅（`download`、`compare_documents`）
- 将修订提取为结构化 JSON（`extract_revisions`）

## Safe Docx 不擅长什么

Safe Docx 不是从零开始的文档生成工具包。

如果你的主要需求是从模板或程序化布局生成新 `.docx` 文件，请使用 [`docx`](https://www.npmjs.com/package/docx) 等包。

## 文档类别

### 本仓库中的自动化测试覆盖

- Common Paper 风格双向 NDA 测试文件
- Bonterms 双向 NDA 测试文件
- 意向书测试文件
- ILPA 有限合伙协议红线标注测试文件

### 为复杂法律和商业 `.docx` 类别设计

- NVCA 融资表格
- YC SAFE 协议
- 发行备忘录
- 订单和服务协议
- 有限合伙协议

## 包

- `@usejunior/docx-core`：现有 `.docx` 文档的原语和比较引擎
- `@usejunior/docx-mcp`：MCP 服务器实现和工具表面
- `@usejunior/safe-docx`：规范的终端用户安装名（`npx -y @usejunior/safe-docx`）
- `@usejunior/safedocx-mcpb`：私有 MCP 打包封装

## 可靠性与信任表面

- 工具模式从 `packages/docx-mcp/src/tool_catalog.ts` 生成。
- OpenSpec 可追溯性矩阵：`packages/docx-mcp/src/testing/SAFE_DOCX_OPENSPEC_TRACEABILITY.md`
- 假设矩阵：`packages/docx-mcp/assumptions.md`
- 一致性指南：`docs/safe-docx/sprint-3-conformance.md`

## 常见问题

### Safe Docx 是什么？

一个 TypeScript 优先的 DOCX 编辑技术栈，面向需要对现有 Word 文档进行确定性、保留格式编辑的编程代理工作流。

### 编辑时是否保留格式？

这是核心设计目标。工具表面围绕精确操作（`replace_text`、`insert_paragraph`、布局控制）构建，尽可能保留文档结构和格式语义。

### 正常运行时是否需要 .NET、Python 或 LibreOffice？

不需要。支持的运行时使用 JavaScript/TypeScript 配合 `jszip` + `@xmldom/xmldom`。

### 能从零开始生成合同吗？

这不是主要关注点。从零生成请使用 [`docx`](https://www.npmjs.com/package/docx) 等包。

### 本仓库测试文件中测试了哪些文档类型？

双向 NDA（包括 Common Paper/Bonterms 风格测试文件）、意向书和 ILPA 有限合伙协议红线标注测试文件。

### 这只是给律师用的吗？

不是。同样的已有 `.docx` 文件编辑问题也出现在人力资源、采购、财务、销售运营和其他文书密集型工作流中。

### 作为 MCP 用户，我应该从哪里开始？

通过 `npx` 使用 `@usejunior/safe-docx`，然后参照 `packages/docx-mcp/README.md` 中的设置示例。

### 在哪里可以查看工具模式？

请参阅 `packages/docx-mcp/docs/tool-reference.generated.md` 中的生成参考。

## 开发

```bash
npm ci
npm run build
npm run lint --workspaces --if-present
npm run test:run
npm run check:spec-coverage
npm run test:coverage:packages
npm run coverage:packages:check
npm run coverage:matrix
```

## 另请参阅

- [Open Agreements](https://github.com/open-agreements/open-agreements) — 使用编程代理填写标准法律模板（NDA、SAFE、NVCA）
- [UseJunior 开发者工具](https://usejunior.com/developer-tools/safe-docx) — 产品页面，包含安装选项和工具目录

## 隐私

Safe Docx 完全在你的本地机器上运行。不会向外部服务器发送任何文档内容。详见我们的[隐私政策](https://usejunior.com/privacy_policy)。

## 治理

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全政策](SECURITY.md)
- [更新日志](CHANGELOG.md)
