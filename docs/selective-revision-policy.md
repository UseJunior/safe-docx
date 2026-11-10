# Selective revision preservation

An actual successful `accept_ai_edits` or `reject_ai_edits` resolution enters
preservation mode for the current session. The policy stores the last selective
action separately from its mode; that action is diagnostic history, not a list
of revisions still present. A later selective resolution updates the action.
Unknown IDs, unresolved-only selections, failed operations and unchanged package
contents do not publish policy or advance mutation bookkeeping.

Preservation remains sticky across ordinary edits, package-only changes, global
acceptance and saves. A clean or both export checks the captured document for
remaining revisions by the session's AI author, including Word XML side parts.
When any remain, save returns `SELECTIVE_REVISIONS_WOULD_BE_DISCARDED` unless
`allow_discard_preserved_revisions=true`. Tracked output retains the remaining
AI and third-party revision set. If all AI revisions are resolved, clean export
succeeds and keeps third-party history; later AI edits require acknowledgement
again. This retains the established #586 and #1084 behavior.

Acknowledgement applies to that export only. It accepts the AI subset on an
isolated export copy and does not change live XML or session policy. The
`selective_revision_action` diagnostic retains its existing inner keys:
`tool`, `selector`, `selectedRevisionIds`, `editRevision`. The internal policy
mode does not appear in this payload. Save captures the authoritative policy
before asynchronous exports and checks document, revision, author and policy
identity before publishing a cache entry.

This policy is session-scoped and adds no persisted DOCX metadata. A genuinely
new or reopened session starts in ordinary mode. File-first tools may reuse
an existing session, so a save to a new filename alone does not reset policy.

See [issue #1303](https://github.com/UseJunior/safe-docx/issues/1303) in
[epic #1295](https://github.com/UseJunior/safe-docx/issues/1295). Policy/action
separation in cocvn157's [contribution #1342](https://github.com/UseJunior/safe-docx/pull/1342)
informed the design; its reset-on-global-accept transition is intentionally not
adopted because the approved policy remains sticky for the session.
