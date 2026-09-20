# The `into <target>` suffix — where the new Issue lands

**This is `SKILL.md` → §2a's body, read at its point of use — the moment a `new` entry is typed with
an `into <target>` suffix, not at any entry** (joshuafolkken/kit#2161). A run given a `#N` or a bare
`new` never reaches it, so it costs a workflow entry nothing to leave it here. `SKILL.md` → §2a keeps
the trigger and points here.

`kickoff new` / `fullrun new` / `halfrun new` accept a suffix naming the epic the run's artifact
belongs to. Without it the artifact belongs to no epic, and `epic:next` only ever offers an epic's
children — so a forgotten instruction parks that Issue permanently rather than losing it visibly.

```
kickoff new into #909
fullrun new into #909
halfrun new into #909
kickoff new "<title>" into #909
kickoff new into joshuafolkken/kit#909
```

`into` is the spelling because the alternatives collide with forms that already mean something else:
`kickoff new #909` reads as the existing `kickoff #N`, and `kickoff new epic #909` reads as "create a
new epic" when what gets created is often a single Issue.

- **One artifact goes in: the top-level one this run created.** No split, and it is the Issue; a
  split, and it is the epic. The children belong to that epic, not to the target.
- **Insert as soon as the artifact exists** — before implementation in `fullrun new`, before the plan
  comment in `kickoff new`. Left until the end, a run that stops halfway leaves behind exactly the
  orphaned Issue this suffix exists to prevent.
- **The insertion always goes through `pnpm josh epic --add <E> <N> [--before <M> | --after <M>]`.**
  Never hand-edit the epic body: the declaration and the `blocked-by` relations then disagree,
  `epic:next` answers `error`, and an unattended run stops.
- **Decide the position, then record why** — in the target epic's body or as an Issue comment. The
  position follows whatever criteria the target epic has already been ordered by — work whose effect
  compounds over the remaining children goes earlier, and a child already in progress is never jumped
  ahead of.
- **A target that is not an epic is refused, and the refusal names both ways out**:
  `pnpm josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or a new
  epic over both when it is itself one of the deliverables. Never promote on your own — which arm
  applies depends on what the target is, and promoting rewrites someone else's Issue into a container.
- **A cross-repository target is written `owner/repo#N`** and inserted from that repository's
  checkout; run there, since `epic --add` reads and writes only the repository it runs from
  (`prompts/collaboration-workflow/cross-repo-epic.md`). A bare `#N` resolves to this repository's
  issue of that number.
- **No suffix leaves the behavior exactly as it was.**

**It is not `epic:bundle`, and both still run.** `epic:bundle` *recommends* an epic for a newly filed
Issue and does nothing when the signal is weak; `into` is a person naming one explicitly. They are
separate routes, so the `epic:bundle` call that follows a filing happens exactly as before.
