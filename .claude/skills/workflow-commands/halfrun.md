# `halfrun` — Implement + verify, stop before commit (for manual verification)

`halfrun` sits between `kickoff` (plan only) and `fullrun` (full execution with auto-merge). It
implements the change and runs the full verification gate, then **stops before commit** — nothing is
committed, pushed, or opened as a PR — so the user manually verifies the change (typically by exercising
the UI in a browser) against the working tree. Use `halfrun` when the change has UI/UX implications or
anything else that requires human eyes before shipping.

**Claim the working tree before anything else — `pnpm josh run:hold <N>`, or bare `pnpm josh run:hold`
for `halfrun new`.** It is this command's first call, ahead of the title normalization and — on the
`new` path — ahead of the filing. For a cross-repository target, resolve that repository's checkout
from `pnpm josh doctor` first and claim there. On `busy` or `unknown`, send a `confirmation` Telegram
carrying what the command printed on stderr and stop: file nothing, branch nothing, edit nothing.
**`halfrun`'s stop before commit keeps the hold**, because the uncommitted work left in the tree is
exactly what a second run would trample; the resume-command body of that stop carries `pnpm josh
run:release <N>` (bare for a `halfrun new`) for the person to type once they are done with the tree. A
`halfrun` that stops on a split, a prerequisite or a third-party target releases it instead. `SKILL.md`
→ §2f is the single source.

**`in-progress` is applied the moment `run:hold` answers `hold`** — ahead of the title normalization, so
a `#N` counts as holding its lane from the claim rather than only once the work begins (the apply is in
the `halfrun #<N>` / `halfrun new` steps below; a `halfrun new` applies it right after filing). **The
stop before commit keeps the label on**, exactly as it keeps the hold, because the tree carries
uncommitted work; the person removes it when they are done with the tree. **A stop that leaves the tree
clean removes the label in the same turn as `pnpm josh run:release`, with `gh api -X DELETE
repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`** — the `cost --over` `over`
stop, a split, a prerequisite, and a third-party target. A lane child finds the label already applied by
the parent at dispatch (`backlogrun-lanes.md` → "Concurrency"), so re-applying it here is idempotent.

**Ask the session boundary in the same turn as the hold, and before anything else is started** —
`pnpm josh cost --over 300000`, exactly as `fullrun` does. `under` — carry on. `over`, or a run it could
not answer for — **stop here**, before the title is normalized and before a `new` entry files anything:
send a `confirmation` Telegram carrying the figure printed on standard error and the resume command (the
invocation as it was typed, in a fresh session — `halfrun #<N>` for a `#N` entry, `halfrun new` for a
`new` one), run `pnpm josh run:release <N>` (bare for a `new` entry) and stop. **Skip it when this run
was dispatched by a batch entry point.** `backlogrun-progress.md` → "The hand-off" is the single source of the check
and of where 300,000 comes from.

**Start the progress step once the hold is claimed, and start it without being asked**, exactly as
`fullrun` does — `pnpm josh run:progress --wait` in the background, presented as-is when it
exits, the next one started in that same turn, and `pnpm josh run:progress --mark` in the same turn as
every real report. `backlogrun-progress.md` → "Progress while the run is quiet" is the single source, including
that this command's stop before commit keeps `in-progress` on and so has to end the watcher itself.

**Read Issue `#N` and every comment on it before implementing** — `pnpm josh issue:read <N>`. A
decision recorded after the body was written lives only in a comment, and between a body and a comment
that disagree the later text is the agreement in force. `pnpm josh rule:guard` refuses the body-only
read once per run. `SKILL.md` → §2g is the single source, including the two answers that stop the run.

**The target repository is named in front of the Issue reference** — `halfrun kit#412`,
`halfrun joshuafolkken/app-kit#12`. The definition is `SKILL.md` → §2c. An implementing entry needs
that repository's checkout: resolve it from `pnpm josh doctor`, and **stop and report rather than
cloning** when there is none, or when the tree there is not clean. A target whose owner is not this
session's is third-party: Tier C, so it stops rather than filing.

**Before implementing, run the scope assessment in `split-assessment.md`.** Its default is not to
split: separability and a scope that clearly exceeds what one verification gate can confirm in one pass
(the guide is about 10 changed files and about 400 changed lines) have to hold **together**. Where both
hold, two or more separately-mergeable deliverables always means an epic. **When it finds a split, file
the children (each carrying the `route:split` label) and the epic and then STOP** — do not implement,
and do not continue as a `backlogrun`. Report what was filed and end with "Please run `backlogrun #<E> --only` to
execute this epic."

**A prerequisite Issue discovered mid-run stops this command too — but files everything first.** The
three-way distinction, the `route:tier-a` filing command and the filing ceiling are `SKILL.md` → §2d,
the single source; what follows is this entry's branch. Typing `halfrun` approved implementing **one**
Issue and stopping for manual verification — it never authorized a commit, a push or a merge; a batch
is a different authorization again, so the stop stays. Inside a `backlogrun` the same discovery is
recorded as a dependency and **not** parked (`backlogrun-park.md` → "A prerequisite discovered mid-run"). The
procedure, in order:

