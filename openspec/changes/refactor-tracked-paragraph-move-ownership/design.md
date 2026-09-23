## Context

ECMA-376 defines move content/range markup and paragraph-mark revisions, but terminal paragraph ownership is a consumer-sensitive composition rule. Controlled Word-native comparisons establish the reference topology:

- middle-to-middle paragraph moves retain `moveFrom`/`moveTo` paragraph-mark revisions;
- terminal-crossing moves retain moved content wrappers but replace paragraph-mark move revisions with a `del`/`ins` break pair;
- the terminal endpoint's break revision belongs to the immediately preceding stable paragraph;
- terminal-crossing range starts and ends live inside the moved endpoint paragraphs;
- Word-native comparison supplies paragraph revision-session attributes.

LibreOffice independently projects a single terminal-crossing move with stable, unrevised neighbours to the exact original/revised paragraph order and styles. Adjacent detected moves remain outside that reader-fidelity envelope.

## Goals / Non-Goals

- Goals:
  - produce schema-valid tracked moves with exact Word and LibreOffice Accept/Reject projections for one terminal-crossing move with stable, unrevised neighbours, across plain, bookmark-bearing, numbered, and genuine-empty body paragraph shapes;
  - preserve one balanced named range per move direction and independent wrapper IDs;
  - verify transformed terminal ownership without mislabeling conservative legacy fallbacks.
- Non-Goals:
  - change the comparison API or move-detection policy;
  - claim terminal note/field reader fidelity beyond measured evidence;
  - build or deploy a hosted API.

## Decisions

- Decision: derive paragraph-break ownership from source/destination terminality after tagged serialization.
  - When both endpoints are non-terminal, keep paragraph-mark `moveFrom`/`moveTo`.
  - When exactly one endpoint is terminal, convert the source break to `del` and destination break to `ins`; place each on its moved paragraph if non-terminal, otherwise on its stable predecessor.
- Decision: keep the transformation atomic and conservative. Section-bearing targets and targets carrying any other paragraph-mark revision, including another generated move endpoint, retain legacy move-mark ownership. The verifier accepts that intentional fallback while checking transformed ownership.
- Decision: adjacent detected moves are not solved by relocating a break onto another move endpoint. LibreOffice can retain a trailing empty paragraph on Reject for such legacy chains; a chain-level ownership solution needs separate reader characterization.
- Decision: synthesize deterministic `w:rsidR`/`w:rsidRDefault` on missing attributes of every direct body paragraph, excluding table paragraphs, only when Word-native terminal ownership is applied. Word 16.112 otherwise inserts a literal leading space during Accept-All on a minimal valid package.
- Decision: range-aware bookmark cleanup belongs in the internal projector because Word-native range boundaries may be direct paragraph children rather than wrapper descendants.

## Risks / Trade-offs

- Paragraph session metadata is compatibility metadata, not visible content. Existing values are preserved; only missing values are supplied.
- Table-cell terminal paragraphs have different structural requirements and are not transformed by this body-story rule.
- LibreOffice's terminal footnote predecessor behavior and field cache refresh remain separately characterized limitations, not success evidence.
- The ILPA manifest's `word/document.xml` hash change is caused by two `moveFromRangeStart` relocations from body level into their paragraphs, not bookmark projection; the terminal ownership transform does not fire on that corpus row.

## Verification

- strict OpenSpec and conformance citation gates;
- focused structure/projector tests and full package tests;
- ECMA-376 Transitional schema validation;
- LibreOffice Accept/Reject/identity matrix;
- Microsoft Word open-clean plus Accept-All/Reject-All against Word-saved identity controls;
- full repository and required real-corpus gates;
- dynamic opposite-model review before shipping.
