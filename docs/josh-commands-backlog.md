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
pnpm josh issue:read 1715 1567 1605                    # several numbers, read concurrently
pnpm josh issue:read 42 --repo joshuafolkken/app-kit   # an issue in another repo
```

**Options:**

- `--repo <owner/repo>` — read an issue in another repository; applies to every number.

<!-- /usage -->

The state is printed too. Attribute each block by its `issue:` line, never by position.

Output past the Bash cap is written as part files, only their paths printed — read every part with the Read tool in one turn. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered. A non-numeric token refuses the whole call.

`--repo` reads the body and the comments from the named repository; an empty, repeated or misspelled `--repo` refuses the call.

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

Raise an issue to the priority its body declares or reaches, or set the one a person instructs.

```bash
pnpm josh issue:priority 4960
pnpm josh issue:priority 6707 --critical --reason "asked in this turn"   # on a person's instruction only
pnpm josh issue:priority 6683 --normal --reason "asked in this turn"     # lowers it the same way
```

<!-- /usage -->

Either way the issue keeps one priority label: the new one goes on, then the others come off.

`--critical|--high|--normal --reason "<text>"` sets that level whatever the body declares, raising or lowering, and comments the reason on the issue. `--normal` takes every priority label off.

- Use it **only on a person's current-turn instruction** ("make #N critical"), `--reason` giving its gist. Never on an agent's own judgment: the agent's route is the body's `- 優先度:` declaration.
- More than one level flag, or no non-blank `--reason` → usage error, nothing written. Already at that level with no other priority label → `labelled`, no comment. A failed label change or comment → `failed`, exit 1.

### `josh issue:state`

<!-- usage: issue:state -->

Print each issue's state and labels, in the spelling the documents compare against.

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read an issue in another repository; applies to every number.

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
pnpm josh issue:scout "<title>" --body-file .josh/tmp/draft.md
```

**Options:**

- `--body "<text>"` — supply references (`#N`) in a `parent: #N` line or an acceptance-criteria section so the epic half has a number to work from; without one there (a background mention does not count) it prints `Epic: not asked`.
- `--body-file <path>` — pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".

<!-- /usage -->