1. **File the prerequisite `#<P>` without asking** (Tier A, first-party), tagging it `route:tier-a`. It
   goes first because the steps below name it. Run `pnpm josh issue:scout "<title>"` in front of the
   filing call (`SKILL.md` → §2e).
2. **Stash the work in progress** — `git stash push -u -m "halfrun: paused #<N> for prerequisite #<P>"`
   — then record it on the Issue: `gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<what was
   stashed, and that #<P> must land first>"`. **`-u` is not optional** (the work almost always includes
   a new untracked `*.test.ts`). The Issue comment is what gets the stash popped; say it in the Telegram
   too, but the comment is the record.
3. **Find out whether `#N` already belongs to an epic, before creating one** — `pnpm josh epic:bundle
   <N>`.

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#N` | `pnpm josh epic --add <E> <P> --before <N>` — insert into **that** epic. **Do not create a second one** |
   | No epic tracks it | `pnpm josh epic "<title>" <P> <N> --ordered` — `#N` is itself a deliverable, so it is kept as a child rather than promoted. **`--ordered` is required, not stylistic**: without it no `blocked-by` relation is recorded and the follow-up `backlogrun` can hand back `#N` before its prerequisite |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these …`, or a ⚠ truncation warning (`⚠ The epic listing …`) above a `Nothing to bundle.` verdict | Stop and report, naming what it said. **Do not fall through to creating an epic**. A definitive answer stands even beside a `⚠ Could not read #N.` warning |

   The command declares a new chain `#<P> -> #N` beside any existing ones rather than refusing. It still
   refuses a target the epic does not track at all — there the refusal *is* the report.

4. **Remove `in-progress` from `#N`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`.
5. Send the `confirmation` Telegram and **stop** with "Please run `backlogrun #<E> --only` to execute this epic."

**Automatic filing is capped at 10 Issues per run.** On reaching it, stop and report.

- `halfrun #<N>`: **add `in-progress` label the moment `run:hold` answered `hold`** (create if missing)
  → Read Issue #N → **normalize the title** (same as `fullrun`) → post the agreed plan only if the Issue
  body is blank; if the body
  already has content, skip the plan-posting step → run `git switch main && git pull`, then
  `pnpm josh latest:scope` and update dependencies only on `required` — `latest-gate.md` is its single
  source, and on `required` load the `dependency-update` skill afterwards → implement → run the **full
  verification gate** (refactor → start `pnpm josh gate` beside a subagent `/code-review` with the brief
  `pnpm josh review:brief` prints, join the gate before the stop, iterate to no high/medium findings, at
  most two reviews → `pnpm josh test:e2e`, run by **you**, because `halfrun` opens no pull request and
  there is no CI E2E job; a printed skip is the answer where the project has no suite) → send a
  `confirmation` Telegram with the resume commands in the body → **stop**. Plan comments are written in
  the session language (`JOSH_SESSION_LANG`, default `ja`). The `confirmation` Telegram body MUST
  include the exact resume commands the user runs to finish the workflow: `pnpm josh notify --task-type
  confirmation --issue-url "<issue-url>" --body=$'halfrun ready for manual verification\nNext: pnpm josh
  git -y "<title> #<N>" && pnpm josh followup "<title> #<N>" --notify-message "Implemented
  <title>\\nCause: ...\\nFix: ...\\nResult: ...\\n\\nDetails:\\n- <change1>"'`.
  **Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh git
  -y` or `pnpm josh
  followup` yourself. If the user comes back with fixes, treat each as a new round: implement, re-run
  `pnpm josh gate`, send another `confirmation` Telegram, stop again.
- `halfrun new` or `halfrun new "<title>"`: `kickoff new` + `halfrun #<N>` (no Issue exists yet). Steps
  mirror `fullrun new` (1)–(8): (1) Derive an English title, or use the provided one. **(1a) Run `pnpm
  josh issue:scout "<title>" [--body "<summary>"]` before creating the Issue** — a candidate that covers
  the same work stops the run (`SKILL.md` → §2e). (2) `gh api repos/{owner}/{repo}/issues -f
  title="<title>" -f 'labels[]=depth:<n>' -f body="<body>"` (body per
  `prompts/collaboration-workflow/issue-template.md`). Capture `<N>`. (3) Add `in-progress`. (4) Post
  the agreed plan in the session language. (5) If the working tree has staged/modified files, `git
  stash`. (6) `git switch main && git pull`. (7) `pnpm josh latest:scope`; on `required` run `josh
  latest` and load the `dependency-update` skill; on `skip` neither runs. If you stashed in step 5,
  `git stash pop`. (8) Implement. (9) Run the verification gate (as in `halfrun #<N>`; `pnpm josh
  test:e2e` run by **you**). (10) Send the `confirmation` Telegram (same body as `halfrun #<N>`) and
  **stop**. Do not run `pnpm josh git -y` or `pnpm josh followup` — the user resumes manually after
  verifying.
