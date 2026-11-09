# `gh` in REST — rationale

Rationale behind `prompts/collaboration-workflow/gh-rest.md`.

## Why GraphQL reads came back, behind a switch

The rule began as "REST only, avoid GraphQL" because a cloud session's egress answered GraphQL `403`
(joshuafolkken/kit#1022, joshuafolkken/kit#1024). The 5,000-per-hour REST core budget then became
the limit on parallel runs (joshuafolkken/kit#6718), and GraphQL is metered apart from it. The
2026-11-08 decision (joshuafolkken/kit#6784): remote sessions are not used for now, local reads use
GraphQL to spend less REST core, and a session GraphQL refuses reads through REST. So the refusal is
handled once, per session, in `scripts/gh/git-gh-transport.ts`, not by avoiding GraphQL everywhere.
The subcommand ban stays for a reason of its own: a subcommand bypasses the `scripts/gh/` exec
layer — the ETag reads, the request tally and the transport. GraphQL merge mutations stay blocked
(`rule-delivery-rationale.md`, `sync-rationale.md`); only reads moved.

## Why the document guard scans fences only

`scripts/gh/gh-document-guard.test.ts` scans fenced code blocks and nothing else. Extending it to
prose was measured: of 41 prose occurrences, 39 were either a quoted prohibition ("do not use
`gh issue create`") or a record of what a subcommand supports, so the guard would have needed an
allowlist of 25 entries — an allowlist that protects nothing (joshuafolkken/kit#1505). The guard stays
on fences, and the prose side is held by the rule's instruction-versus-quotation distinction in
`gh-rest.md` and that suite's marker tests.