[`josh issue:file`](#josh-issuefile) runs this scan as a filing step.

Duplicates are scored by title token overlap: ≥2 significant shared words and similarity ≥0.35; an issue the body references explicitly is a candidate whatever its title. An incomplete search prints `Duplicates: incomplete`. The epic half does not replace [`josh epic:bundle`](#josh-epicbundle)'s decision.

### `josh issue:file`

<!-- usage: issue:file -->

File an Issue: filing cap, fold, one pass naming each refusal (lint, Origin, auto-ok, start condition, WIP cap, scout), labels, epic:bundle.

```bash
pnpm josh issue:file "<title>" --body-file .josh/tmp/body.md
pnpm josh issue:file "<title>" --body-file .josh/tmp/body.md --route tier-a --repo joshuafolkken/kit
pnpm josh issue:file "<title>" --body-file .josh/tmp/body.md --distinct 2801,2795
pnpm josh issue:file --batch .josh/tmp/deferred --route tier-a
pnpm josh issue:file --batch .josh/tmp/deferred.md --route tier-a
```

**Options:**

- `--body-file <path>` — the body. Required unless `--batch`.
- `--batch <dir|file>` — file each `*.md` in `<dir>` by name, or each `%%%`-separated part of `<file>`, other flags applied to each; every scout report prints once before the first filing. Title: front matter `title:`, else the first line; front matter `distinct: <N,…>` is its `--distinct`. A refused filing stays unfiled, the rest are filed, the summary names each; any refusal exits 1.
- `--route <tier-a|split|interrupt|review-cap>` — the `route:` label naming the filing route. Omit it for a filing with no route.
- `--label <name>` — an extra label (for example `epic`). Repeatable.
- `--defect / --verification / --every-run <yes|no|unknown>` — `--label run:solo` requires all three `yes`: a verification defect affecting unrelated PRs every run. Missing, invalid, `no` or `unknown` answers file nothing; success comments the three answers on the issue.
- `--repo <owner/repo>` — the target repository. Defaults to this repository.
- `--distinct <N,…>` — duplicate candidates you read and judged distinct.
- `--found-during <N>` — the Issue whose work the filing came from, when it is not the lane or branch Issue. The filing cap counts per origin (step 2); step 7 never holds it as a candidate here. #N gets a deferral comment.
- `--over-cap` — the run is blocked by this filing; the WIP cap lets it through.
- `--no-auto-ok` — needs a person's judgement (Tier B / C); no `auto-ok`.
- `--release` — a consumer can use the change only once it is published. The filed issue becomes a blocker of the target's release issue (step 10).
- `--blocks-finder` — with `--route interrupt`, the finder cannot go on until this issue is done. The finder is recorded as blocked by the filed issue (step 9); under an epic, `epic --reconcile <E>` after `epic --add` declares it.
- `--check` — run steps 1–7, create nothing; exit 1 on a refusal. `--batch` refuses it.

<!-- /usage -->

The `direct-filing` guard refuses `gh api …/issues` and `gh issue create`, pointing here.

**Steps (run in this order):**

Steps 1–2 stop on refusal. Steps 3–7 report problems, including duplicates when lint fails. Refusals file nothing.

1. Refuse unless the target is first-party: a third-party target (Tier C), and one whose owner cannot be read (`unknown`). The `third-party-write` guard stays silent on `unknown`; this command files only to a tracker known to be ours.
2. In a run's session, refuse an origin's eleventh run filing (origin: `--found-during <N>`, else the lane or branch issue; none: the run invocation). Then, on a finder's second filing into the same repository, ask the [`josh issue:fold`](#josh-issuefold) question; only `fold` refuses, and `--distinct <N>` declares a separate deliverable. A split child (`--route split`) asks nothing.
   A split child with a plain `--found-during <N>` is refused when a code span in `#N`'s `## 期待結果` / `## 受け入れ条件` names the module of a file the child declares. `#N` depends on that part, so the refusal points to a prerequisite and `josh run:split <N> --prerequisite <P>`; an unreadable body refuses nothing.
3. Check the body against the same criteria as [`josh issue:lint`](#josh-issuelint), and for exactly one `- 人の判断: 不要` / `- 人の判断: 要` line under `## 背景`. Refuse on any problem, including a `- 優先度:` declaration that names no basis or sits below its floor (`issue-template.md`); a typed `--label priority:*` skips this judgement.
   A `- セキュリティ: <経路>` or `- 原因の park: #<N>` line sets that floor, and so do `- 原因の損失:` lines summing to 30 minutes or more (`josh issue:priority <N>` re-applies it after a recurrence); `- 原因のレーン:` only ranks, and no reduction percentage is asked for or judged. A malformed one is refused; a body with no declaration is filed at the floor.
   A malformed `- 実施可能条件:`, `- 実施可能日:`, `- 規模見積もり:` or `- 計測宣言:` refusal ends in a line ready to paste. A refused `--found-during <N>` filing whose body declares no causing lane ends in `- 原因のレーン: <分> 分（#<N>）`, filled from [`josh lane:net <N>`](josh-commands-lane.md#josh-lanenet) once the ledger holds that lane's dispatch and merge.
   A `- 種別: 不具合` body with `- 原因: 不明（<理由>）` is refused without a `## 再現` holding a backticked command and its fenced output; a `- 原因: #<PR>` bug owes none.
   A `- 規模見積もり:` whose counts doubled are over the split guide on either axis ([`josh split:assess`](#josh-splitassess)'s) is refused too, unless the filing is `--route split` or declares `- 分割しない理由: <理由>`; without either, one over the cap (one and a half times the guide) or projected past the implement stage budget at the measured rate is refused the same way.
4. For another repository, confirm `## Origin` names the originating issue (`owner/repo#N` or a URL). Refuse when it does not. Then, for any target, read the number a `- 実施可能条件: #<PR> のマージ後 <K> マージ` line cites there and refuse when it is an issue rather than a pull request, naming the merged pull request that closed it (this repository only); an unreadable number passes.
   The issue form, `#<issue> を閉じる PR のマージ後 <K> マージ`, is not read: it waits on the pull request that closes the issue, for a follow-up filed before that pull request exists.
5. Print the `auto-ok` decision: the body's `- 人の判断: 不要` applies it and `- 人の判断: 要` does not; some labels and `--no-auto-ok` withhold it. An opted-in issue with neither `run:lane` nor `run:solo` is refused.
6. Count the target's open issues and print `wip: <count> open in <owner/repo> · cap <cap> · <verdict>`: `within` up to the cap; past it `exempt` (route `interrupt` / `split` / `tier-a`, or `--over-cap`), else `held`, which asks the exemption question and refuses; an unreadable count warns.
7. Run the same duplicate search as [`josh issue:scout`](#josh-issuescout) and print its report. File nothing until every candidate is named in `--distinct`; a duplicate is folded into the existing issue by `issue-fold-existing.md`. A filing to another repository points `GH_REPO` at the target, so the search and the epic decision run there.
   - An open issue with the same normalized `- 計測宣言:` refuses the filing whatever `--distinct` names, printing its number; join it with `pnpm josh issue:comment <N>`. Another command or bound, a closed issue and `- 計測宣言なし:` pass.
8. Create any missing workflow label with its color and description — the same set as [`josh sync`](josh-commands.md#josh-sync). A label that cannot be created warns, and the filing goes on.
9. Create with all labels and print the URL. A local `--route interrupt --blocks-finder` filing records its finder as blocked by it; failures warn with the retry command, skipped records say why.
   Local `原因の park: #<N>` lines record stops through the shared epic recorder. Foreign filings skip them. Failures warn and continue; repair dependencies without refiling. Post-create failures leave exit 0.
10. With `--release`, link the filed issue to the target's release issue, as [`josh issue:release`](#josh-issuerelease) does. A link that does not complete prints `⚠` with that command to re-run, prefixed with `GH_REPO=<target>` for a `--repo` filing.
11. Run [`josh epic:bundle`](#josh-epicbundle) on the filed issue. When it gives no answer, print `⚠` with the command to re-run; the exit code stays 0.

A refusal in steps 1–7 files nothing and exits 1, and a filing that files nothing is never counted toward the cap. No delivered rule refuses the call ahead of the filing cap, WIP cap and fold steps.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:file` in detail".

### `josh issue:fold-existing`

<!-- usage: issue:fold-existing -->

Assess whether a complete draft can join an unstarted issue.

```bash
pnpm josh issue:fold-existing --fingerprint 5848                                 # read the comment fingerprint before assessment.
pnpm josh issue:fold-existing assessment.json --json
pnpm josh issue:fold-existing assessment.json --apply 5848                       # apply and verify the assessed fold and priority floor.
pnpm josh issue:fold-existing assessment.json --apply 5848 --blocked 5849        # record a confirmed duplicate dependency and reconcile its epic.
pnpm josh issue:fold-existing assessment.json --apply 5848 --found-during 5849   # record a split fold as lane 5849's split child.
```

<!-- /usage -->

Read the issue and draft first. `--apply <N>` writes on `fold`; with `--blocked <M>` on `duplicate`, it records `<M>` blocked by `<N>` and reconciles its epic. With `--found-during <M>` on `fold`, it records `<N>` as lane `<M>`'s split child. Failure exits 1. Display writes nothing; `separate` returns to the ordinary filing path.

`content`, `has_complete_read`, `existing_body`, `comment_fingerprint`, `draft_body` and `verification` are required; an assessment without one exits 1. Omit other unknown facts: `inspect`.

The JSON also carries `comment_fingerprint`, as `--fingerprint <N>` prints it before the issue is read; `--apply` writes nothing when a comment was added, edited or deleted since.

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

### `josh issue:body`

<!-- usage: issue:body -->

Replace an issue's body with a file that passes issue:lint.

```bash
pnpm josh issue:body 6982 --body-file .josh/tmp/issue-6982-body.md
```

**Options:**

- `--body-file <path>` — the new body, from a file or stdin (`-`). A body `issue:lint` refuses is not written.

<!-- /usage -->

It prints the issue URL. `issue:plan` writes only a blank body; this replaces a non-blank one. An epic body (`## Split rationale`) skips `issue:lint`; check it with `epic:check`. A consultation session refuses every non-GET `gh api`, so a body rewrite goes through this command.

### `josh issue:plan`

<!-- usage: issue:plan -->

Record a plan: normalize the title, fill a blank body or comment, apply run:planned.

```bash
pnpm josh issue:plan 4134 --body-file .josh/tmp/plan.md --title "Add issue:plan" --planned   # kickoff's three writes
```

**Options:**

- `--body-file <path>` — the plan, from a file or stdin (`-`): a blank body takes it, else a comment.
- `--title <title>` — replace the issue title first.
- `--planned` — apply `run:planned` once the plan is posted, so the next entry skips planning; send the `planning` Telegram (change items, `Next:`).
- `--no-notify` — with `--planned`, skip the `planning` Telegram.
- `--repo <owner/name>` — write to that repository's issue.

<!-- /usage -->

A plan without `### 影響を受ける既存の利用者` (entries, or `なし（<reason>）`) is refused.

When a dispatched lane child plans its own issue, without `--repo`, the recorded plan then runs `lane:plan` on its backticked paths outside `### 影響を受ける既存の利用者`. It prints the command and the verdict, and exits with `lane:plan`'s code (`2` yield, `3` split). On `wait` (`1`), re-run the printed command, not `issue:plan`.

Run both with Bash `timeout` 600000: a bounded wait blocks up to 9 minutes (`docs/josh-commands-lane.md` → "`josh lane:plan`").

A plan naming no path prints `pnpm josh lane:plan <N> <path>...` for the child to finish (`scripts/lane/lane-plan-auto.ts`). Outside a lane child, `kickoff`'s plan records no lane plan.

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
- `--issue <n>` — the Issue a close pair reads for reuse (default: the held run).

<!-- /usage -->

Rows come from the npm registry. A top lead of 15%+ is `clear` (Tier A), else `close` (Tier B) unless the Issue decides to reuse existing code: posted there as `Auto-decided:`, Tier A. Else `Reuse check:` says why; a failed read, judgment or comment exits 1.

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

A `- 実施可能条件:` whose K is over 30 exits 1; its paste-ready line uses K = 10. In a body with `- 計測宣言:` or `- 計測宣言なし:`, a `- 実施可能日:` more than 7 days after now (the filing time) exits 1 with a date 7 days ahead, and one beside a `- 実施可能条件:` exits 1.

A non-epic body without a well-formed `- 規模見積もり: 約 <N> ファイル / <M> 行（テスト除く）` line under `## 背景` exits 1. An epic (a body with `## Split rationale`) declares none.

A `- 種別: 振る舞い変更` body also needs `## 発火点`, `## ベースライン` (a re-runnable `` `<command>` → <value> ``) and `## 再現` (a command with its actual output), plus `- 強制: <hook, lint or gate>` (or `- 強制: 計測のみ`) and `- 計測: <command and number>` under `## 背景` — a missing line or `なし` exits 1. [`josh measure:rerun`](josh-commands-automation.md#josh-measurererun) re-runs the baseline after merge.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:lint` in detail".

### `josh issue:spill`

<!-- usage: issue:spill -->

Move an issue's unchecked acceptance criteria into a follow-up filed by `issue:file --route split`, placed after it in its epic (or a new one), leaving one link line.

```bash
pnpm josh issue:spill 5999 --estimate "3 ファイル / 80 行"
```

**Options:**

- `--estimate "<F> ファイル / <L> 行"` — the follow-up's size estimate, never apportioned from the issue's. Required.
- `--distinct <N,…>` — duplicate candidates `issue:file` held the follow-up on, declared separate; the issue itself always is. Repeatable.

<!-- /usage -->

### `josh issue:release-class`

<!-- usage: issue:release-class -->

Write the issue body's one release classification line, replacing any earlier one.

```bash
pnpm josh issue:release-class 6636 other-change
```

<!-- /usage -->

Writes `- リリース分類: <label>` at the end of the `## 背景` declaration block, or the body's end without that section. Earlier declaration lines are dropped, so a repeat changes nothing. Only `enhancement` and `other-change` are accepted; a bug, breaking change or ignored release is declared by its label.

Run it when `josh ship` or `josh git` stops for a missing release classification. A lane with a non-defect Issue (`種別: 非不具合`) and no `enhancement`, `bug` or `breaking-change` label writes `other-change` as a Tier A choice and goes on without parking.

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

Print the work summary, completion report or lane child's summary skeleton in the session language: summary | done | child.

```bash
pnpm josh report:template summary scripts/report/report-lint.ts
pnpm josh report:template done
pnpm josh report:template child
```

<!-- /usage -->

It uses the label table `josh report:lint` checks, so it passes the lint in any language.

Each path fills the target or changed-file line and, for `summary`, a change block whose "if it breaks" tier opens with the abnormal cases `josh cases` owes for that path. `child` prints the cause / fix / result lines `report:lint --child-summary` checks and ignores paths. Any other kind prints the usage and exits 1.

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

`ambiguous` names each matching entry's commit hash; `pnpm josh stash:pop <hash>` pops that entry alone.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh stash:pop` in detail".

### `josh tree:status`

<!-- usage: tree:status -->

Bundle the working tree’s read-only pre-check: branch, status, stash list, run hold.

```bash
pnpm josh tree:status
```

<!-- /usage -->

Run it before acting on what the tree holds. It reads the hold record and never claims it (`run:hold` claims), and lists the stash without touching it. The first line is `tree — branch: … · changes: … · stash: … · hold: …`; the hold is `free`, `held`, `stale`, `unreadable` or `unknown`, and the last two exit 1.

## Epics and backlog

Track an epic's children and pick what an unattended run takes next.

### `josh epic`

<!-- usage: epic -->

Create an epic issue from its child issue numbers.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file .josh/tmp/rationale.md
pnpm josh epic --promote 858 101 102 103                                     # turn an existing issue into an epic
pnpm josh epic --add 893 894                                                 # track #894, declaring no order for it
pnpm josh epic --add 893 894 --before 891                                    # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890                                     # #894 starts once #890 is done
pnpm josh epic --add 893 894 --decision-file .josh/tmp/why.md                # …and record why, in one call
pnpm josh epic --reconcile 2184                                              # rewrite the body to match the recorded blocked-by, and record any order the body declared
pnpm josh epic --decide 893 894 --decision-file .josh/tmp/why.md
pnpm josh epic --untrack 893 894                                             # remove a child row and its connected orders
```

**Options:**

- `--ordered` — argument order is the dependency order; writes the arrow chain, records the matching `blocked-by` relations, and adds a `### Declared order` entry under `## Decisions`.
- `--rationale-file <path|->` — split rationale prose, written under `.josh/tmp/` (`-` reads stdin).
- `--origin <owner/repo#N>` — backlink when the split originated in another repository.
- `--notify` — on create or `--promote`: send the split path's `planning` Telegram (the epic URL, child URLs and `Next: pnpm josh backlogrun <E> --only`), as `issue:plan --planned` sends; a failed send only warns.
- `--title <title>` — with `--promote`: rename the issue first.
- `--before <M>` — with `--add`: insert before `#M`, re-pointing what `#M` was waiting on so the chain is never broken.
- `--after <M>` — with `--add`: start after `#M`; branches when `#M` already has a successor, extends when it is a tail.
- `--order-before <M>` / `--order-after <M>` — with `--add`: move the task-list row only; write no `blocked-by` relation.
- `--decision-file <path|->` — with `--add`: record why the child was placed, written under `.josh/tmp/` (`-` reads stdin).
- `--remove <E> <M> <N> [<N2> …]` — delete a declared order from the body and the relations; each consecutive pair is one link.
- `--untrack <E> <N...>` — remove child rows and connected orders without reconnecting survivors; relation failures preserve the body for retry; absent rows are safe to repeat.

<!-- /usage -->

It satisfies all four mechanical requirements by construction: `epic` label, task-list child rows, machine-readable `Dependencies`, an `Execution` run command.

`Execution` prints `pnpm josh backlogrun <E> --only`. A failed `blocked-by` write is reported as a count; the epic stays correct.

#### `josh epic --promote` — turn an existing issue into an epic

Appends the epic's sections to the issue's body, taking the same `--ordered` / `--rationale-file` / `--origin` options; `--title` renames it. Re-running is refused. Promote a request, discussion or container; when the issue is itself a deliverable, keep it as a child and create a new epic.

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

**Lanes:** free places are `JOSH_LANE_LIMIT` (default 8) minus `backlog_occupied`'s count; at zero, `wait` names holders on stderr. Lanes without a worker, paused or merge-waiting hold no place. Human-review stops retain their tree and hold. Launches also wait for shared-core memory.

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

It writes nothing without `--apply`, which writes every placing answer — `ask` into the `Recommended:` epic, recording the decision on the epic and the issue; [`josh issue:file`](#josh-issuefile) runs it on the issue it creates as its last filing step.

Only two things count as a signal: one issue naming the other in its acceptance criteria (`## 受け入れ条件` / `## Acceptance criteria`) or its `parent: #N` / `親: #N` line, or an already-recorded `blocked-by`. A reference in any other section, or a similar title, does not.

| Candidates                                     | What to do                              | Tier |
| ---------------------------------------------- | --------------------------------------- | ---- |
| The new issue itself already has an epic       | Nothing                                 | —    |
| Already a child of an epic                     | Add to that epic                        | A    |
| Spread across an epic and its own parent       | Add to the inner epic                   | A    |
| Spread across different epics                  | Add to the recommended epic, record why | A    |
| In no epic, two or more counting the new issue | Create an epic                          | A    |
| No strong signal / listing cut short           | Nothing                                 | —    |

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

Read-only. Uses **Ranking** below: priority, resumable work, verification-path defects, then blockers.
Ties use creation time ascending, then number ascending. Skips `epic`, `in-progress`, `needs-decision` and candidates whose `blockedBy` is open or whose `- 実施可能日:` (`YYYY-MM-DDTHH:MMZ`) has not arrived,
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

Read-only, except for the mechanical triage of the triage gate below. stdout is bare issue numbers to start, or `wait`, `stop`, `triage`, `retry`, `error` or `none`; empty with exit 1 if a listing could not be read. Explanations go to stderr.

**Triage gate**: an untriaged candidate (neither `run:solo` nor `run:lane`) without `bug`, or a `bug` naming no verification-gate path (`GATE_PATHS` in `scripts/backlog/backlog-auto-triage.ts`), gets `run:lane` and a comment naming the missing condition, and is offered as triaged.

Any other untriaged candidate is held alone, named on stderr. The triaged candidates pass the `run:solo` gate without it and print as usual, then a trailing `triage` line asks for the judgment; with none of them left to offer, it prints `triage` alone. A judgment recording `run:solo` stops the next offer by that gate.

**Defect priority**: defects always go to the front of the runnable numbers among ranking ties. New mechanisms go to the back only while the defect rate is above its baseline.

**Ranking**: `- 実施順: 最後` goes last; otherwise `priority:critical`, `priority:high`, resumable work (owned stash, pause comment or linked open PR), verification-path defect, lost minutes, transitive dependents, estimated lines (smallest first, undeclared last), then weekly gain (`## 期待効果`). Standalone numbers are cut to five.
Lost minutes sum `- 原因の損失:` lines, falling back to `- 原因のレーン:`.

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
**Waiting on a person** (parked children — `needs-decision`, `run:stalled` or `already-done` — each naming its label), **Out of scope** (every open issue the backlog will not run, with the reason). The title, headings and row notes print in the session language (`JOSH_SESSION_LANG`, `ja` else English); `--waves` and the out-of-scope reasons stay English.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:plan` in detail".

### `josh backlog:triage`

<!-- usage: backlog:triage -->

Run a parent triage pass, decide solo/lane from three conditions, or apply one issue's verdict.

```bash
pnpm josh backlog:triage --pass
pnpm josh backlog:triage --decide --defect yes --verification yes --every-run no
pnpm josh backlog:triage --apply 912 --lane --reason "<why>"
pnpm josh backlog:triage --apply 913 --solo --defect yes --verification yes --every-run yes --reason "<why>" --clear
pnpm josh backlog:triage --apply 914 --blocked-by 912 --reason "<why>"
pnpm josh backlog:triage --apply 914 --unblock 912 --reason "<why>"
pnpm josh backlog:triage --apply 915 --adopt 1 --reason "<why>"
```

**Options:**

- `--pass [--exclude <N>]` — settles mechanical lane candidates and prints one next command; exclude decisions kept parked. Each park's recommendation and tier go to stderr, with its `--adopt` command unless no pick or a tier C pick. Failed or incomplete reads exit 1.
- `--decide --defect <answer> --verification <answer> --every-run <answer>` — yes/no/unknown evidence: three yes → run:solo; any no → run:lane; otherwise judge. Read-only.
- `--apply <N> --lane|--solo --reason <text>` — comments the reason, then applies the run label (`auto-ok:judge --apply`).
- `--clear` — clears the park (`run:park <N> --clear`) only when the issue answers its decision question.
- `--blocked-by <M>` — records the native `blocked-by` relation on `#M` before the comment and the run label, declared in the epic tracking `#N` as `run:pause` does; it stands in for the run label or goes with it.
- `--unblock <M>` — removes it instead, with the tracking epic's `#M -> #N` declaration (`epic --remove`'s path); `--blocked-by` restores it. A failed write is named, exit 1.
- `--adopt <k>` — takes option `<k>` of the child's latest park in one call: records the decision in its one tracking epic (`epic --decide`'s path), clears the park, then `run:add <N> --retry`. A park with no recommendation, an unlisted or tier C option, no single tracking epic, or no backlogrun running here is refused before any write.

<!-- /usage -->

The parent follows `--pass`'s stdout command; diagnostics go to stderr. Apply prints
`triage #N — <label> · blocked by #M`; without `--clear`, the park stays.

The pass reads local `needs-decision`, `run:stalled` and remaining judgments once per issue.
Foreign-repository and excluded children are not read. With none left it prints `backlog:plan --waves`.

`--adopt` reads the latest trusted park comment on `run:park`'s schema; any listed option but tier C
is adoptable. Recovery guidance prints only when a read is due.

Run the pass at the initial plan and after each collection batch that parked a child. The driver
hands back `triage` once per such batch before its next offer; a batch without parks adds no step,
nor does a resume. Read each parked child's body and comments, then route:

- A park's recommendation: `pnpm josh backlog:triage --apply <N> --adopt <k> --reason "<why>"`;
  no tracking epic: comment, `run:park <N> --clear`, `run:add <N> --retry`.
- A Tier A answer outside a park: `pnpm josh epic --decide <E> <N...> --decision-file <path>`.
- Recovered API, rate-limit or authentication outage: `pnpm josh run:add <N> --retry`.
- Dependency: `pnpm josh backlog:triage --apply <N> --blocked-by <M> --reason "<why>" --clear`.
- No recommendation, a tier C option, or a measurement: keep it parked and excluded for this pass; it stays on the board's
  human-waiting list.

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

Read-only. stdout is `run`, `watch`, `stop` or `triage`; empty with exit 1 if unreadable. An idle watch polls every 180 s.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:budget` in detail".

### `josh backlog:offer`

<!-- usage: backlog:offer -->

Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start.

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

<!-- /usage -->

This section is the single source of the mapping from `backlog:next`'s answer to a budget word:

- issue numbers → `candidates`, with a trailing `triage` line → `candidates` that owe the judgment (`is_judgment_owed` in `--json`); `none` → `exhausted`; `stop` → `parked`; `triage` alone → `untriaged`
- `wait` → `blocked` with children in flight, `exhausted` without
- `retry` → `blocked` below three consecutive asks, `unreadable` at the third
- `error`, or exit 1 with empty stdout → `unreadable`, never `none`

`--exclude` / `--repo` forward to `backlog:next`; the budget flags to `backlog:budget`. stdout is the verdict, then on `run` the issue numbers; the retry count is the last stderr line.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the event stream (once per drain, best-effort), so the next `run:step` fires the retrospective before the idle watch. A watch opened while children still merge is unmarked.

Before a fresh marker it runs `main:sync` and `observations:flush` in the primary checkout (git effect); a failure prints one `observations:flush skipped:` line and the offer goes on.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:offer` in detail".

### `josh backlog:drive`

<!-- usage: backlog:drive -->

Drive backlogrun through offer, launch and merge; restore this run’s lanes and report when complete.

```bash
pnpm josh backlog:drive [--max <n>] [--idle <minutes>] [--only]
```

<!-- /usage -->

An open carry record supplies the start time, merged count and named issues. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `judge`, `watch`, `triage`, `retrospective` or `window`) or `stop <reason>`; the second carries resume flags. A `run` that owes a judgment opens its lanes first, then hands `triage` back in the same pass.

A drained `stop` that owes the retrospective starts one retrospective unit, a headless model child, and waits for it to exit; the board's now line reads `🔍 retrospective` meanwhile. The unit closes under the driver's `--owner`.

A record the unit marked done lets the `stop` end the run; an unmarked record, at any exit code, hands `retrospective` back.

The supervisor claims the record for the session it wakes; the session acts and ends its turn; its `Stop` hook writes the cut that hands the loop back.

A pass launches every free lane it seats side by side. A refused launch is answered after the others settle, which stay in flight; only one launch at a time holds the `josh latest` stash. The driver parks the refused issue with `run:stalled` (park event `launch <outcome>`) before it hands back `launch #N`; `run:add <N> --retry` offers it again.

A measurement declaration with no sample yet waits, not a lane (`sample condition not met`).

Merged causes use guarded `run:add --retry` for dependents; each offer, for cleared `followup` parks.

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
pnpm josh review:brief --full-change         # final round 2 over the whole change
pnpm josh review:brief --interaction         # the interaction review of a run-tooling change
pnpm josh review:brief --level-only          # the level alone (pre-commit review)
pnpm josh review:brief --level-only --json   # level and reason, machine-readable
```

**Options:**

- `--full-change` — final round 2 over the whole change (no `--round` or `--interaction`).
- `--round 2` — target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).
- `--level-only` — print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.
- `--staged` / `--json` — the staged diff; machine-readable level and reason.

<!-- /usage -->

Pass output to `/code-review` with its reviewer model and effort; line one is the level. If scoped checks are not green on this tree, run `pnpm josh lint:related && pnpm josh test:related` and reissue.

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

### `josh review:selfcheck`

<!-- usage: review:selfcheck -->

Answer the pre-commit self-check questions 2, 4 and 10 — stale prose, untouched readers, new command examples run — in one command.

```bash
pnpm josh review:selfcheck                          # → `file:line` per finding, then one `selfcheck: pass|fail` line (exit 0 / 1; 2 on a failure)
pnpm josh review:selfcheck --interaction-answered   # → a passing, due run also records the issue's interaction round
```

<!-- /usage -->

Self-check questions 2, 4 and 10 (`prompts/review.md`) as one run. Question 4 lists readers to read and never fails it; where the interaction review is due, it also prints that pass's three questions over the due paths.

### `josh diff:summary`

<!-- usage: diff:summary -->

Print the diff from the change base as one table — lines, hunks, ranges and declarations per file — and save it whole.

```bash
pnpm josh diff:summary        # → one row per file, then `full output: <path>` (the diff, in the git directory)
pnpm josh diff:summary HEAD   # → the same, against a named base
```

<!-- /usage -->

From `<base>` (default: the change base) to the working tree, tracked files only — `git add -N` a new file to list it. Ranges are new-side lines; declarations are the top-level ones a hunk sits under or a changed line writes.

The diff is saved in the worktree's git directory, so `git status` never lists it. No change prints one line, not a table. Exits 2 when the base or the diff could not be read.

### `josh disposition`

<!-- usage: disposition -->

Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime).

```bash
pnpm josh disposition <path...>                 # → runtime | non-runtime
pnpm josh disposition --batch <findings-file>   # → branch table + drop notes
```

<!-- /usage -->

`runtime` means any non-inert path, per `review-level.ts`'s inert set; only "is the defect confirmed" is left to a person. Reason on stderr. Full reasoning: `prompts/review.md` → "Three-way disposition after the cap".

`--batch` reads one `review:record` positional per line — the findings not fixed in place — prefixed `confirmed ` when the failure scenario is stated. It prints a row per finding with its branch (`file` for a confirmed runtime finding, else `drop`).

Each dropped finding's PR-body note follows, itself a `review:record` positional. A line outside the grammar exits 1, named.

With `--found-during <N>`, each `file` finding gets an `issue:lint`-clean body at `.josh/tmp/review-cap-<N>-<k>.md` and a printed `pnpm josh issue:file … --route review-cap --label run:lane --found-during <N>` line; nothing is filed. A `file` finding without `--found-during` exits 1.

The body is declared non-bug: the origin pull request is not traced yet. Reclassify it once traced.

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
