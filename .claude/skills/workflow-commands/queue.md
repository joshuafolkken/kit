# `queue` — Sequential multi-issue fullrun

Each issue in the queue is a full `fullrun`, so read `fullrun.md`, `chain-rule.md` and
`followup.md` as well; this file only adds what running several of them back to back changes.


`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**The target repository is named in front of each Issue reference** — `queue kit#1 kit#2`. The definition is the same at every entry point: `SKILL.md` → "2c. The `owner/repo#` prefix". **One queue runs against one repository**: every reference must resolve to the same target, because step 1 below runs `josh latest` once for the whole queue and a mixed queue would run it in only one of them. Split a mixed batch into one queue per repository. The checkout rule is the one every implementing entry follows — resolve it from `pnpm josh doctor`, and stop and report rather than cloning. Step 1's `git stash` covers this session's own tree, and a prefix naming this repository changes nothing; a *different* repository's checkout that is not clean stops the run instead, since that work is not yours to stash. A target whose owner is not this session's is third-party: Tier C, so it stops rather than filing.

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `pnpm josh latest:scope` once (before the first issue); on `required`, run `josh latest` and verify the overrides are unchanged in both `pnpm-workspace.yaml` and `package.json` and `devEngines` changed only by the expected `josh latest` pnpm bump, by loading the `dependency-update` skill and following its procedure. On `skip` neither runs. **The answer is the command's, never a judgement** — `latest-gate.md` is the single source. If you stashed changes, restore them: `git stash pop`.
2. For each issue `#<N>` in the supplied order:
   a. From the 2nd issue onward: run `pnpm josh ms` to incorporate the previous PR's merge. **When the previous issue ran in a delegated unit this step is not defensive — it is the only thing that brings that merge into the checkout the queue implements in** (this session's own, or the target repository's when the references carry a prefix — run it there), and without it the next issue starts on a stale default branch. Where the issue ran in this session's own context it stays what it always was: a `fullrun` always ends on the default branch, so the step also covers an iteration interrupted before its own `pnpm josh ms` ran.
   b. Execute the full `fullrun #<N>` flow **in a delegated unit where one is available** ("Each issue runs in a delegated unit" below), **and in this session's own context where none is**, **except that `josh latest` is not run** — step 1 runs it once for the whole queue, and a unit following `fullrun.md` to the letter would bump dependencies again into every PR after the first, so the brief must say so: normalize title → add `in-progress` label → post plan if body is blank → implement → run the verification gate (refactor → `pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) → `/code-review` with the brief `pnpm josh review:brief` prints (the level, what the gate has already proved on this exact tree, and the target) on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total** (`prompts/review.md` → "Review round cap"), **of which only the first runs here: the second runs after the commit, beside the CI it starts** (joshuafolkken/kit#1261) → `pnpm josh eval:scope`, and `pnpm josh eval` when it answers `required` (`eval-gate.md`)) → `pnpm josh bump minor`, followed by `pnpm josh gate` again and its join **where round 1 produced fixes** (those fixes made the first gate stale, and the bump goes in front of the re-run so round 2's brief still reads `Already verified`) → `pnpm josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` for whatever the round cap routed to branch 2, placed here so it runs inside the CI wait (`prompts/review.md` → "Review round cap") → `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- ..."` (sends per-issue completion notification and merges, exactly as `fullrun` does) → `pnpm josh ms` (return to the default branch). **The second review round runs between `pnpm josh git -y` and `pnpm josh followup --merge`**, beside the CI that commit started — the same window the follow-up filing sits in, and for the same reason. A finding it fixes in place is a follow-up commit on the same branch: its own `pnpm josh gate` join, **no second `bump`**, and CI re-runs on it, which is what the merge then waits for (`prompts/review.md` → "The pull request opens between the rounds, so CI runs beside round 2").
   c. On failure: send a `failure` Telegram notification via `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body="<reason>"` and **stop immediately** (do not proceed to the next issue).
3. No extra batch summary notification — each issue's `pnpm josh followup --merge` already sends the per-issue completion notification as usual. **Run `pnpm josh ms` once more here when the final issue ran in a delegated unit**, in that same checkout — step 2a only covers the issues that have a successor, so without it the last merge is never pulled in. `queue` always ends on the default branch, with every merge it produced pulled in.

## Each issue runs in a delegated unit

**A queued issue is not run in the parent loop's context** (joshuafolkken/kit#1149). One issue goes
to an isolated execution unit and only its summary comes back, so the third issue of a queue no
longer carries the first two issues' implementation history. What a request costs is its context
length, so a batch that accumulates pays for every earlier issue on every later turn — the same
measurement that put an epic's children in a unit puts a queue's issues there.

