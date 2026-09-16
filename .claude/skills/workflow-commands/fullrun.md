# `fullrun` — Full execution (plan → implement → PR → completion notify)

This command implements, commits, opens the PR and merges it. **`chain-rule.md`, `followup.md` and
`background-commands.md` are not entry reads** — each is fetched in full in the turn that reaches it:
`chain-rule.md` before the `/code-review` step it governs, `followup.md` in the turn that issues
`pnpm josh followup`, and `background-commands.md` before backgrounding `pnpm josh gate` (`SKILL.md` →
§1, "Four documents are read at the point of use"). The rules a `fullrun` most often breaks live in
those files, not here.

**Claim the working tree before anything else — `pnpm josh run:hold <N>`, or bare `pnpm josh run:hold`
for `fullrun new`.** It is this command's first call: ahead of the title normalization, ahead of
`git switch main && git pull`, and — on the `new` path — ahead of the `gh api … issues` call that
files the Issue. For a cross-repository target, resolve that repository's checkout from
`pnpm josh doctor` first and claim there. On `busy` or `unknown`, send a `confirmation` Telegram
carrying what the command printed on stderr and stop: file nothing, branch nothing, edit nothing.
`pnpm josh followup` releases the hold on the merge, so a completed `fullrun` needs no release step; a
`fullrun` that stops on a split, a prerequisite or a third-party target ends with
`pnpm josh run:release <N>` — bare where it entered as `new` (`SKILL.md` → §2f). A
`needs-human-review` stop keeps the hold, because its tree carries uncommitted work. `SKILL.md` → §2f
is the single source.

**`in-progress` is applied the moment `run:hold` answers `hold`** — ahead of the title normalization
and before implementation, so a `#N` counts as holding its lane from the claim rather than only once the
work begins (the apply command is in the `fullrun #<N>` / `fullrun new` steps below; a `fullrun new` has
no issue yet and applies it right after filing, step 3). **Every stop that leaves the tree clean removes
the label in the same turn as `pnpm josh run:release`, with `gh api -X DELETE
repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`** — the `cost --over` `over`
stop, a split, a prerequisite discovered mid-run, and a third-party target (a `new` entry that stops
before it files has nothing to remove). A `needs-human-review` stop keeps both the hold and the label,
because the tree still carries uncommitted work. A lane child dispatched by `backlogrun` finds the label
already applied by the parent at dispatch (`backlogrun-lanes.md` → "Concurrency"), so re-applying it here is
idempotent.

**A dispatched lane child asks whether it is a resume before any of the above — `pnpm josh run:cut
--resume <N>`.** On `fresh` it proceeds exactly as this file describes, `run:hold` first. On `resume`
it skips the title, the plan, the hold claim and the implementation, re-reads the issue body and
comments for the plan and the recorded decisions, and goes straight to `pnpm josh gate`. At the
pre-gate boundary — implementation done, before `pnpm josh gate` — it takes the cut with
`pnpm josh run:cut <N>`: on `cut` the process ends its turn and a fresh one resumes here. This applies
to a detached lane child alone; elsewhere `run:cut` answers `not-a-lane` and changes nothing. The
boundary and its verdicts are `pre-gate-cut.md`, its single source.

**A dispatched lane child records its park before it stops for a decision.** Before it sends the
`confirmation` Telegram that ends its turn, a Tier B toss-up, a Tier C action, an upstream defect or a
person-needing split is recorded on the Issue — `needs-decision` plus a comment carrying the question,
the options and whether work was stashed — so the parent treats it as parked from GitHub state alone
rather than reconstructing the question from a log. `pnpm josh rule:guard` refuses the stop notify
until the park is recorded. The single source is `pre-gate-cut.md` → "A lane child records its park
before it stops"; the park procedure itself is `backlogrun-park.md` → "park and continue".

**Ask the session boundary in the same turn as the hold, and before anything else is started** —
`pnpm josh cost --cut`. Branch on what the command answers, never on a judgement about how
long the session feels. `under` — carry on. `over`, or a run it could not answer for — **stop here**,
before the title is normalized and before a `new` entry files anything: send a `confirmation` Telegram
carrying the figure printed on standard error and the resume command (the invocation as it was typed,
in a fresh session — `fullrun #<N>` for a `#N` entry, `fullrun new` for a `new` one), run
`pnpm josh run:release <N>` (bare for a `new` entry) and stop. **Skip it when this run was dispatched
by `backlogrun`** — that batch owns the same question at its own seam.
`backlogrun-progress.md` → "The hand-off" is the single source of the check and of the shared 150,000 threshold — **a dispatched lane child does not perform this check and never reads that document** (its trimmed set is `pnpm josh read:set lane-child`).

**Start the progress step once the hold is claimed, and start it without being asked** —
`pnpm josh run:progress --wait` in the background, what it printed presented as-is when it
exits, the next one started in that same turn, and `pnpm josh run:progress --mark` in the same turn as
every real report this run makes. The procedure is `backlogrun-progress.md` → "Progress while the run is quiet",
its single source for a top-level run; a `fullrun` running as a dispatched lane child (a `backlogrun` named issue or epic child) **starts none and never reads that document** — the outermost run reports for every child, so the child's read set omits it (`pnpm josh read:set lane-child`).

