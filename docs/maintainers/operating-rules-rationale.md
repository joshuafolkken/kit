# Operating rules — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/operating-rules.md`. It is
never read during a run, and a change to this file changes no rule.

## Rules that moved to their single source

`operating-rules.md` used to restate, in Japanese and in full, rules whose single source lives
elsewhere. Each restatement was cut to a one-line pointer in joshuafolkken/kit#2893, so a rule
addition or wording fix is written once:

- **Auto-merge and the `completion` notification** were two full sections here ("Auto-merge (default
  for `fullrun`)" and "`completion` notifications only via `pnpm josh followup`") until
  joshuafolkken/kit#1187 single-sourced them into `.claude/skills/workflow-commands/followup.md`.
  That `fullrun` itself approves the merge, that an unresolved AI review finding blocks the merge even
  on an all-green CI, the post-merge `pnpm josh ms`, never sending the `completion` Telegram by hand,
  and running `pnpm josh followup` in the foreground all live there.
- **Explicit invocation** was the fourth copy, beside `CLAUDE.md`, the workflow skill's §0 and
  `backlogrun.md`. `CLAUDE.md` keeps it resident because it has to bind on a turn where no skill
  was loaded; §0 is the skill-side single source. The session-cut reading likewise has one source,
  `backlogrun-steps.md` → "The session cut is inside the invocation".
- **The `confirmation` stop notification** was a near-verbatim copy of the `CLAUDE.md` section.
- **The working-tree hold** was restated here so its trigger sat where a turn with no keyword would
  read it, together with why `kickoff` is exempt (joshuafolkken/kit#1799), why a release names its
  run (joshuafolkken/kit#1799) and why the unit is the working tree rather than the repository
  (joshuafolkken/kit#1091). All three are in `working-tree-hold.md`, and the trigger is resident in
  the workflow skill's `working-tree-hold.md`.
- **The overrides protection** was a near-verbatim copy of `.claude/skills/dependency-update/SKILL.md`
  §1–§2, which is now its single source.

Where each one lives now:

- **Auto-merge and `completion`** — `.claude/skills/workflow-commands/followup.md` → "`auto-merge` —
  Default `fullrun` behavior" and → "Completion notifications: always via `pnpm josh followup`"
- **Explicit invocation** — `CLAUDE.md` → "Explicit invocation required (MANDATORY)" (resident) and
  `.claude/skills/workflow-commands/SKILL.md` → "0. The rule that fires before any of them — explicit
  invocation" (the skill-side single source)
- **The `confirmation` stop notification** — `CLAUDE.md` → "Mid-workflow stop notification
  (`confirmation`)"
- **The working-tree hold (`josh run:hold`)** — `.claude/skills/workflow-commands/working-tree-hold.md`
  → "The working-tree hold — one run per tree"
- **The overrides protection** — `.claude/skills/dependency-update/SKILL.md` → "1. Effective overrides
  live in the workspace — inspect both files"

## Why the index is the user's

A user sometimes stages on purpose, to keep a baseline snapshot to diff later changes against;
`git add` / `git add -A` / `git rm --cached` / `git restore --staged` overwrite it, and the index has
no history, so the overwritten state cannot be restored. Staging "to get a diff stat" or "to see an
untracked file as a diff" once destroyed exactly such a deliberate snapshot, which is why
investigation is read-only.

The prohibition is enforced by the distributed `.claude/settings.json` deny list. That list has no
"the user asked this turn" exception, so even an explicitly requested stage cannot be run by the
agent — the user runs it in their own terminal. A permanent mechanical guarantee was judged worth more
than an exception one command could route around (joshuafolkken/kit#850).

`Bash(git commit*)` is not a staging operation but sits on the same list. An agent refused `git add`
reaches next for `git commit -a` (stage every tracked file and commit), and refused that, for a bare
`git commit -m`; blocking flag by flag always left the last escape route open, so
joshuafolkken/kit#1075 widened the deny to the whole subcommand. An approved commit goes through
`pnpm josh git`, which spawns git from inside a node script and so is not matched.

## Why a handed-over stash is popped

An implementation written in conversation is sometimes stashed and handed to a run. The plan comment
on joshuafolkken/kit#3630 restored that stash with `git stash apply` and added "the executing side
does not drop it". The working-tree guard refuses `apply`, and the one authorized route,
`pnpm josh stash:pop "<message>"`, drops the stash after applying it — so the lane could satisfy
neither line, parked as `needs-decision`, and asked the owner how to apply it.

The owner's answer was to pop it: the applied content lands in the working tree and is committed from
there, so a kept stash has no use. That answer does not vary by Issue, so joshuafolkken/kit#3648
wrote it down once — the stash rule names the route, the plan-comment rule keeps the refused forms out
of a plan, and the guard's refusal tells a run that meets one to substitute `stash:pop` and record it
(Tier A). Keeping the stash remains possible, but only as the owner's decision, stated with its reason
in the plan.
