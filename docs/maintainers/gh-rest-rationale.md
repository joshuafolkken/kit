# `gh` in REST — rationale

Rationale behind `prompts/collaboration-workflow/gh-rest.md`.

## Why the document guard scans fences only

`scripts/gh/gh-document-guard.test.ts` scans fenced code blocks and nothing else. Extending it to
prose was measured: of 41 prose occurrences, 39 were either a quoted prohibition ("do not use
`gh issue create`") or a record of what a subcommand supports, so the guard would have needed an
allowlist of 25 entries — an allowlist that protects nothing (joshuafolkken/kit#1505). The guard stays
on fences, and the prose side is held by the rule's instruction-versus-quotation distinction in
`gh-rest.md` and that suite's marker tests.