**Read Issue `#N` and every comment on it before implementing** — `pnpm josh issue:read <N>`. A
decision recorded after the body was written lives only in a comment, and between a body and a comment
that disagree the later text is the agreement in force. `pnpm josh rule:guard` refuses the body-only
read once per run. `SKILL.md` → §2g is the single source, including the two answers that stop the run
rather than proceed.

**One call gathers the mechanical reads before the first edit — `pnpm josh run:prep <N>`**
(joshuafolkken/kit#1978): `issue:read`'s body/comments, `issue:state`'s state/labels/`human_review`,
and `latest:scope`'s dependency scope in one report, run beside `pnpm josh run:hold` and
`pnpm josh cost --cut` in the same turn — three round trips into one. The §2g stops, the §2z
`human_review` stop and the dependency decision are read off it. Cross-repo issues keep
separate commands; no `--repo`.

**The target repository is named in front of the Issue reference** — `fullrun joshuafolkken/app-kit#12`,
`fullrun kit#new`. The definition is `SKILL.md` → §2c. An implementing entry needs that repository's
checkout: resolve it from `pnpm josh doctor`, and **stop and report rather than cloning** when there
is none, or when the tree there is not clean. A target whose owner is not this session's is
third-party: Tier C, so it stops rather than filing.

**A `needs-human-review` issue stops before the commit.** Implement it and take it through the
verification gate as usual — including `pnpm josh test:e2e`, which you run yourself, because with no
pull request there is no CI E2E job and `followup` is never reached — then commit nothing, push
nothing, open no pull request and merge nothing; leave the working tree uncommitted and unstashed,
send a `confirmation` Telegram carrying the resume command, and stop. The label is applied only by a
person. Definition: `SKILL.md` → §2z.

**Before implementing, run the scope assessment in `split-assessment.md`.** Its default is not to
split: separability and a scope that clearly exceeds what one verification gate can confirm in one
pass (the guide is about 10 changed files and about 400 changed lines) have to hold **together**.
Where both hold, two or more separately-mergeable deliverables always means an epic. **When it finds a
split, file the children (each carrying the `route:split` label) and the epic and then STOP** — do not
implement, and do not continue as a `backlogrun`. Typing `fullrun` approved implementing and merging
**one** Issue; a batch of N is a different authorization. Report what was filed and end with "Please
run `backlogrun #<E> --only` to execute this epic."

**A prerequisite Issue discovered mid-run stops this command too — but files everything first.** The
three-way distinction, the `route:tier-a` filing command and the filing ceiling are `SKILL.md` → §2d,
the single source; what follows is this entry's branch. Typing `fullrun` approved merging **one**
Issue; a batch is a different authorization, so the stop stays. Inside a `backlogrun` the same discovery
is recorded as a dependency and **not** parked (`backlogrun-park.md` → "A prerequisite discovered mid-run").
The procedure, in order:

1. **File the prerequisite `#<P>` without asking** (Tier A, first-party), tagging it `route:tier-a`.
   It goes first because the steps below name it. Run `pnpm josh issue:scout "<title>"` in front of the
   filing call (`SKILL.md` → §2e).
2. **Stash the work in progress** — `git stash push -u -m "fullrun: paused #<N> for prerequisite #<P>"`
   — then record it on the Issue: `gh api repos/{owner}/{repo}/issues/<N>/comments -f body="<what was
   stashed, and that #<P> must land first>"`. **`-u` is not optional** (the work almost always includes
   a new untracked `*.test.ts`). The Issue comment is what gets the stash popped — by message,
   `pnpm josh stash:pop "fullrun: paused #<N> for prerequisite #<P>"`, never a positional
   `git stash pop` a shared stash stack lets another lane divert. Say it in the Telegram too, but the
   comment is the record.
3. **Find out whether `#N` already belongs to an epic, before creating one** — `pnpm josh epic:bundle
   <N>`, which names it (`#893 already tracks this issue`).

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#N` | `pnpm josh epic --add <E> <P> --before <N>` — insert into **that** epic. **Do not create a second one** |
   | No epic tracks it | `pnpm josh epic "<title>" <P> <N> --ordered` — `#N` is itself a deliverable, so it is kept as a child rather than promoted. **`--ordered` is required, not stylistic**: without it no `blocked-by` relation is recorded and the follow-up `backlogrun` can hand back `#N` before its prerequisite |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these …`, or a ⚠ truncation warning (`⚠ The epic listing …`) above a `Nothing to bundle.` verdict | Stop and report, naming what it said. **Do not fall through to creating an epic**: "could not tell" is not "no epic tracks it". A definitive answer stands even beside a `⚠ Could not read #N.` warning |

   The command declares a new chain `#<P> -> #N` beside any existing ones rather than refusing. It
   still refuses a target the epic does not track at all — there the refusal *is* the report: do not
   hand-edit the body and do not create a second epic.

4. **Remove `in-progress` from `#N`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true`. `epic:next` classifies a child carrying it as waiting on time before it consults any blocker.
5. Send the `confirmation` Telegram and **stop** with "Please run `backlogrun #<E> --only` to execute this epic."

**Automatic filing is capped at 10 Issues per run.** On reaching it, stop and report.

- `fullrun #<N>`: **add `in-progress` label the moment `run:hold` answered `hold`** (create if missing:
  `gh api repos/{owner}/{repo}/labels -f name=in-progress -f color=0075ca -f description="Work is
  actively in progress" --silent 2>/dev/null || true`, then `gh api
  repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=in-progress'`) → Read Issue #N → **normalize the
  title** (if not in English or can be phrased more clearly, derive a better English title and `gh api -X
  PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"`) → post the agreed plan only if the Issue
  body is blank (`gh api -X PATCH
  repos/{owner}/{repo}/issues/<N> -f body="<plan>"`); if the body already has content, skip the
  plan-posting step → implement → run the **verification gate** (the full procedure is `chain-rule.md`;
  in outline: refactor → `pnpm josh main:merge` → start `pnpm josh gate` and a subagent `/code-review`
  with the brief `pnpm josh review:brief` prints on `git diff main`, join the gate before the commit,
  iterate to no high/medium findings, at most two reviews → open the PR between the rounds with `pnpm
  josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` inside the CI wait →
  `pnpm josh followup`). Issue plan comments are written in the session language (`JOSH_SESSION_LANG`,
  default `ja`). Before implementing, run `git switch main && git pull`, then `pnpm josh latest:scope`
  and update dependencies only on `required` — `latest-gate.md` is its single source, and on `required`
  load the `dependency-update` skill afterwards. When running `pnpm josh followup`, pass an
  implementation summary via `--notify-message` in the session language, leading with the three
  plain-language lines: `"Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n-
  <change1>\n- <change2>"`. **`pnpm josh followup` waits for CI, verifies AI review findings, sends the
  completion notification, then merges; if blockers are found it exits non-zero — fix and re-run.**
  **After the merge succeeds, run `pnpm josh ms`** to return to the default branch and pull the merge
  commit (`followup.md` → `auto-merge`).
- `fullrun new` or `fullrun new "<title>"`: `kickoff new` + `fullrun #<N>` in one run. Steps: (1)
  Derive an English title, or use the provided one. **(1a) Run `pnpm josh issue:scout "<title>" [--body
  "<summary>"]` before creating the Issue** — a candidate that covers the same work stops the run
  rather than filing a second Issue (`SKILL.md` → §2e). (2) Create Issue: `gh api
  repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=depth:<n>' -f body="<body>"` (body per
  `prompts/collaboration-workflow/issue-template.md`). Capture `<N>`. (3) Add `in-progress` (as above).
  (4) Post the agreed plan in the session language: fill the body if blank, otherwise add a comment.
  (5) If the working tree already has staged or modified files,
  `git stash push -m "fullrun new: pre-existing changes"` first. (6) `git switch main
  && git pull`. (7) `pnpm josh latest:scope`; on `required` run `josh latest` and load the
  `dependency-update` skill; on `skip` neither runs (`latest-gate.md` is the single source). If you
  stashed in (5), `pnpm josh stash:pop "fullrun new: pre-existing changes"` — by message, never a
  positional `git stash pop`. (8) Implement. (9) Run the verification gate (as in `chain-rule.md`;
  only the first review round runs here). (9a) **Ask `pnpm josh review:round2 --round-1-closed` whether
  a second round is due, once round 1's fixes are in and before the commit.** (10) Where the tree was
  edited after the first gate started, re-run `pnpm josh gate` and join it. (11) `pnpm josh git -y
  "<title> #<N>"` — the pull request opens here, between the two rounds. (11a) Run the **second round**
  now beside the CI, where (9a) answered `required` (brief `pnpm josh review:brief --round 2`); a
  finding it fixes in place is pushed before its gate. (12) File whatever the review round cap routed to
  branch 2, run `pnpm josh epic:bundle <new>` on each, and where (9a) answered `skip` record the skip on
  the Issue. (13) `pnpm josh followup "<title> #<N>" --notify-message "..."`. (14) **After the merge,
  run `pnpm josh ms`.** (15) **Ask `pnpm josh release:scope` and close the completion summary with what
  it answered** (`followup-reference.md` → "When `pnpm josh release` runs").

**The last step of either form is the release ask.** Once the merge is done, `pnpm josh release:scope`
says whether a release is owed — `required`, `skip` or `unknown`, and `unknown` is never read as
`skip`. On `required` the completion summary closes with the request and the exact command; the run
never types `pnpm josh release` itself, because publishing is Tier C (`followup-reference.md` → "When
`pnpm josh release` runs", the single source). A `fullrun` invoked as one child of a
`backlogrun` does not ask it — that batch asks once at its own end.