**It is the same unit, not a second one.** `epic-child` is one child of a batch whichever keyword
started it, so there is nothing here to define — ask the one command:

```bash
pnpm josh delegate epic-child   # → delegate
```

How the unit is handed its work, what it returns, and how a failure surfaces are defined once, in
`SKILL.md` → "2b. Delegating a step to a cheaper tier" — the single source of the delegation rule.
`epicrun.md` → "Each child runs in a delegated unit" is that definition applied to one child of a
batch, and every paragraph of it applies to a queued issue
unchanged — the brief naming the invocation the run descends from (`queue #N1 #N2 …`,
this issue's number, and that it is to be run as `fullrun #<N>` under that authorization), the merge
authorization typing `queue` gave reaching the unit, and the fallback where no isolated unit exists.

**The parent reads GitHub, never the summary.** That is `epic-child`'s verifier, and a queue discards
it exactly as an epic would. When the unit reports back, read the issue's state before starting the
next one:

```bash
pnpm josh issue:state <N>                      # an issue in this repository
pnpm josh issue:state <N> --repo <owner/repo>  # an issue in another one
```

**`--repo` is not optional for a cross-repository issue.** `queue kit#1 kit#2` names the target in
front of every reference (§2c), while this read resolves a bare `<N>` against the repository this
session runs in — and confirms a completely different issue that happens to carry that number,
silently, because that issue usually exists.

**How the four answers are classified is `epicrun.md` → the loop's step 2; read it there.** Two of
its rules are repeated here as triggers rather than left behind the pointer, because getting either
one wrong is silent: **read the `human_review:` line rather than eye-matching the `labels:` one**
(GitHub keeps the spelling a label was created with, so `Needs-Human-Review` is the same label —
joshuafolkken/kit#1132), and **a non-zero exit is not `OPEN`** (a rate limit or expired auth says
nothing about the issue; re-read before deciding). Everything else about the four answers — the
reasoning, the worked failures — stays at the pointer.

What a queue does with each answer is the only part that differs, because a queue has no park:

- **`state: CLOSED`** — the issue finished. Continue with the next one.
- **Open, and `human_review: yes`** — the specification stop (key rules below). The queue ends here,
  `in-progress` stays on, and the uncommitted work stays in the tree the unit left it in. **The
  resume command that stop carries is the rest of the queue** — `queue #<N> #<next> …` from the
  issue that stopped — never `fullrun #<N>` alone, which would drop every issue after it. **Do not
  send a second `confirmation` Telegram** — the unit that ran the issue already sent one for this
  stop, and `CLAUDE.md`'s rule is one per stop, not one per context that notices it. Where the issue
  ran in this session's own context, that first notification is yours to send.
- **Open, carrying `needs-decision`** — the unit stopped for a decision and has already sent its
  `confirmation`. A queue cannot park it and go on, so the queue ends here too, and no `failure`
  Telegram is sent over a stop that was already notified. **Where the issue ran in this session's own
  context that `confirmation` is yours to send** — one is owed per stop, and nobody else sent it.
- **Open, and neither** — it failed. **Remove the stale `in-progress` here** (Tier A, per
  "`in-progress` is removed by whoever finds it stale"): the unit that applied it is gone, this
  session is the only context left that can, and a label left behind makes `epic:next` answer `wait`
  for the whole repository. Then step 2c: the `failure` Telegram, and stop.

  ```bash
  gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
  ```

Never advance the queue on the summary alone.

**Key rules:**

- **An issue carrying `needs-human-review` ends the queue before its commit.** Implement it and take
  it through the verification gate as usual — **`pnpm josh test:e2e` included, run by you, since no
  pull request means no CI E2E job** — then commit nothing, leave the working tree uncommitted
  and unstashed, send a `confirmation` Telegram carrying the resume command, and stop — the issues
  after it are not started. That is the specification rather than a failure, so it is a
  `confirmation` and not the `failure` notification step 2c sends. Definition: `SKILL.md` → §2z,
  which is the single source.
- Invoking `queue` is explicit authorization to merge each PR (same as `fullrun`).
- `josh latest` runs only once, before the first issue — and only when `pnpm josh latest:scope` answers `required` there, which is what makes the same hoist hold for a standalone `fullrun` too (`latest-gate.md`). If files were pre-staged when `queue` was invoked, they must be stashed before `josh latest` and restored after.
- All `kickoff`/`fullrun` mid-workflow stop rules (confirmation notification, AI review blocker handling, etc.) apply within each issue's execution.

