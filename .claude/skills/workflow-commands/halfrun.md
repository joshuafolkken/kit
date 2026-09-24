# `halfrun` — the manifest (implement + verify, stop before commit)

`halfrun` sits between `kickoff` (plan only) and `fullrun` (full execution with auto-merge). It
implements the change and runs the full verification gate, then **stops before commit** — nothing is
committed, pushed, or opened as a PR — so the user manually verifies the change (typically by exercising
the UI in a browser) against the working tree. Use `halfrun` when the change has UI/UX implications or
anything else that requires human eyes before shipping.

**This file is the manifest** (joshuafolkken/kit#2189): the ordered steps as terse triggers and
pointers, the detail read on demand from the file each pointer names.

## The ordered entry sequence

1. **Claim the working tree first** — `pnpm josh run:hold <N>` (bare for `halfrun new`), ahead of the
   title and a `new` entry's filing; `busy` / `unknown` stop with a `confirmation` Telegram. **The stop
   before commit keeps the hold** (the uncommitted work is what a second run would trample); a stop on a
   split, prerequisite or third-party target releases it. `working-tree-hold.md` is the single source; a
   cross-repository target resolves its checkout from `pnpm josh doctor` first (`target-repository.md`).
2. **Apply `in-progress` the moment `run:hold` answered `hold`** — the stop before commit keeps it on;
   a stop that leaves the tree clean removes it in the same turn as `pnpm josh run:release` (`gh api -X
   DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`).
3. **Ask the session boundary in the same turn as the hold** — `pnpm josh cost --cut`, exactly as
   `fullrun`; `over` stops with a `confirmation` Telegram and the resume command (`halfrun #<N>` /
   `halfrun new`). **Skip it when dispatched by a batch.** `backlogrun-progress.md` → "The hand-off" is
   the single source of the check and the shared 135,000 threshold.
4. **Start the progress watcher once the hold is claimed** — `pnpm josh run:progress --wait` in the
   background, `--mark` in the same turn as every real report; the stop before commit ends the watcher
   itself (`backlogrun-progress.md` → "Progress while the run is quiet").
5. **Gather the mechanical reads — `pnpm josh run:prep <N>`** (`issue:read`'s body/comments — `SKILL.md`
   → §2g → `issue-comments.md`; `issue:state`'s `human_review`; `latest:scope`), then `pnpm josh
   run:next <N>`.

## The step list

`halfrun #<N>`: add `in-progress` → read Issue #N and its comments → **normalize the title** (same as
`fullrun`) → post the agreed plan only if the body is blank → `git switch main && git pull`, then `pnpm
josh latest:scope` and update dependencies only on `required` (`latest-gate.md`; load the
`dependency-update` skill on `required`) → implement → run the **full verification gate** (refactor →
start `pnpm josh gate` beside a subagent `/code-review` with the brief `pnpm josh review:brief` prints,
join the gate before the stop, iterate to no high/medium findings, at most two reviews → `pnpm josh
test:e2e`, run by **you**, because `halfrun` opens no pull request and there is no CI E2E job; a printed
skip is the answer where the project has no suite) → send a `confirmation` Telegram with the resume
commands in the body → **stop**. Plan comments are in the session language. The `confirmation` Telegram
body MUST include the exact resume commands: `pnpm josh notify --task-type confirmation --issue-url
"<issue-url>" --body=$'halfrun ready for manual verification\nNext: pnpm josh git -y "<title> #<N>" &&
pnpm josh followup "<title> #<N>" --notify-message "Implemented <title>\\nCause: ...\\nFix:
...\\nResult: ...\\n\\nDetails:\\n- <change1>"'`.
**Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh git -y` or `pnpm josh followup` yourself. If the user comes
back with fixes, treat each as a new round: implement, re-run `pnpm josh gate`, send another
`confirmation` Telegram, stop again.

`halfrun new` or `halfrun new "<title>"`: `kickoff new` + `halfrun #<N>` (no Issue exists yet). Steps
mirror `fullrun new` (1)–(8): derive an English title (or use the provided one) → **run `pnpm josh
issue:scout "<title>" [--body "<summary>"]` before creating the Issue** (`SKILL.md` → §2e) → create the
Issue (`gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=depth:<n>' -f body="<body>"`,
body per `prompts/collaboration-workflow/issue-template.md`) → add `in-progress` → post the agreed plan → stash
any pre-existing changes with `git stash push -m "halfrun new: pre-existing changes"`, popped by
message with `pnpm josh stash:pop "halfrun new: pre-existing changes"`, never a positional `git stash pop` →
`git switch main && git pull` → `pnpm josh latest:scope` → implement → run the gate (as above, `pnpm
josh test:e2e` run by **you**) → send the `confirmation` Telegram and **stop**.

## The stop branches

- **`needs-human-review`** — implement and gate, then stop before the commit; `needs-human-review.md`.
- **A split** — the assessment (`split-assessment.md` → "The question") finds two or more
  separately-mergeable deliverables over one gate: file the children (each `route:split`) and the epic,
  then **STOP** with "Please run `backlogrun #<E> --only` to execute this epic." Typing `halfrun`
  authorized implementing **one** Issue and stopping for manual verification, never a batch.
- **A prerequisite** — file it (`route:tier-a`), stash, record the dependency, and **STOP**;
  `prerequisite.md` is the single source of the filing, the `-u` stash and the epic:bundle branch.
- **An observation** — file it without asking and carry on; `SKILL.md` → §2i.

**Automatic filing is capped at 10 Issues per run.** On reaching it, stop and report.
