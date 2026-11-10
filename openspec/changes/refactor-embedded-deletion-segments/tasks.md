## 1. Implementation and verification
- [x] 1.1 Revalidate current main and reconcile contributor PR #1334.
- [x] 1.2 Validate sibling reachability before boundary splitting.
- [x] 1.3 Encapsulate segment state privately without changing public APIs.
- [x] 1.4 Cover invalid inputs and valid text/object order under accept/reject and DOCX save/reopen.
- [x] 1.5 Run mandatory build/lint/default workspace/spec/conformance and frozen real-corpus gates (4,813 default tests; 37 frozen corpus cases; seven pinned public NVCA edit/accept/reject/save/reopen smokes).
- [x] 1.6 Collect and adjudicate independent dynamic Gemini review (173 focused tests; APPROVE; existing marker XML tests cover the optional bookmark-order observation).
