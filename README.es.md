# Safe DOCX Suite

[![CI](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml/badge.svg)](https://github.com/usejunior/safe-docx/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/usejunior/safe-docx/main)](https://app.codecov.io/gh/usejunior/safe-docx)

[English](./README.md) | [Español](./README.es.md) | [简体中文](./README.zh.md) | [Português (Brasil)](./README.pt-br.md) | [Deutsch](./README.de.md)

> **Nota de traducción:** La versión en inglés `README.md` es la fuente canónica de la verdad. Esta traducción puede tener un breve retraso. Las actualizaciones importantes del README en inglés deben sincronizarse con este archivo en un plazo de 72 horas.

**safe-docx** por [UseJunior](https://usejunior.com) — usa agentes de programación también para el papeleo.

Parte de las [herramientas para desarrolladores de UseJunior](https://usejunior.com/developer-tools/safe-docx).

Safe Docx es un stack de TypeScript de código abierto para la edición quirúrgica de archivos Microsoft Word `.docx` existentes. Está diseñado para flujos de trabajo donde un agente propone cambios y un humano aún necesita ediciones de documentos confiables que preserven el formato.

Si revisas contratos con IA, el paso más lento suele ser aplicar las recomendaciones aceptadas en Word. Safe Docx convierte eso en llamadas de herramientas deterministas.

## Por qué existe este proyecto

Los CLIs de programación con IA son excelentes con código y archivos de texto, pero débiles en la edición de archivos `.docx` existentes. Los flujos de trabajo empresariales y legales aún funcionan con documentos de Word, así que construimos una ruta nativa en TypeScript para:

- leer y buscar documentos existentes en formatos eficientes en tokens
- realizar ediciones quirúrgicas sin destruir el formato
- producir salidas limpias/con control de cambios y artefactos de extracción de revisiones

Misión: permitir que los agentes de programación también hagan papeleo. Safe Docx se enfoca en ediciones deterministas de archivos Word existentes donde el formato y la semántica de revisión deben sobrevivir a la automatización.

## Posicionamiento

Safe Docx está optimizado para flujos de trabajo de agentes que necesitan ediciones deterministas y locales de archivos `.docx` existentes:

- herramientas MCP tipadas para edición, comparación, extracción de revisiones, comentarios, notas al pie y diseño
- comportamiento auditable con evidencia de pruebas y artefactos de trazabilidad
- distribución en tiempo de ejecución TypeScript sin requerir Python o LibreOffice para el uso soportado

Safe Docx no pretende reemplazar bibliotecas de `.docx` orientadas a la generación.

## Comienza aquí

Para configuración y uso diario, ve a:

- `packages/docx-mcp/README.md`

Ejecución rápida:

```bash
npx -y @usejunior/safe-docx
```

## Para qué está optimizado Safe Docx

- Edición brownfield de archivos `.docx` existentes
- Reemplazo de texto e inserción de párrafos que preservan el formato
- Flujos de trabajo de comentarios y notas al pie
- Salidas con control de cambios para revisión (`download`, `compare_documents`)
- Extracción de revisiones como JSON estructurado (`extract_revisions`)

## Para qué no está optimizado Safe Docx

Safe Docx no es un toolkit de generación de documentos desde cero.

Si tu necesidad principal es generar nuevos archivos `.docx` desde plantillas o diseño programático, usa paquetes como [`docx`](https://www.npmjs.com/package/docx).

## Familias de documentos

### Cobertura automatizada de fixtures en este repositorio

- Fixtures de NDA mutuo estilo Common Paper
- Fixture de NDA mutuo Bonterms
- Fixture de Carta de Intención
- Fixtures de redline de acuerdo de sociedad limitada ILPA

### Diseñado para clases complejas de `.docx` legales y empresariales

- Formularios de financiamiento NVCA
- SAFEs de YC
- Memorandos de oferta
- Formularios de pedido y acuerdos de servicios
- Acuerdos de sociedad limitada

## Paquetes

- `@usejunior/docx-core`: primitivas y motor de comparación para documentos `.docx` existentes
- `@usejunior/docx-mcp`: implementación del servidor MCP y superficie de herramientas
- `@usejunior/safe-docx`: nombre canónico de instalación para el usuario final (`npx -y @usejunior/safe-docx`)
- `@usejunior/safedocx-mcpb`: wrapper privado de bundle MCP

## Confiabilidad y superficie de confianza

- Los esquemas de herramientas se generan desde `packages/docx-mcp/src/tool_catalog.ts`.
- Matriz de trazabilidad OpenSpec: `packages/docx-mcp/src/testing/SAFE_DOCX_OPENSPEC_TRACEABILITY.md`
- Matriz de supuestos: `packages/docx-mcp/assumptions.md`
- Guía de conformidad: `docs/safe-docx/sprint-3-conformance.md`

## Preguntas frecuentes

### ¿Qué es Safe Docx?

Un stack de edición DOCX con TypeScript como prioridad para flujos de trabajo de agentes de programación que necesitan ediciones deterministas y que preservan el formato en documentos Word existentes.

### ¿Preserva el formato durante las ediciones?

Ese es un objetivo central de diseño. La superficie de herramientas está construida alrededor de operaciones quirúrgicas (`replace_text`, `insert_paragraph`, controles de diseño) que preservan la estructura del documento y la semántica de formato tanto como sea posible.

### ¿Requiere .NET, Python o LibreOffice en uso normal?

No. El uso soportado en tiempo de ejecución es JavaScript/TypeScript con `jszip` + `@xmldom/xmldom`.

### ¿Puede generar contratos desde cero?

No es el enfoque principal. Para generación desde cero, usa paquetes como [`docx`](https://www.npmjs.com/package/docx).

### ¿Qué tipos de documentos se han probado en los fixtures del repositorio?

NDAs mutuos (incluyendo fixtures estilo Common Paper/Bonterms), Carta de Intención y fixtures de redline de acuerdo de sociedad limitada ILPA.

### ¿Esto es solo para abogados?

No. Los mismos problemas de edición de archivos `.docx` existentes aparecen en recursos humanos, adquisiciones, finanzas, operaciones de ventas y otros flujos de trabajo con mucho papeleo.

### ¿Por dónde debería empezar como usuario de MCP?

Usa `@usejunior/safe-docx` vía `npx`, luego sigue los ejemplos de configuración en `packages/docx-mcp/README.md`.

### ¿Dónde puedo inspeccionar los esquemas de herramientas?

Consulta la referencia generada en `packages/docx-mcp/docs/tool-reference.generated.md`.

## Desarrollo

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

## Ver también

- [Open Agreements](https://github.com/open-agreements/open-agreements) — llena plantillas legales estándar con agentes de programación (NDAs, SAFEs, NVCA)
- [Herramientas para desarrolladores UseJunior](https://usejunior.com/developer-tools/safe-docx) — página del producto con opciones de instalación y catálogo de herramientas

## Privacidad

Safe Docx se ejecuta completamente en tu máquina local. No se envía contenido de documentos a servidores externos. Consulta nuestra [Política de Privacidad](https://usejunior.com/privacy_policy) para más detalles.

## Gobernanza

- [Guía de contribución](CONTRIBUTING.md)
- [Código de conducta](CODE_OF_CONDUCT.md)
- [Política de seguridad](SECURITY.md)
- [Registro de cambios](CHANGELOG.md)
