# Issue comments — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/issue-comments.md`: why an
Issue's comments are read before implementing. It is never read during a run — every command, stop and
step an agent acts on stays in the procedure document, and a change to this file changes no rule.

## Why comments are read

Agreements land in comments while runs used to read bodies alone. A Tier A decision is
logged as an Issue comment; the review round cap records a dropped finding's disposition; the backlog's
decision pass writes each decision to a comment on the child; a stash left behind is recorded on the
Issue. The place a run is told to write is the place it was never told to read, and nothing in a body
says it has been superseded, so the mistake is silent.

`pnpm josh issue:read` says when a comment listing could not be read rather than showing no comments
because the conflict rule is that the later text wins, and a comment nobody read cannot win anything.
`gh issue view <N> --comments` is GraphQL-backed, so a cloud session is answered `403`;
`scripts/gh/gh-document-guard.test.ts` refuses it in a runnable block.

A `backlogrun` named issue and epic child inherit the read rather than restate it: each runs in a
delegated unit executing `fullrun`'s procedure, and the hook keys its once-per-run record on the
_fork's_ transcript, so every child is delivered to in its own right. The `rule:guard` refusal
(`scripts/rules/delivered-rules.test.ts`) reaches Claude Code alone and repeats until the comments are
read — the hook is what makes the rule hard to walk past, not the rule itself.

The procedure's body was relocated out of the entry read, which keeps the trigger (`SKILL.md` → §2) and
the pointer in every `#N` entry file — joshuafolkken/kit#2189.
