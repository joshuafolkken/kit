# `halfrun` — the manifest (implement + verify, stop before commit)

When this run files a new Issue, file it with `pnpm josh issue:file`, which lints the body and applies the classification labels it declares beside the `--route` label; `prompts/collaboration-workflow/issue-template.md` is the single source for this classification.

`halfrun` implements the change and runs the full verification gate, then **stops before commit** —
nothing is committed, pushed, or opened as a PR — so a person verifies the working tree by hand. The
entry sequence and the stop branches are `entry-sequence.md`.

## The difference — the entry

- **`pnpm josh run:entry <N> --to halfrun`** opens the run.
- **The stop before commit keeps the hold and `in-progress`** — a second run would trample the
  uncommitted work; a stop on a split, prerequisite or third-party target releases both. The stop also
  ends the progress watcher itself.

## The step list

`halfrun #<N>`: read Issue #N and its comments → **record the agreed plan**, normalizing
the title (`pnpm josh issue:plan`, same as `fullrun`) → `pnpm josh ms`, then on `run:prep`'s
`latest: required` `pnpm josh latest:if-required` (`latest-gate.md`; the `dependency-update` skill) → implement → run the **full verification gate** (refactor →
start `pnpm josh gate` beside a subagent `/code-review` with the brief `pnpm josh review:brief` prints,
join the gate before the stop, iterate to no high/medium findings, within the round cap (`prompts/review.md`) → `pnpm josh
test:e2e`, run by **you**, because `halfrun` opens no pull request and there is no CI E2E job; a printed
skip is the answer where the project has no suite) → **mark the stop: `pnpm josh run:hold <N>
--halfrun-stop`** (the record `fullrun #<N>` adopts; refused with `e2e-owed` until `test:e2e` answered
green on this tree; it also sends the `confirmation` Telegram, its body led by
`Next: prrun #<N> | fullrun #<N>` — never compose one) → **stop**. Plan comments are in
the session language. The stop report names `prrun #<N>` (recommended) and `fullrun #<N>`, in that order.
**Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh git -y` or `pnpm josh followup` yourself. If the user comes
back with fixes, treat each as a new round: implement, re-run `pnpm josh gate`, mark the stop again
(it sends the `confirmation`), stop again.

`halfrun new` or `halfrun new "<title>"`: `kickoff new` + `halfrun #<N>` (no Issue exists yet). Steps
mirror `fullrun new` (1)–(8): derive an English title (or use the provided one) → create the Issue
(`pnpm josh issue:file "<title>" --body-file <body-file>`, with the labels
`kickoff.md` → "Words typed after `new`" maps, body per
`prompts/collaboration-workflow/issue-template.md`; its duplicate scan is read per `issue-scout.md`) → `pnpm josh run:entry <N> --to halfrun --adopt` (as `fullrun new` (3)) → post the agreed plan → stash
any pre-existing changes with `pnpm josh stash:push "halfrun new: pre-existing changes"`, popped
after `stashed` with `pnpm josh stash:pop "halfrun new: pre-existing changes"` →
`pnpm josh ms` → on the entry's `latest: required`, `pnpm josh latest:if-required` → implement → run the gate (as above, `pnpm
josh test:e2e` run by **you**) → `pnpm josh run:hold <N> --halfrun-stop` (it sends the `confirmation`)
→ **stop**.
