## 0. Approval

- [x] 0.1 Obtain explicit owner approval before implementation

## 1. Characterization

- [x] 1.1 Capture Word-native middle, terminal-source, and terminal-destination move topology on public synthetic fixtures
- [x] 1.2 Confirm Word-native topology projects exactly in LibreOffice
- [x] 1.3 Record unsupported note/field reader limitations without promoting them to success evidence

## 2. Implementation

- [x] 2.1 Emit Word-native paragraph-break ownership for terminal-crossing whole-paragraph moves
- [x] 2.2 Normalize whole-paragraph move range placement
- [x] 2.3 Preserve schema ordering and independent move/range revision IDs
- [x] 2.4 Supply missing Word revision-session metadata only in normalized terminal move bodies
- [x] 2.5 Project bookmark boundaries enclosed by move ranges in the internal Accept/Reject engine
- [x] 2.6 Add verifier diagnostics for unnormalized terminal ownership

## 3. Verification

- [x] 3.1 Add focused structure and projection regressions
- [x] 3.2 Pass supported LibreOffice matrix for plain, bookmark, numbered, and empty-paragraph shapes
- [x] 3.3 Pass Microsoft Word Accept/Reject projections against independent identity controls
- [x] 3.4 Pass emitted-document schema controls
- [x] 3.5 Pass full repository and required public real-corpus gates

## 4. Review and shipping

- [x] 4.1 Run exact-head Claude Opus 5 opposite-model review and resolve findings
- [ ] 4.2 Commit, push, open/update the focused PR, and pass all required CI
- [ ] 4.3 Re-fetch `origin/main`, arm exact-head automerge, and complete detached merge smoke
- [ ] 4.4 Post evidence, retain unrelated follow-up worktrees, and close out only when no owner gate remains
