# Issue citation — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/issue-citation.md`. It is never
read during a run, and a change to this file changes no rule. The reasons below used to sit inside the
rule text; they moved here in joshuafolkken/kit#3179.

## Why the rule exists

A running `backlogrun` reported progress as a list of bare numbers, and the owner pointed out that a
number alone says nothing about what the work is (joshuafolkken/kit#1758). The distributed documents
fixed Issue and PR **titles** in English but said nothing about how session output mentions an Issue,
so a bare number broke no rule.

Mentions before the work starts are covered too. "About to run", "waiting" and "out of scope" lists are
exactly where the reader meets numbers they have no context for; covering only after-the-fact reports
would fix half the complaint.

## Why issue:cite prints the line

The correct form needs a round trip to fetch each title, which is why mentions fell back to a bare
`#N`. `pnpm josh issue:cite` makes the cheap path and the correct path the same command.

## Why josh prints the citation form itself

A run copies josh's own output — a warning, a progress line, a refusal — into its reply verbatim, so a
bare `#N` printed by josh became a bare `#N` the Stop hook sent back (joshuafolkken/kit#3424). An Issue
number therefore reaches a string only through `issue_cite`: `session_cite.issue` links it for what a
session reads, using a title only when the caller already holds one and the repository from the work
tree's `origin` rather than a `gh` call, and `issue_cite.plain` keeps `#N` for what GitHub renders or a
program parses. A line built from `plain` by a helper that also feeds GitHub or a parser is linked
where it is printed, through `session_cite.text`. `scripts/issue/session-cite-scan.test.ts` refuses a
bare `#${…}` assembled anywhere else and counts every `plain` call against the reason its text is not
printed to the session as it is, so a new one fails until it is linked or justified.

Not every line josh prints is linked: a commit message, a PR body, a run event line or a Telegram body
keeps the plain `#N` its reader needs. A session copying one of those into a reply still cites it.

## Why the trigger is resident in CLAUDE.md

The rule fires the moment session output is about to name an Issue number, which happens on turns where
no workflow skill has been loaded. So the trigger and the format stay in `CLAUDE.md`'s Communication
section, short, and the body lives in the topic file.

## How the Stop hook delivers it

`{"decision":"block"}` is the only path by which a `Stop` hook can hand text back to the model, and
`stop_hook_active` breaks the loop, so even a false positive stalls for at most one turn
(joshuafolkken/kit#2247).
