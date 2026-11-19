## Consumer policies

`FieldTraversal` extracts only the existing strict stack's marker transitions.
The shared strict field validator retains its rules and exact issue vocabulary;
the pinned `validateFieldStructure` predicate is untouched. Reads use the same
transitions without diagnostic callbacks and retain tolerant marker recovery.

Generation's default structural checker uses nested traversal. The differential
harness explicitly selects `fieldPairing: 'legacy-differential'` through one local
helper for both source packages and comparison output. That compatibility branch
retains main's historical scalar diagnostics, including nested-field false
positives, message text, issue order, prefix matching, and story-part scope.
These diagnostics are a reviewed characterization contract, not the normative
policy for new generated artifacts. All non-field structural checks are shared.

The committed strategy-differential manifest remains byte-identical. Synthetic
regressions assert generation accepts nesting while the same input and output
retain exact legacy source/schema diagnostics in differential characterization.
The required corpus gate verifies the entire pinned characterization, including
document bytes, projections, scores, issue sets, and inherited classifications.
