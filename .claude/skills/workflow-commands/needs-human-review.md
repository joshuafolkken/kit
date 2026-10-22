# `needs-human-review` — the child that stops before its commit

Read the moment `pnpm josh issue:state <N>` answers `human_review: yes`.

An issue carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop, whichever entry
point reached it — `fullrun` or `backlogrun` — and the label may be applied **only by a person**.

- **Implementation and the verification gate run normally** — refactor, `pnpm josh gate`,
  `/code-review`, exactly as for any other child.
- **Run `pnpm josh test:e2e` yourself before stopping.** With no pull request there is no CI E2E job,
  and `pnpm josh followup` is never reached. A printed skip is the answer for a project with no E2E
  suite.
- **Nothing is committed, pushed, opened as a pull request or merged.** `pnpm josh bump`,
  `pnpm josh git` and `pnpm josh followup` are never reached.
- **The working tree is left uncommitted, and nothing is stashed.**
- **Mark the stop: `pnpm josh run:hold <N> --human-review-stop`, then stop the whole run.** It keeps
  the hold, marks it as `halfrun`'s stop, and sends the `confirmation` Telegram with the resume command
  and the lane directory — never compose one. It answers `e2e-owed` until `test:e2e` answered green on
  this tree. The remaining children are not started — inside a `backlogrun` this is the one thing that
  is *not* park-and-continue.
- **Resuming is `halfrun`'s stop exactly**: a person looks at the working tree and, if it is right,
  carries on from the commit themselves. The stop report carries the resume command too.

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
proposal, written as an Issue comment and left for the person. `josh sync` creates the label.

**It is not `needs-decision`**: `needs-decision` withholds a run's *start*; this withholds its *end*.
So a `needs-human-review` issue is still offered, and a child stopped by it **goes on holding its
repository** — `scripts/issue/issue-labels.ts` keeps it out of `NOT_DIRECTLY_RUNNABLE_LABELS` and
`scripts/epic/epic-busy.ts` keeps it out of the parked set.

Each entry point's own branch stays in its own file — `fullrun.md`, `halfrun.md`,
`backlogrun.md` — and routes here for the definition.
