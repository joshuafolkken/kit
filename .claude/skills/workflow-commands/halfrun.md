# `halfrun` — the manifest (implement + verify, stop before commit)

When this run files a new Issue, file it with `pnpm josh issue:file`, which lints the body and applies the classification labels it declares beside the `--depth` and `--route` labels; `prompts/collaboration-workflow/issue-template.md` is the single source for this classification.

`halfrun` sits between `kickoff` (plan only) and `fullrun` (full execution with auto-merge). It
implements the change and runs the full verification gate, then **stops before commit** — nothing is
committed, pushed, or opened as a PR — so a person verifies the working tree by hand. Use it when a change needs human eyes before shipping.

**This file is the manifest.** The entry sequence and the stop branches are `entry-sequence.md`,
shared with `fullrun` and `prrun`; this file names only what is `halfrun`'s own. History:
`docs/maintainers/halfrun-rationale.md` → "Where each rule came from".

## The difference — the entry

- **`pnpm josh run:entry <N> --to halfrun`** opens the run.
- **The stop before commit keeps the hold and `in-progress`** — a second run would trample the
  uncommitted work; a stop on a split, prerequisite or third-party target releases both. The stop also
  ends the progress watcher itself.

## The step list

`halfrun #<N>`: read Issue #N and its comments → **normalize the title** (same as
`fullrun`) → post the agreed plan only if the body is blank → `pnpm josh ms`, then `pnpm
josh latest:scope` and update dependencies only on `required` (`latest-gate.md`; the
`dependency-update` skill) → implement → run the **full verification gate** (refactor →
start `pnpm josh gate` beside a subagent `/code-review` with the brief `pnpm josh review:brief` prints,
join the gate before the stop, iterate to no high/medium findings, within the round cap (`prompts/review.md`) → `pnpm josh
test:e2e`, run by **you**, because `halfrun` opens no pull request and there is no CI E2E job; a printed
skip is the answer where the project has no suite) → **mark the stop: `pnpm josh run:hold <N>
--halfrun-stop`** (the record `fullrun #<N>` adopts; `new` passes the filed number) → send a
`confirmation` Telegram with the resume commands in the body → **stop**. Plan comments are in the session language. The `confirmation` Telegram
body MUST include the exact resume commands — **the `Next:` line first**, since that is how a verified
`halfrun` ships: its `run:entry` adopts this stop's marked hold and resumes at
the gate. The direct commands follow for shipping without an agent:
`pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'halfrun ready for manual
verification\nNext: prrun #<N> | fullrun #<N>\nWithout an agent: pnpm josh git -y "<title> #<N>" && pnpm josh
followup "<title> #<N>" --notify-message "Implemented <title>\\nCause: ...\\nFix: ...\\nResult:
...\\n\\nDetails:\\n- <change1>"'`. The stop report names the same two, in the same order.
**Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh git -y` or `pnpm josh followup` yourself. If the user comes
back with fixes, treat each as a new round: implement, re-run `pnpm josh gate`, send another
`confirmation` Telegram, stop again.

`halfrun new` or `halfrun new "<title>"`: `kickoff new` + `halfrun #<N>` (no Issue exists yet). Steps
mirror `fullrun new` (1)–(8): derive an English title (or use the provided one) → create the Issue
(`pnpm josh issue:file "<title>" --body-file <body-file> --depth <n> --requested`, with the labels
`kickoff.md` → "Words typed after `new`" maps, body per
`prompts/collaboration-workflow/issue-template.md`; its duplicate scan is read per `issue-scout.md`) → add `in-progress` (as `fullrun new` (3)) → post the agreed plan → stash
any pre-existing changes with `git stash push -m "halfrun new: pre-existing changes" -- ':!.josh/observations'`
(the pathspec keeps the observation ledger in the tree for this run's commit), popped by
message with `pnpm josh stash:pop "halfrun new: pre-existing changes"`, never a positional `git stash pop` →
`pnpm josh ms` → `pnpm josh latest:scope` → implement → run the gate (as above, `pnpm
josh test:e2e` run by **you**) → `pnpm josh run:hold <N> --halfrun-stop` → send the `confirmation`
Telegram and **stop**.
