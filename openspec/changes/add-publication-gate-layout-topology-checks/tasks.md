## 1. Implementation

- [x] 1.1 Project run-content layout characters in the round-trip text projection behind `layoutCharacters`
- [x] 1.2 Compare the gate's text with a layout-preserving normalizer
- [x] 1.3 Add the paragraph-topology projection and the `acceptParagraphTopology` / `rejectParagraphTopology` checks with failure details
- [x] 1.4 Fault-injection tests per layout construct and for dropped and added empty paragraphs; legitimate-edit and terminal-paragraph controls
- [x] 1.5 Run the real comparison corpus before and after and report the gate failure rate
- [x] 1.6 Redline a tab added, removed or re-segmented beside unchanged text
- [x] 1.7 Accept terminal paragraph-mark residue in the topology check and pin the serializer shape that leaves it
- [x] 1.8 Resolve a paragraph-mark insertion recorded in a `w:rPrChange` snapshot on Reject All
