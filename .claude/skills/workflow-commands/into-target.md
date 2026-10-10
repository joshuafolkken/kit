# The `into <target>` suffix — where the new Issue lands

**This file is the suffix's single source, read at its point of use — the moment a `new` entry is
typed with an `into <target>` suffix, not at any entry.** A run given a `#N` or a bare `new` never
reaches it. `SKILL.md` → §2's table keeps the trigger and points here. Rationale:
`docs/maintainers/into-target-rationale.md` → "Why the suffix reads as it does".

`kickoff new` / `fullrun new` / `halfrun new` accept a suffix naming the epic the run's artifact
belongs to. Without it the artifact belongs to no epic, and `epic:next` only ever offers an epic's
children — so a forgotten instruction parks that Issue permanently rather than losing it visibly.

```
kickoff new into #<E>
fullrun new into #<E>
halfrun new into #<E>
kickoff new "<title>" into #<E>
kickoff new into joshuafolkken/kit#<E>
```

- **One artifact goes in: the top-level one this run created.** No split, and it is the Issue; a
  split, and it is the epic. The children belong to that epic, not to the target.
- **Insert as soon as the artifact exists** — before implementation in `fullrun new`, before the plan
  comment in `kickoff new`.
- **The insertion always goes through `pnpm josh epic --add <E> <N> [--before <M> | --after <M>]`.**
  Never hand-edit the epic body: the declaration and the `blocked-by` relations then disagree,
  `epic:next` answers `error`, and an unattended run stops.
- **Decide the position, then record why** — in the target epic's body or as an Issue comment. The
  position follows whatever criteria the target epic has already been ordered by — work whose effect
  compounds over the remaining children goes earlier, and a child already in progress is never jumped
  ahead of.
- **A target that is not an epic is refused, and the refusal names both ways out**:
  `pnpm josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or a new
  epic over both when it is itself one of the deliverables. Never promote on your own.
- **A cross-repository target is written `owner/repo#N`** and inserted from that repository's
  checkout; run there, since `epic --add` reads and writes only the repository it runs from
  (`.claude/skills/epic-commands/SKILL.md` → "Epics that span repositories"). A bare `#N` resolves to this repository's
  issue of that number.
- **No suffix leaves the behavior exactly as it was.**

**It is not `epic:bundle`, and both still run.** `epic:bundle` *recommends* an epic for a newly filed
Issue and does nothing when the signal is weak; `into` is a person naming one explicitly. The
`epic:bundle` call that follows a filing happens exactly as before.
