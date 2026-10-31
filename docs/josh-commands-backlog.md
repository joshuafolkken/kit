# josh CLI — Issue, Epic, Backlog and Review Command Reference

The commands the issue-driven workflow calls to read and file issues, track epics, pick and plan a backlog, brief and attest a review, and decide what a run delegates. Where each command came from: `docs/maintainers/josh-commands-backlog-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated — its summary line from the command's registry `description` and the rest from its `usage` (both in `scripts/josh/josh-commands-*.ts`), by `pnpm josh command:derive` — edit the entry, not the span.

## Issues

Read, file, fold and cite issues, and lint what is written into them.

### `josh issue:read`

<!-- usage: issue:read -->

Print each issue's title, body and every comment on it, in one call.

```bash
pnpm josh issue:read 1715
pnpm josh issue:read 1715 1567 1605   # several numbers, read concurrently
```

<!-- /usage -->

The state is printed too. Attribute each block by its `issue:` line, never by position.

Output past the Bash cap is written as part files, only their paths printed — read every part with the Read tool in one turn. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered. A non-numeric token refuses the whole call.

### `josh issue:ack`

<!-- usage: issue:ack -->

Record that the run read a person's update to its issue, printing the update it acknowledges.

```bash
pnpm josh issue:ack 3773
```

<!-- /usage -->

`josh run:entry` records the issue as the baseline; the PreToolUse hook shows a person's body edit or new comment once, and `issue:ack` makes that read the new baseline. A body edit on an issue whose author lacks write access is shown once as a notice with the text withheld; it needs no `issue:ack`.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:ack` in detail".

### `josh issue:priority`

<!-- usage: issue:priority -->

Apply priority:high to an issue whose body reached the high floor after filing.

```bash
pnpm josh issue:priority 4960
```

<!-- /usage -->

### `josh issue:state`

<!-- usage: issue:state -->

Print each issue's state and labels, in the spelling the documents compare against.

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read a child in another repository; applies to every number.

<!-- /usage -->

State is `OPEN` / `CLOSED` / `MERGED`. `human_review:` answers whether the issue carries `needs-human-review`, matched case-insensitively. Part files and failures behave as in `issue:read`.

### `josh issue:release`

<!-- usage: issue:release -->

Link an Issue to the repository's open release Issue as its blocker (or, with --wait, as waiting on it), filing one when none is open.

```bash
pnpm josh issue:release 3360
pnpm josh issue:release 3716 --wait   # blocked by the release issue instead
```

**Options:**

- `--wait` — the issue is blocked by the release issue instead, so `backlog:next` offers it again once the release ships (`.claude/skills/workflow-commands/prerequisite.md`).

<!-- /usage -->

The one-issue form of `josh issue:file --release`.

1. List the repository's open issues labelled `release`. An unreadable listing files nothing and exits 1, so blockers are never split across two release issues.
2. When none is open, file `Release <owner/repo> (next version)` with the `release` label. `issue:file` refuses `auto-ok` for that label on every path, so the release stays a person's call; a person may still add `auto-ok`.
3. Record the issue as a `blocked_by` blocker of the release issue and print `release: #<R> (open|filed) is blocked by #<N>`; a failed link exits 1.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:release` in detail".

### `josh issue:scout`

<!-- usage: issue:scout -->

Before filing: say whether an issue like this exists and which epic it belongs to.

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"
pnpm josh issue:scout "<title>" --body "parent: #1246"
pnpm josh issue:scout "<title>" --body-file draft.md
```

**Options:**

- `--body "<text>"` — supply references (`#N`) in a `parent: #N` line or an acceptance-criteria section so the epic half has a number to work from; without one there (a background mention does not count) it prints `Epic: not asked`.
- `--body-file <path>` — pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".

<!-- /usage -->

