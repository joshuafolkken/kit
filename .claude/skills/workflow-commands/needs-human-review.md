# `needs-human-review` — the child that stops before its commit

**The single source of the label**, read at its point of use — the moment `pnpm josh issue:state <N>`
answers `human_review: yes`. Rationale and history: `docs/maintainers/needs-human-review-rationale.md`
→ "Why the label exists".

An issue carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop, whichever entry
point reached it — `fullrun` or `backlogrun` — and the label may be applied **only by a person**.

- **Implementation and the verification gate run normally** — refactor, `pnpm josh gate`,
  `/code-review`, exactly as for any other child.
- **Run `pnpm josh test:e2e` yourself before stopping.** With no pull request there is no CI E2E job,
  and `pnpm josh followup` is never reached. This is `halfrun`'s situation exactly: you run it and read
  what it prints. A printed skip is the answer for a project with no E2E suite; a skip nobody saw
  printed is not.
- **Nothing is committed, pushed, opened as a pull request or merged.** `pnpm josh bump`,
  `pnpm josh git` and `pnpm josh followup` are never reached.
- **The working tree is left uncommitted, and nothing is stashed.**
- **Send a `confirmation` Telegram and stop the whole run.** The remaining children are not started —
  inside a `backlogrun` this is the one thing that is *not* park-and-continue.
- The Telegram body carries the **resume command**, in the same form `halfrun`'s own stop uses.
- **Resuming is `halfrun`'s stop exactly**: a person looks at the working tree and, if it is right,
  carries on from the commit themselves. The stop report carries that resume command too, not only the
  Telegram.

**Stopping is the specification, not a failure.**

**Read the answer from `pnpm josh issue:state <N>`, never by matching the label string yourself** — it
compares case-insensitively. **Ask once, before implementing**: one call of its own, made the moment
the number is in hand and before the plan.

```bash
pnpm josh issue:state <N>                      # state, labels, and human_review
pnpm josh issue:state <N> --repo <owner/repo>  # a child in another repository
```

**Never apply or remove it**: a mark a run can clear for itself is
not a mark. Everything but typing the command on an explicit instruction in the current turn is a
proposal, written as an Issue comment and left for the person. The label itself is created once per
repository, by a person:

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

**It is not `needs-decision`**: `needs-decision` withholds a run's *start*; this withholds its *end*.
So a `needs-human-review` issue is still offered, and a child stopped by it **goes on holding its
repository** — `scripts/issue/issue-labels.ts` keeps it out of `NOT_DIRECTLY_RUNNABLE_LABELS` and
`scripts/epic/epic-busy.ts` keeps it out of the parked set (`docs/maintainers/needs-human-review-rationale.md`
→ "Why it is not `needs-decision`").

Each entry point's own branch stays in its own file — `fullrun.md`, `halfrun.md`,
`backlogrun.md` — and routes here for the definition.
