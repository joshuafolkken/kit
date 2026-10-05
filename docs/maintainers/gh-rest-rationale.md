# `gh` in REST — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/gh-rest.md`. It is never read
during a run, and a change to this file changes no rule. The guard design below used to sit inside the
rule text; it moved here in joshuafolkken/kit#3179.

## Why the document guard scans fences only

`scripts/gh/gh-document-guard.test.ts` scans fenced code blocks and nothing else. Extending it to
prose was measured: of 41 prose occurrences, 39 were either a quoted prohibition ("do not use
`gh issue create`") or a record of what a subcommand supports, so the guard would have needed an
allowlist of 25 entries — an allowlist that protects nothing (joshuafolkken/kit#1505). The guard stays
on fences, and the prose side is held by the rule's instruction-versus-quotation distinction in
`gh-rest.md` and that suite's marker tests.