[`josh issue:file`](#josh-issuefile) runs this scan as a filing step.

Duplicates are scored by title token overlap: ≥2 significant shared words and similarity ≥0.35; an issue the body references explicitly is a candidate whatever its title. An incomplete search prints `Duplicates: incomplete`. The epic half does not replace [`josh epic:bundle`](#josh-epicbundle)'s decision.

### `josh issue:file`

<!-- usage: issue:file -->

File an Issue with every filing step: filing cap, fold, local checks (lint, Origin, auto-ok label), start condition and WIP cap, then the duplicate scout once none refuses, labels, then epic:bundle.

```bash
pnpm josh issue:file "<title>" --body-file body.md
pnpm josh issue:file "<title>" --body-file body.md --route tier-a --repo joshuafolkken/kit
pnpm josh issue:file "<title>" --body-file body.md --distinct 2801,2795
```

**Options:**

- `--body-file <path>` — the body. Required.
- `--route <tier-a|split|interrupt|review-cap>` — the `route:` label naming the filing route. Omit it for a filing with no route.
- `--label <name>` — an extra label (for example `epic`). Repeatable.
- `--repo <owner/repo>` — the target repository. Defaults to this repository.
- `--distinct <N,…>` — duplicate candidates you read and judged distinct.
- `--found-during <N>` — the Issue whose work the filing came from, when it is not the lane or branch Issue. The filing cap counts per origin (step 2); step 7 never holds it as a candidate here. #N gets a deferral comment.
- `--over-cap` — the run is blocked by this filing; the WIP cap lets it through.
- `--no-auto-ok` — needs a person's judgement (Tier B / C); no `auto-ok`.
- `--release` — a consumer can use the change only once it is published. The filed issue becomes a blocker of the target's release issue (step 10).
- `--blocks-finder` — with `--route interrupt`, the finder cannot go on until this issue is done. The finder is recorded as blocked by the filed issue (step 9); under an epic, `epic --reconcile <E>` after `epic --add` declares it.

<!-- /usage -->

The `direct-filing` guard refuses `gh api …/issues` and `gh issue create`, pointing here.

**Steps (run in this order):**

Steps 1 and 2 each end the filing on a refusal. Steps 3–7 run as one pass: each prints its refusal and the pass goes on, so one call prints every problem, the duplicate candidates of a body the lint refused included. Any refusal in the pass files nothing.

1. Refuse unless the target is first-party: a third-party target (Tier C), and one whose owner cannot be read (`unknown`). The `third-party-write` guard stays silent on `unknown`; this command files only to a tracker known to be ours.
2. In a run's session, refuse an origin's eleventh run filing (origin: `--found-during <N>`, else the lane or branch issue; none: the run invocation). Then, on a finder's second filing into the same repository, ask the [`josh issue:fold`](#josh-issuefold) question; only `fold` refuses, and `--distinct <N>` declares a separate deliverable. A split child (`--route split`) asks nothing.
3. Check the body against the same criteria as [`josh issue:lint`](#josh-issuelint), and for exactly one `- 人の判断: 不要` / `- 人の判断: 要` line under `## 背景`. Refuse on any problem, including a `- 優先度:` declaration that names no basis or sits below its floor (`issue-template.md`); a typed `--label priority:*` skips this judgement.
   A `- セキュリティ: <経路>` or `- 原因の park: #<N>` line sets that floor, and so do `- 原因の損失:` lines summing to 30 minutes or more (`josh issue:priority <N>` re-applies it after a recurrence); `- 原因のレーン:` only ranks, and no reduction percentage is asked for or judged. A malformed one is refused; a body with no declaration is filed at the floor.
   A malformed `- 実施可能条件:`, `- 実施可能日:`, `- 規模見積もり:` or `- 計測宣言:` refusal ends in a line ready to paste. A refused `--found-during <N>` filing whose body declares no causing lane ends in `- 原因のレーン: <分> 分（#<N>）`, filled from [`josh lane:net <N>`](josh-commands-run.md#josh-lanenet) once the ledger holds that lane's dispatch and merge.
   A `- 種別: 不具合` body with `- 原因: 不明（<理由>）` is refused without a `## 再現` holding a backticked command and its fenced output; a `- 原因: #<PR>` bug owes none.
   A `- 規模見積もり:` over the split guide on either axis ([`josh split:assess`](#josh-splitassess)'s) is refused too, unless the filing is `--route split` or declares `- 分割しない理由: <理由>`; over the cap (three times the guide) only `--route split` passes.
4. For another repository, confirm `## Origin` names the originating issue (`owner/repo#N` or a URL). Refuse when it does not. Then, for any target, read the number a `- 実施可能条件: #<PR> のマージ後 <K> マージ` line cites there and refuse when it is an issue rather than a pull request, naming the merged pull request that closed it (this repository only); an unreadable number passes.
   The issue form, `#<issue> を閉じる PR のマージ後 <K> マージ`, is not read: it waits on the pull request that closes the issue, for a follow-up filed before that pull request exists.
5. Print the `auto-ok` decision: the body's `- 人の判断: 不要` applies it and `- 人の判断: 要` does not; some labels and `--no-auto-ok` withhold it. An opted-in issue with neither `run:lane` nor `run:solo` is refused.
6. Count the target's open issues and print `wip: <count> open in <owner/repo> · cap <cap> · <verdict>`: `within` up to the cap; past it `exempt` (route `interrupt` / `split` / `tier-a`, or `--over-cap`), else `held`, which asks the exemption question and refuses; an unreadable count warns.
7. Run the same duplicate search as [`josh issue:scout`](#josh-issuescout) and print its report. File nothing until every candidate is named in `--distinct`; a duplicate is folded into the existing issue by `issue-fold-existing.md`. A filing to another repository points `GH_REPO` at the target, so the search and the epic decision run there.
8. Create any missing workflow label with its color and description — the same set as [`josh sync`](josh-commands.md#josh-sync). A label that cannot be created warns, and the filing goes on.
9. File with all labels in one request, plus the `priority:critical` / `priority:high` the declaration names; print the URL. A `--route interrupt --blocks-finder` filing in this repository then records its finder (step 2's origin) as blocked by the filed issue; a write that fails prints `⚠` with the `gh api` call to re-run, and the exit code stays 0; one that records nothing prints why.
10. With `--release`, link the filed issue to the target's release issue, as [`josh issue:release`](#josh-issuerelease) does. A link that does not complete prints `⚠` with that command to re-run, prefixed with `GH_REPO=<target>` for a `--repo` filing.
11. Run [`josh epic:bundle`](#josh-epicbundle) on the filed issue. When it gives no answer, print `⚠` with the command to re-run; the exit code stays 0.

A refusal in steps 1–7 files nothing and exits 1, and a filing that files nothing is never counted toward the cap. No delivered rule refuses the call ahead of the filing cap, WIP cap and fold steps.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:file` in detail".

### `josh issue:fold-existing`

<!-- usage: issue:fold-existing -->

Assess whether a complete draft can join an unstarted issue.

```bash
pnpm josh issue:fold-existing assessment.json --json
```

<!-- /usage -->

Run it after the issue and the draft are read. It returns `duplicate` / `fold` / `separate` / `inspect` and never updates the issue. The JSON carries the facts (`content`, `is_open`, `size_verdict`, `existing_body`, `draft_body`, …); an unknown fact answers `inspect`. `separate` returns to the ordinary filing path.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:fold-existing` in detail".

### `josh issue:fold`

<!-- usage: issue:fold -->

Before a second filing: say whether findings from this session fold into one issue.

```bash
pnpm josh issue:fold "First finding" "Second finding"   # fold | separate | no-fold-needed | undetermined
pnpm josh issue:fold "a" "b" --not-separable            # the pair is really one deliverable → fold
pnpm josh issue:fold "a" "b" --json                     # the verdict and reason, machine-readable
```

**Options:**

- `--not-separable` — declare the judgement half: the findings are one deliverable, so they fold whatever their size.
- `--json` — print the verdict and reason as JSON.

<!-- /usage -->

The size half is [`josh split:assess`](#josh-splitassess)'s verdict; `separate` needs separable **and** over the guide, and an unreadable diff answers `undetermined`. [`josh issue:file`](#josh-issuefile) asks it on a run's second filing.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:fold` in detail".

### `josh issue:cite`

<!-- usage: issue:cite -->

Print the paste-ready number-link citation line for each issue, in one call.

```bash
pnpm josh issue:cite 2220
pnpm josh issue:cite 2220 1758 1252                    # several numbers, read concurrently
pnpm josh issue:cite 45 --repo joshuafolkken/app-kit   # bare numbers in another repository
pnpm josh issue:cite joshuafolkken/app-kit#45 2220     # per-token owner/repo#N notation
```

**Options:**

- `--repo <owner/repo>` — the repository for every bare number; a token written `owner/repo#N` overrides it for itself.

<!-- /usage -->

Each line has the form `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <summary>`; the summary is the issue's own title, which you may adapt to the session language.

A number that resolves to nothing or a failed read is named on stderr rather than dropped, and any failure sets a non-zero exit. A non-numeric token refuses the whole call. The [`Stop` hook's citation notice](../prompts/collaboration-workflow/issue-citation.md) points at this command with the numbers it detected already filled in.

### `josh issue:comment`

<!-- usage: issue:comment -->

Post one comment to an issue from a file, so no shell expands the body.

```bash
pnpm josh issue:comment 2304 --body-file .josh/tmp/park.md   # the body from a file — no shell evaluates it
pnpm josh issue:comment 2304 --body "a short note"           # inline, for a body with no backticks or $
```

**Options:**

- `--body <text>` — the comment body, inline. Trimmed, with `\n` expanded to a newline.
- `--body-file <path>` — read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.

<!-- /usage -->

It accepts a PR as well as an issue and prints the comment URL.

The body travels through [`cli-body.ts`](../scripts/josh/cli-body.ts), shared with `notify` / `followup`; `--body` and `--body-file` at once is refused. The `raw-field-body` row of `pnpm josh rule:list` refuses the `-f body=@…` misfire before it runs, so the literal `@<path>` cannot reach GitHub.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:comment` in detail".

### `josh issue:plan`

<!-- usage: issue:plan -->

Record a plan: normalize the title, fill a blank body or comment, apply run:planned.

```bash
pnpm josh issue:plan 4134 --body-file plan.md --title "Add issue:plan" --planned   # kickoff's three writes
```

**Options:**

- `--body-file <path>` — the plan, from a file or stdin (`-`): a blank body takes it, else a comment.
- `--title <title>` — replace the issue title first.
- `--planned` — apply `run:planned` once the plan is posted, so the next entry skips planning.
- `--repo <owner/name>` — write to that repository's issue.

<!-- /usage -->

A plan without `### 影響を受ける既存の利用者` (entries, or `なし（<reason>）`) is refused.

### `josh plan:consumers`

<!-- usage: plan:consumers -->

List every existing reference to each identifier a plan adds or changes, by kind, and draft the plan's existing-consumers section.

```bash
pnpm josh plan:consumers lane:pause
pnpm josh plan:consumers lane:pause run:paused   # one block per identifier, one draft
```

<!-- /usage -->

### `josh issue:already-done`

<!-- usage: issue:already-done -->

Exit an issue whose work is already merged: post the evidence, apply already-done, release the hold.

```bash
pnpm josh issue:already-done 4130 --evidence-file .josh/tmp/already-done.md   # comment, label, release — in that order
```

**Options:**

- `--evidence-file <path>` — the evidence comment: the merging PR or commit and, per acceptance criterion, its `file:line`. An empty file is refused before anything is written.

<!-- /usage -->

See `issue-comments.md` → "When the work turns out to be already merged". Steps stop at the first failure. The Issue is never closed. A follow-up measurement — a body declaring `- 実施可能条件: #<PR> のマージ後 <K> マージ` — or a body that cannot be read is refused before anything is written; a measurement exits with `josh issue:measured`.

### `josh issue:measured`

<!-- usage: issue:measured -->

Complete a measurement-only issue: post the result, label it measured, close it, release the hold.

```bash
pnpm josh issue:measured 4452 --evidence-file .josh/tmp/measured.md           # comment, label, close, release — in that order
pnpm josh issue:measured 4452 --unmet --evidence-file .josh/tmp/measured.md   # the measurement fell short of the expected effect: measured:unmet as well
```

**Options:**

- `--evidence-file <path>` — the result comment: per acceptance criterion, the measurement and the run it came from. An empty file is refused before anything is written.
- `--unmet` — the measurement fell short of the expected effect it checked; adds the measured:unmet label `josh effect:audit` reads

<!-- /usage -->

See `issue-comments.md` → "A measurement-only Issue". Steps stop at the first failure. No pull request closes such an Issue, so the run does, then closes any epic it completed; `run:merge` reads it CLOSED as merged, never `run:stalled`.

The `measured` label tells this close from a person's, so `run:carry --end` and `run:tidy` still count it as merged. A criterion that needs a code change is not a measurement — that Issue takes the pull request.

### `josh pkg:scout`

<!-- usage: pkg:scout -->

Rank package candidates by measured metrics so the Package-First tier decision is read, not judged.

```bash
pnpm josh pkg:scout "date formatting" --size 5
```

**Options:**

- `--size <n>` — how many candidates to fetch and rank (default 10).

<!-- /usage -->

It queries the npm registry for npm score, weekly downloads, last publish, bundled-types mark, license and unpacked install size.

The verdict reads the top two's relative lead `(top − second) / top`: `clear` at 15% or more (select it, Tier A), `close` within it (ask the user, Tier B). A failed per-candidate read leaves that metric blank (`—`).

### `josh issue:lint`

<!-- usage: issue:lint -->

Check an issue body file for the template's required headings.

```bash
pnpm josh issue:lint .josh/tmp/issue-body.md
```

<!-- /usage -->

The required headings are `## 背景`, `## 現象`, `## 期待結果` and `## 受け入れ条件`, plus the bug classification (source: `prompts/collaboration-workflow/issue-template.md`). Run this before filing.

Prints `ok` and the labels to apply when the headings and one `- 種別:` declaration are present; a missing or conflicting declaration exits 1, as does a `- 種別: 不具合` body without a well-formed `- 原因:` origin line ([`josh defect:origin`](#josh-defectorigin) lists candidates). [`josh issue:file`](#josh-issuefile) runs it as a filing step.

A `実施可能条件` or `実施可能日` heading exits 1 and shows the `## 背景` declaration line to write instead.

A non-epic body without a well-formed `- 規模見積もり: 約 <N> ファイル / <M> 行（テスト除く）` line under `## 背景` exits 1. An epic (a body with `## Split rationale`) declares none.

A `- 種別: 振る舞い変更` body also needs `## 発火点`, `## ベースライン` (a re-runnable `` `<command>` → <value> ``) and `## 再現` (a command with its actual output). [`josh measure:rerun`](josh-commands-automation.md#josh-measurererun) re-runs the baseline after merge.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:lint` in detail".

### `josh defect:origin`

<!-- usage: defect:origin -->

List the merged pull requests that last changed what a defect issue names, as candidates for its origin line.

```bash
pnpm josh defect:origin 4241   # newest first, merged before the issue was filed
```

<!-- /usage -->

Lists up to five merged pull requests that changed the files and names an issue cites, newest first and merged before the issue was filed. Pick one for the `- 原因: #<PR>` line a `- 種別: 不具合` body declares, or write `- 原因: 不明（<理由>）` (source: `prompts/collaboration-workflow/issue-template.md`).

### `josh defect:report`

<!-- usage: defect:report -->

Count defects by the origin pull request their issue declares, by change kind and by area.

```bash
pnpm josh defect:report   # every issue labelled bug, open or closed
```

<!-- /usage -->

Counts the `bug` issues by their `- 原因:` origin pull request, by its change kind (add / fix / remove, read off the pull request's changed files) and by area, plus the defects filed within 7 days of a mechanism-adding merge. Unknown and undeclared origins are counted apart.

### `josh effect:audit`

<!-- usage: effect:audit -->

List closed run-time-shortening issues with their expected effect, follow-up measurement and result.

```bash
pnpm josh effect:audit                # issues closed in the last 30 days, one line each
pnpm josh effect:audit --days 7       # a shorter window
pnpm josh effect:audit --draft 4896   # write the retirement candidate of a shortfall and print its issue:file line
```

**Options:**

- `--days <N>` — the window, in days back from now (default 30)
- `--draft <issue>` — an issue whose measurement carries measured:unmet: write its retirement-candidate body to a temporary file

<!-- /usage -->

One line per closed `- 目的: 時間短縮` issue of the window: its expected effect (`効く率` · `1 回あたりの得` · `外れたときの損`), the follow-up measurements that cite it with a `- 実施可能条件:` line, and the result, then a tally.

The result reads the follow-ups' labels: `届かなかった` when one carries `measured:unmet` ([`josh issue:measured --unmet`](#josh-issuemeasured)), `届いた` when one carries `measured`, `未計測` otherwise.

`--draft <issue>` takes an issue whose result is `届かなかった`, writes its retirement-candidate body to a temporary file and prints the `josh issue:file` line to file it; any other result is refused. The body's angle-bracket lines are left for the filer, and `issue:file`'s scout stops a duplicate. When to run it: `prompts/collaboration-workflow/measurement.md` → "期待効果に届かなかったとき".

### `josh report:lint`

<!-- usage: report:lint -->

Check a two-layer work summary, or with --child-summary a lane child's summary, on stdin against its mechanical format rules.

```bash
pnpm josh report:lint < summary.md
pnpm josh report:lint --child-summary < summary.md
```

<!-- /usage -->

The format is `CLAUDE.md` Step 0, in `prompts/collaboration-workflow/report-format.md`. It enforces the mechanical half: labels present, no overview line over its character ceiling, no code fence around the summary, no file path or CLI flag in the overview.

Prints `ok` (exit 0), or the violations one per line plus one line naming the template's section in `report-format.md` (exit 1). The writer judges whether the overview names a concrete subject. The labels follow `JOSH_SESSION_LANG` (`ja`, else English), from the table `josh report:template` prints.

`--child-summary` checks a lane child's closing summary instead: its line bound over non-blank lines, the cause / fix / result labels in the session language, and no changed-file list (two or more consecutive path-only bullets). A failure's last line names the section that shapes it.

### `josh report:template`

<!-- usage: report:template -->

Print the work summary or completion report skeleton in the session language: summary | done.

```bash
pnpm josh report:template summary scripts/report/report-lint.ts
pnpm josh report:template done
```

<!-- /usage -->

It uses the label table `josh report:lint` checks, so it passes the lint in any language.

Each path fills the target or changed-file line and, for `summary`, a change block whose "if it breaks" tier opens with the abnormal cases `josh cases` owes for that path. Any other kind prints the usage and exits 1.

### `josh stash:push`

<!-- usage: stash:push -->

Stash the working tree, untracked files included, leaving the observation ledger.

```bash
pnpm josh stash:push "backlogrun: josh latest before lanes"
```

**Options:**

- `--dir <path>` — stashes that work tree (`git -C <path>`); without it the current checkout.

<!-- /usage -->

The message is what `josh stash:pop` targets. The observation ledger is `.josh/observations/`.

**Verdicts:** `stashed` and `clean` (exit 0); a missing message prints the usage (exit 1). `clean` means nothing was pushed, so pop only after `stashed`.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh stash:push` in detail".

### `josh stash:pop`

<!-- usage: stash:pop -->

Pop the stash matching this message, not whichever a shared stack has on top.

```bash
pnpm josh stash:pop "backlogrun: parked #2028"
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir"   # into a lane's work tree
```

**Options:**

- `--dir <path>` — applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.

<!-- /usage -->

**Verdicts:** `popped` and `conflicted` (exit 0), `no-match` and `ambiguous` (exit 1). `conflicted` means the stash is on the tree: resolve the conflicts and continue. A message matching no stash, or more than one, is refused — pass one identifying exactly one entry.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh stash:pop` in detail".

## Epics and backlog

Track an epic's children and pick what an unattended run takes next.

### `josh epic`

<!-- usage: epic -->

Create an epic issue from its child issue numbers.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file rationale.md
pnpm josh epic --promote 858 101 102 103                           # turn an existing issue into an epic
pnpm josh epic --add 893 894                                       # track #894, declaring no order for it
pnpm josh epic --add 893 894 --before 891                          # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890                           # #894 starts once #890 is done
pnpm josh epic --add 893 894 --decision-file why.md                # …and record why, in one call
pnpm josh epic --reconcile 2184                                    # rewrite the body to match the recorded blocked-by, and record any order the body declared
pnpm josh epic --decide 893 894 --decision-file why.md
```

**Options:**

- `--ordered` — argument order is the dependency order; writes the arrow chain, records the matching `blocked-by` relations, and adds a `### Declared order` entry under `## Decisions`.
- `--rationale-file <path|->` — split rationale prose (`-` reads stdin).
- `--origin <owner/repo#N>` — backlink when the split originated in another repository.
- `--before <M>` — with `--add`: insert before `#M`, re-pointing what `#M` was waiting on so the chain is never broken.
- `--after <M>` — with `--add`: start after `#M`; branches when `#M` already has a successor, extends when it is a tail.
- `--order-before <M>` / `--order-after <M>` — with `--add`: move the task-list row only; write no `blocked-by` relation.
- `--decision-file <path|->` — with `--add`: record why the child was placed.
- `--remove <E> <M> <N> [<N2> …]` — delete a declared order from the body and the relations; each consecutive pair is one link.

<!-- /usage -->

It satisfies all four mechanical requirements by construction: `epic` label, task-list child rows, machine-readable `Dependencies`, an `Execution` run command.

`Execution` prints `backlogrun #<E> --only`. A failed `blocked-by` write is reported as a count; the epic stays correct.

#### `josh epic --promote` — turn an existing issue into an epic

Appends the epic's sections to the issue's body, taking the same `--ordered` / `--rationale-file` / `--origin` options. Re-running is refused. Promote a request, discussion or container; when the issue is itself a deliverable, keep it as a child and create a new epic.

#### `josh epic --add` — insert children into an existing epic

Writes all three places an epic's order lives — the task list, the `## Dependencies` arrow declaration, and the native `blocked-by` relations — from one input, so they cannot disagree.

Nothing is written unless all three places will agree. `#M` must be a child of the epic; a position naming an issue being placed, or a hub the declaration cannot position within, is refused. A cross-repository target is refused with the bare-number command to run.

#### `josh epic --reconcile` — bring the declaration and the recorded relations back into agreement

When the `## Dependencies` declaration and the `blocked-by` relations disagree, `--reconcile` makes the declaration state exactly what is recorded, with no judgement.

- It **writes no `## Decisions`** — synchronizing a copy is not a decision.
- When the two already agree it writes nothing and prints `nothing to reconcile`.
- A circular union of declared and recorded orders is refused without writing.
- On success it states that `epic:audit` and `backlog:next` now agree on the epic's order.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh epic --reconcile` — bring the declaration and the recorded relations back into agreement in detail".

### `josh epic:next`

<!-- usage: epic:next -->

List an epic's runnable children, bundled per repository.

```bash
pnpm josh epic:next 858
pnpm josh epic:next 858 --repo joshuafolkken/kit           # just the next child for one repository
pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes   # one child per free lane there
```

**Options:**

- `--repo <owner/repo>` — answer for one repository; stdout carries one token (an issue number, or `wait`/`stop`/`complete`), everything else on stderr.
- `--lanes` — print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 8. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in `josh backlog:next`).

<!-- /usage -->

All state lives on GitHub, so asking again after an interruption gives the same answer.

With `--repo`, the occupancy line names each `in-progress` holder with its label age from the issue timeline — `in-progress for <n> min`, marked `stale` past 90 minutes or when the label predates the timeline, `label age unread` when it could not be read.

Several leading epic arguments merge into one candidate pool per repository. `run`/`wait`/`stop`/`complete` exit `0`; an unusable graph (cycle, or body/relations disagreement) exits `1`, as does a reference that does not parse.

**Priority and duplicates:** the order the epics were named, then each epic's task-list order (its declared chain still decides what is runnable). A child two epics track enters once, under the epic named earlier. Reordering with `josh epic --add … --order-before` / `--order-after` leaves declarations and `blocked-by` relations as they were.

**Lanes:** an `in-progress` issue occupies a lane, not the repository. Free lanes are `JOSH_LANE_LIMIT` (default 8) minus that repository's `in-progress` listing; at zero the answer is `wait`, holders on standard error. A parked child releases its lane; a `needs-human-review` stop keeps it. Launches also wait for their memory claim in the shared core budget.

**Nested epics:** a child that is itself an epic is never offered and waits on a person. The test is the child's `epic` label, not how its row is written: a cross-repository `owner/repo#N` row that is not an epic stays runnable. A parent epic over an epic never auto-closes; `epic:audit` reports the row.

**Blockers outside the named epics:** closed, it resolves (cross-repository: after its release); open and tracked by an epic named in the same call, the child waits on time (or on a person, if the blocker does); open and untracked, the child waits on a person and the blocker is named on standard error; an unknown state reads as waiting.

**Cross-repository children:**

- Their state is read through `gh api`. The epic auto-closes only when every such child's state could be read.
- A dependency resolves only when the blocker is closed **and** the version its default branch declares is in the registry (checked in that order) — the target is the release that includes the blocker. The publish check is `josh propagate`'s.
- A repository that publishes nothing (no `package.json` on its default branch, or `private`) resolves on close, read from its manifest; a failed manifest read (not 404) waits.

### `josh epic:bundle`

<!-- usage: epic:bundle -->

Say whether a newly filed issue belongs with ones already in the backlog.

```bash
pnpm josh epic:bundle 874
pnpm josh epic:bundle 874 --apply   # write it
```

<!-- /usage -->

It writes nothing without `--apply`; [`josh issue:file`](#josh-issuefile) runs it on the issue it creates as its last filing step.

Only two things count as a signal: one issue naming the other in its acceptance criteria (`## 受け入れ条件` / `## Acceptance criteria`) or its `parent: #N` / `親: #N` line, or an already-recorded `blocked-by`. A reference in any other section, or a similar title, does not.

| Candidates                                     | What to do                                          | Tier |
| ---------------------------------------------- | --------------------------------------------------- | ---- |
| The new issue itself already has an epic       | Nothing                                             | —    |
| Already a child of an epic                     | Add to that epic                                    | A    |
| Spread across an epic and its own parent       | Add to the inner epic                               | A    |
| Spread across different epics                  | Choose the one you recommend, add to it, record why | A    |
| In no epic, two or more counting the new issue | Create an epic                                      | A    |
| No strong signal / listing cut short           | Nothing                                             | —    |

Prints an `Order:` line with an `Evidence:` block, or `Order: none declared — do not invent one`. Exit is non-zero only when a listing could not be read; a cut epic listing withholds every placing verdict.

### `josh epic:audit`

<!-- usage: epic:audit -->

Audit an epic's children against each other for contradictions.

```bash
pnpm josh epic:audit 858
```

<!-- /usage -->

`epic:check` verifies one epic's format; this reads inside the children.

| Check                | Level     | What it means                                                                                                  |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| Implicit dependency  | warning   | A child's body names another child, and nothing orders the two.                                                |
| Order contradiction  | **error** | Acceptance criteria name another child with nothing ordering them (warning once either closes, or cross-repo). |
| Unresolved reference | warning   | A body cites an issue that does not exist or is already closed.                                                |
| Nested epic          | warning   | A task-list row points at another epic.                                                                        |
| Orphan child         | warning   | An issue names this epic as parent but the task list does not track it.                                        |
| Orphan search        | **error** | The open-backlog search could not be read — re-run the audit.                                                  |
| Unjustified order    | **error** | The body declares an order between two open children and nothing records why.                                  |

An open-backlog search that stopped before the end (only the newest 500 issues, or 50 bodies, were covered) is a warning. Cycle and declaration checks are reused from `epic:next`. A forward reference the other child already depends on is not reported, and a pair is demoted to a warning only when the closed state is confirmed (any state but `CLOSED` normalizes to `OPEN`).

Only errors change the exit code. Run it at the start of a `backlogrun` epic run and after a child or dependency changes. Fixing its findings is Tier A; park with `needs-decision` only for an unmade design choice.

### `josh epic:check`

<!-- usage: epic:check -->

Check an epic issue against the tracking requirements.

```bash
pnpm josh epic:check 700
```

<!-- /usage -->

It checks the same four requirements as `josh epic`. Use it on hand-made epics, epics predating `josh epic`, and after editing an epic body.

Exits `0` when every requirement is satisfied, `1` otherwise. The dependencies check wants exactly one of the two machine-readable forms — neither is ambiguous, both a contradiction.

### `josh auto-ok:next`

<!-- usage: auto-ok:next -->

Print the next opted-in issue an unattended run may pick up outside an epic.

```bash
pnpm josh auto-ok:next
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
```

**Options:**

- `--exclude <N>` — drop issues from the answer; comma-separated, repeatable.

<!-- /usage -->

Read-only. Ranks `priority:critical`, then `priority:high`, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then issues other open issues wait on (all keys: **Ranking** below), then newest-first, skipping `epic`, `in-progress`, `needs-decision` and any candidate whose `blockedBy` is still open or whose `- 実施可能日:` (`YYYY-MM-DDTHH:MMZ`) has not arrived,
or whose `- 実施可能条件: #<PR> のマージ後 <K> マージ` (or `#<issue> を閉じる PR のマージ後 <K> マージ`) is not yet met; `backlog:next` prints `#N not before <time>`, or for the condition `until #<PR> merges`, `<n>/<K> merges after #<PR>` or `until the merge of #<PR> is read` — `the pull request closing #<issue>` in place of `#<PR>` for the issue form.

`josh start` creates the `auto-ok` label, and `josh sync` adds it to a repository that lacks it. stdout is the issue number, `none`, or empty with exit 1 if the listing could not be read; explanations to stderr.

### `josh auto-ok:judge`

<!-- usage: auto-ok:judge -->

List the open issues backlogrun owes an auto-ok judgement, or record one (--apply / --decline).

```bash
pnpm josh auto-ok:judge                                  # the issues that still owe a judgement
pnpm josh auto-ok:judge --apply 912 --lane               # opt it in, with its run label
pnpm josh auto-ok:judge --decline 913 --reason "<why>"   # record why it stays out
```

**Options:**

- `--apply <N> --lane|--solo` — checks the exclusions again against the labels as they stand, records the judgement on the issue, then applies the run label and then `auto-ok`.
- `--decline <N> --reason <text>` — applies nothing.

<!-- /usage -->

`backlog:drive` hands back `judge` when the opted-in pool is exhausted, a lane is free and at least one such issue exists.

A candidate is an open issue without `auto-ok` that carries none of the labels [`josh issue:file`](#josh-issuefile) refuses `auto-ok` on. Whether it needs a policy decision, an external account or a person's visual check is read by the agent, never by this command.

Bare, it prints one number per line on stdout, or `none`, with each title on stderr; exit 1 if the listing could not be read.

Both post a judgement comment with a digest of the body; the issue is listed again only after its body changes or a person comments after it.

### `josh backlog:next`

<!-- usage: backlog:next -->

Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics.

```bash
pnpm josh backlog:next
pnpm josh backlog:next --exclude 1630   # skip the issue just merged
```

**Options:**

- `--exclude <N>` — drop issues from every bucket; comma-separated, repeatable.

<!-- /usage -->

Read-only. stdout is bare issue numbers to start, or `wait`, `stop`, `triage`, `retry`, `error` or `none`; empty with exit 1 if a listing could not be read. Explanations go to stderr.

**Triage gate**: while any candidate carries neither `run:solo` nor `run:lane`, it prints `triage` and no numbers, naming the untriaged issues on stderr.

**Defect priority**: while the defect rate is above its baseline, defects go to the front of the runnable numbers and new mechanisms to the back, among ranking ties.

**Ranking**: a body declaring `- 実施順: 最後` goes last; otherwise `priority:critical`, then `priority:high`, then a verification-path defect, then larger lost minutes (`- 原因の損失:` lines summed, else `- 原因のレーン:`), then the number of open issues waiting on it down a chain (transitively), then the declared weekly gain (`## 期待効果`); standalone numbers are cut to five.

**`run:solo` gate**: a `run:solo` issue runs alone — `wait` while it or other lanes run, and a `run:solo` candidate further down cuts the list.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:next` in detail".

### `josh backlog:plan`

<!-- usage: backlog:plan -->

Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope.

```bash
pnpm josh backlog:plan
pnpm josh backlog:plan --exclude 1630   # after #1630 merged
pnpm josh backlog:plan --waves          # the run order, wave by wave
```

**Options:**

- `--exclude <N>` — same exclusion as `backlog:next`.
- `--waves` — print the order the run takes, wave by wave, assuming each wave merges before the next. Read-only.

<!-- /usage -->

It uses `backlog:next`'s own classification, kept separate because that command's stdout is bare tokens a loop branches on. A wave holds at most the lane limit's standalone issues, not `backlog:next`'s five, and none is cut when the limit cannot be read; the header says which.

```text
Wave 1  #2770 [run:solo]
Wave 2  #2765 [run:solo]
Wave 3  #2774 #2766 #2769   (parallel)
```

Sections: **Ready now** (runnable children grouped by repository, in the order the offer walks them — an issue that yielded its lane first, then the rank — so each wave keeps this order; a `run:solo` row is marked `[run:solo]`, one with neither `run:solo` nor `run:lane` `[untriaged]`), **Waiting** (each withheld child naming what it waits on),
**Waiting on a person** (parked children — `needs-decision`, `run:stalled` or `already-done` — each naming its label), **Out of scope** (every open issue the backlog will not run, with the reason).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:plan` in detail".

### `josh backlog:budget`

<!-- usage: backlog:budget -->

Say whether a backlogrun may start more work, keep watching, or finish.

```bash
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active"
pnpm josh backlog:budget --answer exhausted --started "$started" --active "$active" --idle 60
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active" --merged 3 --running 2 --max 5
```

**Options:**

- `--answer <candidates|exhausted|blocked|parked|unreadable|untriaged>` — `backlog:next`'s answer, mapped.
- `--started` / `--active` — when the invocation began / when it last had work (required unless the watch is off).
- `--idle <minutes>` — once nothing can proceed, keep polling this long, counted from `--active` (default 480, 8 hours; `--idle 0` turns the watch off).
- `--max <count>` — issues one invocation may take (default unlimited); `--merged` and `--running` count against it.
- `--json` — collapse verdict and reason into `{"budget": "<verdict>", "reason": "…"}`.

<!-- /usage -->

Read-only. stdout is `run`, `watch`, `stop` or `triage`; empty with exit 1 if unreadable. An idle watch polls every 60 s.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:budget` in detail".

### `josh backlog:offer`

<!-- usage: backlog:offer -->

Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start.

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

<!-- /usage -->

This section is the single source of the mapping from `backlog:next`'s answer to a budget word:

- issue numbers → `candidates`; `none` → `exhausted`; `stop` → `parked`; `triage` → `untriaged`
- `wait` → `blocked` with children in flight, `exhausted` without
- `retry` → `blocked` below three consecutive asks, `unreadable` at the third
- `error`, or exit 1 with empty stdout → `unreadable`, never `none`

`--exclude` / `--repo` forward to `backlog:next`; the budget flags to `backlog:budget`. stdout is the verdict, then on `run` the issue numbers; the retry count is the last stderr line.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the event stream (once per drain, best-effort), so the next `run:step` fires the retrospective before the idle watch. A watch opened while children still merge is unmarked.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:offer` in detail".

### `josh backlog:drive`

<!-- usage: backlog:drive -->

Drive backlogrun through offer, launch and merge; restore this run’s lanes and report when complete.

```bash
pnpm josh backlog:drive --owner "$PPID" [--max <n>] [--idle <minutes>] [--only]
```

<!-- /usage -->

An open carry record supplies the start time, merged count and named issues. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `judge`, `watch`, `triage`, `retrospective` or `window`) or `stop <reason>`; the second carries resume flags.

A pass launches every free lane it seats side by side, not one after another. A refused launch is answered after the others settle, which stay in flight; only one launch at a time holds the `josh latest` stash.

A watch with no child running sends one `💤` Telegram per idle episode (merged count, `needs-decision` issues, issues waiting on a not-before date); the next dispatch ends the episode.

The `needs-human-review` and `already-done` labels a backlog run reads are in [Labels and run states](./labels-and-run-states.md).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:drive` in detail".

## Review, delegation and oracles

Brief and attest a review, decide what a run delegates, and list the computed answers a run reads.

### `josh review:brief`

<!-- usage: review:brief -->

Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone).

```bash
pnpm josh review:brief                       # round 1
pnpm josh review:brief --round 2             # verification pass, scoped to the fix delta
pnpm josh review:brief --interaction         # the interaction review of a run-tooling change
pnpm josh review:brief --level-only          # the level alone (pre-commit review)
pnpm josh review:brief --level-only --json   # level and reason, machine-readable
```

**Options:**

- `--round 2` — target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).
- `--level-only` — print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.
- `--staged` / `--json` — the staged diff; machine-readable level and reason.

<!-- /usage -->

Pass the output to `/code-review`; the level is on line one. It refuses to compose a brief when the scoped checks have never been green on this tree; run `pnpm josh lint:related && pnpm josh test:related`, then reissue. Pass the `reviewer` profile it prints (model and effort) explicitly to the review subagent.

#### The review level

`--level-only` prints the level from the list of changed paths and nothing else.

| Every changed path is…                                                                   | Level    | Rounds  |
| ---------------------------------------------------------------------------------------- | -------- | ------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1       |
| anything else                                                                            | `medium` | up to 2 |

One non-inert path decides the whole change; an empty diff also takes `medium`. `.vscode/**`, `.gitattributes` and `.prettierignore` look inert but are written into every consumer by `josh init` / `josh sync`. Documentation is not inert: `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` stay `medium`.

### `josh review:round2`

<!-- usage: review:round2 -->

Say whether the second /code-review round is due, or may be skipped entirely.

```bash
pnpm josh review:round2                # → required | skip, for the branch’s issue
pnpm josh review:round2 --record 123   # → required | skip, a skip commented on that issue
pnpm josh review:round2 --json         # the verdict and the reason, machine-readable
```

**Options:**

- `--record` — the issue whose ledger dispositions decide round 1’s closure — skip only when every High/Medium is `fixed` or `false-positive` — and where a skip is commented under `## Round 2 skipped`, once.
- `--json` — machine-readable verdict and reason.

<!-- /usage -->

Run it after round 1's fixes. `skip` when the fix delta is empty or touches only inert paths (docs, prompts, `josh metrics` approvals, comment-only code); `required` otherwise. Full reasoning: `prompts/review.md`.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh review:round2` in detail".

### `josh prose:stale`

<!-- usage: prose:stale -->

List each removed declared or exported name, josh command, UPPER_CASE constant or .md heading that docs, prompts or comments still name.

```bash
pnpm josh prose:stale   # → `file:line kind word` per reference, or `ok` (exit 1 / 0; 2 on a failure)
```

<!-- /usage -->

The self-check's "Prose matches the code" (`prompts/review.md`) as a search. From the change base to the working tree it takes each removed name and `UPPER_CASE` constant (a top-level `.ts` / `.js` declaration or an `export { … }` entry), `josh` command and `.md` heading.

It drops the ones an added line still writes (an added `.md` heading, for a heading) and the commands the registry still holds.

It searches `.md` files and the comment lines under `prompts/`, `docs/`, `.claude/` and `scripts/` (`CHANGELOG.md` left out). A heading is searched quoted, the way a `→ "Heading"` pointer names it.

Prints `file:line kind word` per reference, or `ok`. Exits 1 on a reference, 2 when the base or a search could not be read — a failed search is never `ok`.

### `josh disposition`

<!-- usage: disposition -->

Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime).

```bash
pnpm josh disposition <path...>   # → runtime | non-runtime
```

<!-- /usage -->

`runtime` means any non-inert path, per `review-level.ts`'s inert set; only "is the defect confirmed" is left to a person. Reason on stderr. Full reasoning: `prompts/review.md` → "Three-way disposition after the cap".

### `josh review:attest`

<!-- usage: review:attest -->

Record, or verify, which checkout a /code-review actually read.

```bash
pnpm josh review:attest <nonce>   # run by the review, from the checkout it read
pnpm josh review:attest --check   # run by the run, before it acts on the review
```

**Options:**

- `<nonce>` — attest the checkout the review read.
- `--check` — verify before acting; `josh followup` asks again before merging.

<!-- /usage -->

A `/code-review` is forked into the session's working directory, so a lane run can read the wrong tree. `josh review:brief` prints the nonce; `attest <nonce>` exits non-zero off the briefed checkout.

Answers `ok`, `missing` (a refusal), `mismatch` or `not-required`; an attestation expires after eight hours, and `ok` is refused on an unread issue update ([`josh issue:ack`](#josh-issueack)).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh review:attest` in detail".

### `josh review:lint`

<!-- usage: review:lint -->

Check a review's markdown on stdin against the review rubric's output format, round 1 or with --round 2 the verification pass.

```bash
pnpm josh review:lint < review.md
pnpm josh review:lint --round 2 < review.md
```

<!-- /usage -->

The format is `prompts/review-rubric.md` → "Review output format". It enforces the mechanical half: the category headings in order, a verdict under each, the trace behind category 1's `No issues`, 2–3 assumptions, no banned Confidence floor answer, a `file:line` and severity on every finding, and no code fence. `--round 2` requires only the verification pass's three headings.

Prints `ok` (exit 0), or the violations one per line plus one line naming the rubric's section (exit 1). Whether a finding is right stays with the reviewer.

### `josh delegate`

<!-- usage: delegate -->

Say whether a run step may go to a cheaper execution tier.

```bash
pnpm josh delegate gate-fix   # → delegate
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

<!-- /usage -->

Verdict to stdout, reason to stderr.

**Anything not on the list is `keep`.** A step earns its place by naming how a wrong result is caught — by something in the parent tier that costs less than redoing the step.

| Step                         | Delegatable because                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-fix`                   | `pnpm josh gate` re-runs; a wrong fix fails it again, naming the file                                                                                                        |
| `epic-child`                 | the parent reads the child's state from GitHub, so a child reported done but not merged shows as still open                                                                  |
| `followup-filing`            | the parent reads the filed Issue with `pnpm josh issue:state <new>`, so one reported filed but not created shows as absent                                                   |
| `survey`                     | the reported locations are checked directly; a fabricated or missed one fails one `grep`                                                                                     |
| `investigation`              | the parent opens the cited lines; an unsupported conclusion fails there, far cheaper than redoing the reading                                                                |
| `implementation-unit`        | the parent runs the whole change through `pnpm josh gate` and a `/code-review` it would run anyway, so a unit's mistake fails the same backstop a serial edit passes through |
| `lane-failure-investigation` | the `backlogrun` parent opens the cited lines and re-reads the child with `pnpm josh issue:state`; parking, re-dispatching and filing stay with the parent                   |

**Considered and kept** (`pnpm josh delegate <step>` answers `kept deliberately`, unlike an unlisted step):

| Step               | Kept because                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `notify-body`      | no verifier; a wrong body is sent and read as though it were right                      |
| `issue-comment`    | no verifier; a decision log or completion comment _is_ the record, so nothing checks it |
| `status-read`      | a misread routes the run to the wrong child and no later step disagrees                 |
| `diagnosis`        | a wrong root cause produces a fix that passes the gate and leaves the defect            |
| `design`           | the cost of a wrong design is paid by every step after it                               |
| `split-assessment` | a missed split widens one Issue into a batch nobody authorized                          |
| `review`           | the review is the last thing between a defect and a merge; a cheaper one finds less     |

**`investigation` is the only row that carries a threshold, and the threshold is 3 files, and it is a count, not a forecast.** It is where the guard refuses, not a budget: a run whose subject needs reading delegates before the first read (`run:prep` → `=== investigation ===`).
What comes back is the conclusion plus supporting `file:line` citations, never the file text; a throwaway probe script is written, run and deleted inside the unit.

**It is not `survey`, and it is not `diagnosis`**: `survey` reports where something appears and is checked by one `grep`, while a root cause stays with the main line. `pnpm josh delegate --list` prints the count.

**A delegation resets the counter rather than spending it**; the `investigation` row of `pnpm josh rule:list` does the counting (`docs/maintainers/josh-commands-backlog-rationale.md` → "`josh delegate` no longer counts investigation reads").

**The mechanism is not the unit.** **One row covers both batch entry points**: an epic's child and one named issue of a `backlogrun` are the same unit, so both were wired to `epic-child`.

`followup-filing` is a third such unit: the parent composed the finding text either way.

`implementation-unit` is a fourth: the writing of one Step 0 unit goes to a subagent while the design stays in the main line, and only file-disjoint units split — `josh fanout` confirms that mechanically. Rule: `.claude/skills/workflow-commands/delegation.md`.

### `josh fanout`

<!-- usage: fanout -->

Say whether proposed implementation units are file-disjoint, so they may run in parallel.

```bash
pnpm josh fanout scripts/a.ts,scripts/a.test.ts scripts/b.ts     # → parallel
pnpm josh fanout scripts/a.ts,shared.ts scripts/b.ts,shared.ts   # → serial (units share shared.ts)
pnpm josh fanout scripts/a.ts                                    # → serial (fewer than two units)
```

<!-- /usage -->

Each argument is one unit's comma-separated file list; verdict on stdout, reason on stderr. A split is refused when any file is in two units; the default is serial.

This is the precondition the `implementation-unit` delegation row reads; the procedure is one fan-out turn:

1. From the Step 0 change list, group the `<what changes> — Test: … — <file path>` rows into candidate units, each a set of files no other unit touches.
2. Ask `pnpm josh fanout` with each unit's file list. On `serial`, write the change in the main line. On `parallel`, continue.
3. **Launch every unit's subagent in a single turn** (`prompts/collaboration-workflow/turn-batching.md`), each briefed with its own files and its slice of the Step 0 table.
4. The main line keeps the design, integrates the returned edits, and runs one `pnpm josh gate` and `/code-review` over the whole — the row's verifier.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh fanout` in detail".

### `josh split:assess`

<!-- usage: split:assess -->

Measure the branch change size (tests excluded) and answer the split assessment size question: split | single.

```bash
pnpm josh split:assess          # → single
pnpm josh split:assess --json   # the verdict and the reason, machine-readable
```

<!-- /usage -->

It counts changed files and lines against `main`, **excluding test files** (`*.test.ts` / `*.e2e.ts`). `split` needs **either** the file guide or the line guide exceeded (`split_assess.FILE_GUIDE` / `LINE_GUIDE`), `single` otherwise — the size question only (`.claude/skills/workflow-commands/split-assessment.md` → "The question").

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh split:assess` in detail".

### `josh oracle:list`

<!-- usage: oracle:list -->

Print the decision oracles — commands that answer a rule question mechanically.

```bash
pnpm josh oracle:list
```

<!-- /usage -->

Oracles are defined in `prompts/collaboration-workflow/residency.md` → "第 0 問". A declared firing point refuses that action until the oracle has run (`scripts/rules/oracle-consulted.ts`); the rest stay visibly unenforced. Single source: `scripts/rules/decision-oracle.ts` (the enumeration) and `scripts/rules/oracle-firing.ts` (the firing points).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh oracle:list` in detail".

### `josh clone:scan`

<!-- usage: clone:scan -->

Count code duplication across files and first-party repositories, printing each clone as file:line pairs.

```bash
pnpm josh clone:scan
```

<!-- /usage -->

First-party repositories include those in `JOSH_REPO_PATHS`.

Output: `clean`, or `clones: <N>` then each clone `[same-file|cross-file|cross-repo]` with `file:line` (exit 0). Single source: `scripts/clone/clone-scan.ts`.

### `josh cases`

<!-- usage: cases -->

Read changed paths and print the boundaries crossed and their mandatory abnormal cases: network | process | fs | time | state | env | none.

```bash
pnpm josh cases scripts/a.ts scripts/b.ts   # the boundaries these paths cross
```

<!-- /usage -->

Single source: `scripts/cases/cases-cli.ts`. Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh cases` in detail".
