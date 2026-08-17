# Change: Allow paired rationale visibility records

## Why

An operation may need a private decision record and a distinct external-facing
explanation, but validation currently rejects the second rationale regardless
of visibility.

## What Changes

- Permit one internal and one external-facing rationale for one operation.
- Continue rejecting duplicates within either visibility class.
- Prove external-only compilation does not place internal rationale text in any
  output DOCX part.

## Impact

- Affected specs: docx-markdoc
- Affected code: Markdoc validation and rationale-comment tests
- Related issue: #886
