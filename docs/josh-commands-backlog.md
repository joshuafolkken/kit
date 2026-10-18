# josh CLI — Issue, Epic, Backlog and Review Command Reference

The commands the issue-driven workflow calls to read and file issues, track epics, pick and plan a backlog, brief and attest a review, and decide what a run delegates. Where each command came from: `docs/maintainers/josh-commands-backlog-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated from `scripts/josh/josh-usage-issue.ts`, `scripts/josh/josh-usage-backlog.ts` and `scripts/josh/josh-usage-review.ts` by `tsx scripts/document/generate-command-usage.ts` — edit the table, not the span.

## Issues

Read, file, fold and cite issues, and lint what is written into them.

### `josh issue:read`

Print each issue's title, state, body and every comment in one call, replacing separate `gh api` body and comments reads.

<!-- usage: issue:read -->

```bash
pnpm josh issue:read 1715
pnpm josh issue:read 1715 1567 1605   # several numbers, read concurrently
```

<!-- /usage -->

Attribute each block by its `issue:` line, never by position. Output past the Bash cap is written as part files under it, and only their paths are printed — read every part with the Read tool in one turn. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any number went unanswered. Any non-numeric token refuses the whole call.

### `josh issue:ack`

Record that the run has read a person's update to its issue, printing the update it acknowledges.

<!-- usage: issue:ack -->

```bash
pnpm josh issue:ack 3773
```

<!-- /usage -->

`josh run:entry` records the issue as the run's baseline; the PreToolUse hook then shows a person's body edit or new comment once, and `issue:ack` makes that read the new baseline.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:ack` in detail".

### `josh issue:state`

Print each issue's state, labels and whether a run must stop on it, in the spelling the workflow documents compare against.

<!-- usage: issue:state -->

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read a child in another repository; applies to every number.

<!-- /usage -->

State is `OPEN` / `CLOSED` / `MERGED`. `human_review:` answers whether the issue carries `needs-human-review`, matched case-insensitively. Output past the Bash cap is written as part files under it, as `issue:read` does. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered.

### `josh issue:release`

Make an existing issue a blocker of its repository's release issue — the one-issue form of `josh issue:file --release`, for an issue a consumer can use only once it is published.

<!-- usage: issue:release -->

```bash
pnpm josh issue:release 3360
pnpm josh issue:release 3716 --wait   # blocked by the release issue instead
```

**Options:**

- `--wait` — the issue is blocked by the release issue instead, so `backlog:next` offers it again once the release ships (`.claude/skills/workflow-commands/prerequisite.md`).

<!-- /usage -->

1. List the repository's open issues labelled `release`. An unreadable listing files nothing and exits 1, so the blockers are never split across two release issues.
2. When none is open, file `Release <owner/repo> (next version)` with the `release` label. It never gets `auto-ok` on its own — `issue:file` refuses `auto-ok` for the `release` label on every path — so the release stays a person's call; a person may still add `auto-ok`.
3. Record the issue as a `blocked_by` blocker of the release issue and print `release: #<R> (open|filed) is blocked by #<N>`. A failed link exits 1.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:release` in detail".

### `josh issue:scout`

Before an issue is filed, answer the two questions every filing asks: has this already been filed, and which epic does it belong to. [`josh issue:file`](#josh-issuefile) runs this scan as a filing step and holds the filing until every candidate is named in `--distinct`.

<!-- usage: issue:scout -->

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"
pnpm josh issue:scout "<title>" --body "parent: #1246"
pnpm josh issue:scout "<title>" --body-file draft.md
```

**Options:**

- `--body "<text>"` — supply references (`#N`) in a `parent: #N` line or an acceptance-criteria section so the epic half has a number to work from; without one there (a background mention does not count) it prints `Epic: not asked`.
- `--body-file <path>` — pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".

<!-- /usage -->

The duplicate half scores titles by token overlap; a candidate needs ≥2 significant shared words and similarity ≥0.35. An issue the body references explicitly is a candidate too, even when its title is not similar. An incomplete search prints `Duplicates: incomplete`. The epic half is [`josh epic:bundle`](#josh-epicbundle)'s decision, and does not replace it.

### `josh issue:file`

The one path for filing an issue. It runs every filing step, in order. A direct filing through `gh api …/issues` or `gh issue create` is refused every time by the `direct-filing` guard, which points to this command.

<!-- usage: issue:file -->

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
- `--over-cap` — the run is blocked by this filing; the cap lets it through.
- `--no-auto-ok` — needs a person's judgement (Tier B / C); no `auto-ok`.
- `--release` — a consumer can use the change only once it is published. The filed issue becomes a blocker of the target's release issue (step 10).

<!-- /usage -->

**Steps (run in this order):**

1. Refuse when the target is third-party (Tier C).
2. Check the body against the same criteria as [`josh issue:lint`](#josh-issuelint), and for exactly one `- 人の判断: 不要` / `- 人の判断: 要` line under `## 背景`. Refuse on any problem.
3. For another repository, confirm `## Origin` names the originating issue (`owner/repo#N` or a URL). Refuse when it does not.
4. Print the `auto-ok` decision: the body's `- 人の判断: 不要` applies it and `- 人の判断: 要` does not; some labels and `--no-auto-ok` withhold it. An opted-in issue with neither `run:lane` nor `run:solo` is refused.
5. On a finder's second filing into the same repository, ask the [`josh issue:fold`](#josh-issuefold) question; only `fold` refuses, and `--distinct <N>` declares a separate deliverable. A split child (`--route split`) asks nothing.
6. Count the target's open issues and print `wip: <count> open in <owner/repo> · cap <cap> · <verdict>`: `within` up to the cap; past it `exempt` (route `interrupt` / `split` / `tier-a`, or `--over-cap`), else `held`, which asks the exemption question and refuses; an unreadable count warns.
7. Run the same duplicate search as [`josh issue:scout`](#josh-issuescout) and print its report. While there are candidates, file nothing until every one is named in `--distinct`. A duplicate is not filed; it is folded into the existing issue by `issue-fold-existing.md`. A filing to another repository points `GH_REPO` at the target, so the duplicate search and the epic decision run there.
8. Create any missing workflow label with its color and description — the same set as [`josh sync`](josh-commands.md#josh-sync). A label that cannot be created is printed with a warning, and the filing goes on.
9. File with all labels in one request; print the URL.
10. With `--release`, link the filed issue to the target's release issue, as [`josh issue:release`](#josh-issuerelease) does. A link that does not complete prints `⚠` with that command to re-run, prefixed with `GH_REPO=<target>` so a `--repo` filing is linked in the target rather than the current repository.
11. Run [`josh epic:bundle`](#josh-epicbundle) on the filed issue. When it gives no answer, print `⚠` with the command to re-run. The issue already exists, so the exit code stays 0.

A refusal in steps 1–7 files nothing and exits 1. The per-run filing cap (`filing-cap`) applies to calls of this command; a refused call is not counted. The WIP cap and the fold question are this command's own steps, so no delivered rule refuses the call ahead of them.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:file` in detail".

### `josh issue:fold-existing`

After the existing issue and the draft have been read — bodies, comments, state, pull requests and dependencies — return `duplicate` / `fold` / `separate` / `inspect` from that assessment record. It only decides; it never updates the issue.

<!-- usage: issue:fold-existing -->

```bash
pnpm josh issue:fold-existing assessment.json --json
```

<!-- /usage -->

The JSON carries the assessment facts (`content`, `is_open`, `size_verdict`, `existing_body`, `draft_body`, …); an unknown fact answers `inspect`. `separate` returns to the ordinary filing path.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:fold-existing` in detail".

### `josh issue:fold`

Before a run files a **second** finding in one session, answer whether the findings fold into one issue or stay separate — the filing-time counterpart to the split assessment, reading its same two questions (separability, and whether the whole clearly exceeds one verification gate).

<!-- usage: issue:fold -->

```bash
pnpm josh issue:fold "First finding" "Second finding"   # fold | separate | no-fold-needed | undetermined
pnpm josh issue:fold "a" "b" --not-separable            # the pair is really one deliverable → fold
pnpm josh issue:fold "a" "b" --json                     # the verdict and reason, machine-readable
```

**Options:**

- `--not-separable` — declare the judgement half: the findings are one deliverable, so they fold whatever their size.
- `--json` — print the verdict and reason as JSON.

<!-- /usage -->

The size half is [`josh split:assess`](#josh-splitassess)'s verdict; `separate` needs separable **and** over the guide, and an unreadable diff answers `undetermined`. [`josh issue:file`](#josh-issuefile) asks this itself on a run's second filing.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:fold` in detail".

### `josh issue:cite`

Print the paste-ready number-link citation line for each issue in one call, so the correct session-facing form — `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <summary>` — costs one command rather than a title read per issue. The summary is the issue's own title, fetched; adapt it to the session language when it matters.

<!-- usage: issue:cite -->

```bash
pnpm josh issue:cite 2220
pnpm josh issue:cite 2220 1758 1252                    # several numbers, read concurrently
pnpm josh issue:cite 45 --repo joshuafolkken/app-kit   # bare numbers in another repository
pnpm josh issue:cite joshuafolkken/app-kit#45 2220     # per-token owner/repo#N notation
```

**Options:**

- `--repo <owner/repo>` — the repository for every bare number; a token written `owner/repo#N` overrides it for itself.

<!-- /usage -->

Citation lines go to stdout so the block stays paste-ready; a number that resolves to nothing or a read that failed is named on stderr rather than dropped, and any failure sets a non-zero exit. Any non-numeric token refuses the whole call. The [`Stop` hook's citation notice](../prompts/collaboration-workflow/issue-citation.md) points at this command with the numbers it detected already filled in.

### `josh issue:comment`

Post one comment to an issue (or a PR) with the body passed by path, and print the comment URL — no raw `gh api … body=@<path>` to get wrong.

<!-- usage: issue:comment -->

```bash
pnpm josh issue:comment 2304 --body-file .josh/tmp/park.md   # the body from a file — no shell evaluates it
pnpm josh issue:comment 2304 --body "a short note"           # inline, for a body with no backticks or $
```

**Options:**

- `--body <text>` — the comment body, inline. Trimmed, with `\n` expanded to a newline.
- `--body-file <path>` — read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.

<!-- /usage -->

The body travels through [`cli-body.ts`](../scripts/josh/cli-body.ts), shared with `notify` / `followup`, so no shell evaluates it; `--body` and `--body-file` at once is refused rather than ranked. `pnpm josh rule:guard` refuses the `-f body=@…` misfire before it runs (the `raw-field-body` row), so the literal `@<path>` cannot reach GitHub.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:comment` in detail".

### `josh issue:already-done`

The exit for an Issue whose work is already merged (`issue-comments.md` → "When the work turns out to be already merged"): post the evidence comment, apply `already-done`, then `run:release <N>`, stopping at the first step that fails. An empty evidence file is refused before anything is written. The Issue is never closed.

<!-- usage: issue:already-done -->

```bash
pnpm josh issue:already-done 4130 --evidence-file .josh/tmp/already-done.md   # comment, label, release — in that order
```

**Options:**

- `--evidence-file <path>` — the evidence comment: the merging PR or commit and, per acceptance criterion, its `file:line`. An empty file is refused before anything is written.

<!-- /usage -->

### `josh pkg:scout`

Before the Package-First tier decision, rank candidate packages by measured metrics so Tier A ("clearly best") and Tier B ("genuine toss-up") are read off the output rather than judged. It queries the npm registry and prints one line per candidate: npm score, weekly downloads, last publish, bundled-types mark, license and unpacked install size.

<!-- usage: pkg:scout -->

```bash
pnpm josh pkg:scout "date formatting" --size 5
```

**Options:**

- `--size <n>` — how many candidates to fetch and rank (default 10).

<!-- /usage -->

The verdict reads the top two's relative lead `(top − second) / top`: `clear` when the leader is ahead by at least 15% (select it, Tier A), `close` when within it (ask the user, Tier B). A failed per-candidate read leaves that metric blank (`—`).

### `josh issue:lint`

Check an issue body file against the template's four required headings — `## 背景`, `## 現象`, `## 期待結果`, `## 受け入れ条件` — and its bug classification (source: `prompts/collaboration-workflow/issue-template.md`). Run this before filing.

<!-- usage: issue:lint -->

```bash
pnpm josh issue:lint .josh/tmp/issue-body.md
```

<!-- /usage -->

Prints `ok` and the labels to apply when the headings and one `- 種別:` declaration are present; a missing or conflicting declaration exits 1. [`josh issue:file`](#josh-issuefile) runs it as a filing step.

A `- 種別: 振る舞い変更` body also needs `## 発火点`, `## ベースライン` (a re-runnable `` `<command>` → <value> ``) and `## 再現` (a command with its actual output). [`josh measure:rerun`](josh-commands-automation.md#josh-measurererun) re-runs the baseline after merge.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:lint` in detail".

### `josh defect:rate`

Print the defect rate of merged work over a window — the number that says whether to add a new mechanism or stabilize.

<!-- usage: defect:rate -->

```bash
pnpm josh defect:rate             # the last 14 days
pnpm josh defect:rate --days 30
```

**Options:**

- `--days <n>` — the window in whole days (default 14, at most 3650). Anything else prints the usage and exits 1.

<!-- /usage -->

**Behavior:** defects filed in the window over enhancements completed in it; `n/a` with no completed enhancement. An unreadable search exits 1. `backlog:next` uses the rate to prioritize defects.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh defect:rate` in detail".

### `josh issue:backlinks`

Classify an origin issue's upstream backlinks into one fixed word. The backlink headings (`## Origin` / `## Upstream issues` / `## Upstream candidate`, single-sourced in `prompts/collaboration-workflow/issue-template.md`) were fixed so a grep could find them; this is that grep. It reads issue N, then the bodies of every upstream it lists, and checks the pair points both ways.

<!-- usage: issue:backlinks -->

```bash
pnpm josh issue:backlinks 2123
```

<!-- /usage -->

**Verdicts:** `ok` (exit 0) when `## Upstream issues` and each upstream's `## Origin` cite each other; otherwise `missing-upstream`, `missing-origin` or `wrong-heading`, exit 1.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh issue:backlinks` in detail".

### `josh report:lint`

Check a two-layer work summary (`CLAUDE.md` Step 0, single-sourced in `prompts/collaboration-workflow/report-format.md`) on stdin against the half a machine can enforce: the labels are present, no overview line runs over its character ceiling, nothing wraps the summary in a code fence, and no file path or CLI flag leaks into the overview.

<!-- usage: report:lint -->

```bash
pnpm josh report:lint < summary.md
```

<!-- /usage -->

Prints `ok` (exit 0), or the violations one per line followed by one line naming the template's section in `report-format.md` (exit 1). The judgement half — whether the overview names a concrete subject — is left to the writer, because a machine cannot answer it.

### `josh stash:pop`

Pop the stash whose message matches, and no other — never whatever entry another lane left on top of the shared stack.

<!-- usage: stash:pop -->

```bash
pnpm josh stash:pop "backlogrun: parked #2028"
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir"   # into a lane's work tree
```

**Options:**

- `--dir <path>` — applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.

<!-- /usage -->

**Verdicts:** `popped` and `conflicted` (exit 0), `no-match` and `ambiguous` (exit 1). A pop that applies but leaves conflicts is `conflicted` — the stash is on the tree, resolve the conflicts and continue. A message matching no stash, or more than one, is refused rather than guessed at — pass a message that identifies exactly one entry.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh stash:pop` in detail".

## Epics and backlog

Track an epic's children and pick what an unattended run takes next.

### `josh epic`

Create the epic issue that tracks a batch of child issues from one split. Satisfies all four mechanical requirements (`epic` label, task-list child rows, machine-readable `Dependencies`, an `Execution` run command) by construction.

<!-- usage: epic -->

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

The `Execution` section prints `backlogrun #<E> --only`. A `blocked-by` write that fails is reported as a count while the epic and task list stay correct.

#### `josh epic --promote` — turn an existing issue into an epic

Appends the epic's sections to the existing issue instead of replacing its body, so discussion and epic stay on one issue. Otherwise matches `josh epic`, taking the same `--ordered` / `--rationale-file` / `--origin` options. Re-running is refused. Promote a request, discussion or container; when the issue is itself a deliverable, keep it as a child and create a new epic.

#### `josh epic --add` — insert children into an existing epic

Writes all three places an epic's order lives — the task list, the `## Dependencies` arrow declaration, and the native `blocked-by` relations — from one input, so they cannot disagree.

Nothing is written unless all three places will agree. `#M` must be a child of the epic; a position naming an issue being placed, or a hub the declaration cannot position within, is refused without writing. A cross-repository target is refused with the bare-number command to run instead.

#### `josh epic --reconcile` — bring the declaration and the recorded relations back into agreement

When the `## Dependencies` declaration and the `blocked-by` relations disagree, `--reconcile` makes the declaration state exactly what is recorded, with no judgement.

- It **writes no `## Decisions`** — synchronizing a copy is not a decision, so nothing is recorded on the epic or its children.
- When the two already agree it writes nothing and prints `nothing to reconcile`.
- A circular union of declared and recorded orders is refused without writing; there is nothing to reconcile a cycle to.
- On success it states that `epic:audit` and `backlog:next` now agree on the epic's order.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh epic --reconcile` — bring the declaration and the recorded relations back into agreement in detail".

### `josh epic:next`

List an epic's runnable children, bundled per repository. All state lives on GitHub, so asking again after any interruption gives the same answer.

<!-- usage: epic:next -->

```bash
pnpm josh epic:next 858
pnpm josh epic:next 858 --repo joshuafolkken/kit           # just the next child for one repository
pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes   # one child per free lane there
```

**Options:**

- `--repo <owner/repo>` — answer for one repository; stdout carries one token (an issue number, or `wait`/`stop`/`complete`), everything else on stderr.
- `--lanes` — print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 4. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in `josh backlog:next`).

<!-- /usage -->

With `--repo`, the occupancy line names each `in-progress` holder with its label age read from the issue timeline — `in-progress for <n> min`, marked `stale` past 90 minutes or when the label predates the timeline, `label age unread` when the timeline could not be read.

Several leading epic arguments merge into one candidate pool per repository. A cross-repository dependency resolves only when the blocker is closed **and** its declared version has published. `run`/`wait`/`stop`/`complete` exit `0`; an unusable graph (cycle, or body/relations disagreement) exits `1`.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog. It finds candidates and recommends; it writes nothing. [`josh issue:file`](#josh-issuefile) runs it on the issue it creates as its last filing step.

<!-- usage: epic:bundle -->

```bash
pnpm josh epic:bundle 874
```

<!-- /usage -->

Only two things count as a signal: one issue naming the other in its acceptance criteria (`## 受け入れ条件` / `## Acceptance criteria`) or its `parent: #N` / `親: #N` line, or an already-recorded `blocked-by`. A reference in any other section, or a similar title, never counts.

| Candidates                                     | What to do                                          | Tier |
| ---------------------------------------------- | --------------------------------------------------- | ---- |
| The new issue itself already has an epic       | Nothing                                             | —    |
| Already a child of an epic                     | Add to that epic                                    | A    |
| Spread across an epic and its own parent       | Add to the inner epic                               | A    |
| Spread across different epics                  | Choose the one you recommend, add to it, record why | A    |
| In no epic, two or more counting the new issue | Create an epic                                      | A    |
| No strong signal / listing cut short           | Nothing                                             | —    |

Prints an `Order:` line with an `Evidence:` block, or `Order: none declared — do not invent one`. Exit is `0` for a verdict, non-zero only when a listing could not be read. A cut epic listing withholds every placing verdict.

### `josh epic:audit`

Read an epic's children against each other and report what contradicts what — where `epic:check` verifies one epic's format, this reads inside the children.

<!-- usage: epic:audit -->

```bash
pnpm josh epic:audit 858
```

<!-- /usage -->

| Check                | Level     | What it means                                                                                                  |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| Implicit dependency  | warning   | A child's body names another child, and nothing orders the two.                                                |
| Order contradiction  | **error** | Acceptance criteria name another child with nothing ordering them (warning once either closes, or cross-repo). |
| Unresolved reference | warning   | A body cites an issue that does not exist or is already closed.                                                |
| Nested epic          | warning   | A task-list row points at another epic.                                                                        |
| Orphan child         | warning   | An issue names this epic as parent but the task list does not track it.                                        |
| Orphan search        | **error** | The open-backlog search could not be read — re-run the audit.                                                  |
| Unjustified order    | **error** | The body declares an order between two open children and nothing records why.                                  |

Only errors change the exit code. Run it at the start of a `backlogrun` epic run and after a child or dependency changes. Fixing what it finds is Tier A; park with `needs-decision` only when the contradiction is an unmade design choice.

### `josh epic:check`

Check an existing epic against the same four requirements and report each as pass or fail. Use on hand-made epics, epics predating `josh epic`, and after editing an epic body.

<!-- usage: epic:check -->

```bash
pnpm josh epic:check 700
```

<!-- /usage -->

**Output / exit codes:** exits `0` when every requirement is satisfied, `1` otherwise, so it works as a gate. The dependencies check wants exactly one of the two machine-readable forms — neither present is ambiguous, both present is a contradiction.

### `josh auto-ok:next`

Print the next opted-in standalone issue an unattended run may pick up outside an epic. Read-only; ranks `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then issues other open issues wait on, then newest-first, skipping `epic`, `in-progress`, `needs-decision` and any candidate whose `blockedBy` is still open.
A candidate whose `- 実施可能日:` (`YYYY-MM-DDTHH:MMZ`) has not arrived is skipped too; `backlog:next` prints `#N not before <time>`.

<!-- usage: auto-ok:next -->

```bash
pnpm josh auto-ok:next
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
```

**Options:**

- `--exclude <N>` — drop issues from the answer; comma-separated, repeatable.

<!-- /usage -->

`josh start` creates the `auto-ok` label, and `josh sync` adds it to a repository that lacks it.

stdout is one token — the issue number, or `none`, or empty with exit 1 if the listing could not be read; explanations to stderr.

### `josh auto-ok:judge`

List the open issues a `backlogrun` still owes an `auto-ok` judgement, or record one. `backlog:drive` hands back `judge` when its watch finds the opted-in pool exhausted, a lane free and at least one such issue.

<!-- usage: auto-ok:judge -->

```bash
pnpm josh auto-ok:judge                                  # the issues that still owe a judgement
pnpm josh auto-ok:judge --apply 912 --lane               # opt it in, with its run label
pnpm josh auto-ok:judge --decline 913 --reason "<why>"   # record why it stays out
```

**Options:**

- `--apply <N> --lane|--solo` — checks the exclusions again against the labels as they stand, applies the run label and then `auto-ok`, and notes it on the progress board.
- `--decline <N> --reason <text>` — applies nothing.

<!-- /usage -->

A candidate is an open issue without `auto-ok` that carries none of the labels [`josh issue:file`](#josh-issuefile) refuses `auto-ok` on. Whether it needs a policy decision, an external account or a person's visual check is read from its body and comments by the agent, never by this command.

Bare, it prints one number per line on stdout, or `none`, with each title on stderr; exit 1 if the listing could not be read.

Both answers post a judgement comment carrying a digest of the body. An issue is listed again only once its body changes or a person comments after that comment.

### `josh backlog:next`

Order the whole opted-in backlog in one command — standalone `auto-ok` issues plus the descendants of every epic whose root carries `auto-ok`, followed transitively through nested epics. Read-only. Tokens are bare numbers scoped to the repository.

<!-- usage: backlog:next -->

```bash
pnpm josh backlog:next
pnpm josh backlog:next --exclude 1630   # skip the issue just merged
```

**Options:**

- `--exclude <N>` — drop issues from every bucket; comma-separated, repeatable.

<!-- /usage -->

stdout is one token per line: issue numbers a run may start, or `wait`, `stop`, `triage`, `retry`, `error` or `none`; empty with exit 1 if a listing could not be read. Explanations go to stderr.

**Triage gate**: while any candidate carries neither `run:solo` nor `run:lane`, it prints `triage` and no numbers, naming the untriaged issues on stderr.

**Defect priority**: while `defect:rate` is above its baseline, defects move to the front of the runnable numbers and new mechanisms to the back.

**Ranking**: `priority:high` first, then a verification-path defect, then the number of issues it blocks; standalone numbers are cut to five.

**`run:solo` gate**: a `run:solo` issue runs alone — `wait` while it or other lanes run, and a `run:solo` candidate further down cuts the list.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:next` in detail".

### `josh backlog:plan`

The whole backlog rendered as a plan a person reads before a run starts — four sections on stdout, using `backlog:next`'s own classification. Separate because that command's stdout is bare tokens a loop branches on.

<!-- usage: backlog:plan -->

```bash
pnpm josh backlog:plan
pnpm josh backlog:plan --exclude 1630   # after #1630 merged
pnpm josh backlog:plan --waves          # the run order, wave by wave
```

**Options:**

- `--exclude <N>` — same exclusion as `backlog:next`.
- `--waves` — print the order the run takes, wave by wave, assuming each wave merges before the next. Read-only.

<!-- /usage -->

```text
Wave 1  #2770 [run:solo]
Wave 2  #2765 [run:solo]
Wave 3  #2774 #2766 #2769   (parallel)
```

Sections: **Ready now** (runnable children, grouped by repository = the parallelism; a `run:solo` row is marked `[run:solo]`, a row with neither `run:solo` nor `run:lane` `[untriaged]`), **Waiting** (each withheld child naming what it waits on),
**Waiting on a person** (parked children — `needs-decision`, `run:stalled` or `already-done` — each row naming its label), **Out of scope** (every open issue the backlog will not run, with the reason).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:plan` in detail".

### `josh backlog:stalled`

Report whether ready backlog work is sitting undispatched while a lane is free and nothing has dispatched for a while — the state where a run is alive but not advancing and nobody notices until a person asks. Reads three facts, weighs none: a runnable count from `backlog:next`, the free-lane count, and the age of the last `child-launch` event on the run's stream.

<!-- usage: backlog:stalled -->

```bash
pnpm josh backlog:stalled
```

<!-- /usage -->

stdout is one verdict word, always exit 0: `stalled`, `unreadable` or `ok`. A stall leaves one marker on the event stream and sends no Telegram — the idle notification of `backlog:drive` is the one that reaches a person; the Stop hook runs it.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:stalled` in detail".

### `josh backlog:budget`

Say whether a `backlogrun` may start more work, keep watching, or finish. Read-only. Maps `backlog:next`'s answer into a budget verdict.

<!-- usage: backlog:budget -->

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

stdout is the verdict word: `run`, `watch`, `stop` or `triage`; empty with exit 1 if the invocation is unreadable. An idle watch lasts 8 hours from `--active`, polling every 60 s.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:budget` in detail".

### `josh backlog:offer`

A `backlogrun` loop-head event in one call: `backlog:next`, mapped to a budget word, then `backlog:budget`. This section is the single source of the mapping:

- issue numbers → `candidates`; `none` → `exhausted`; `stop` → `parked`; `triage` → `untriaged`
- `wait` → `blocked` with children in flight, `exhausted` without
- `retry` → `blocked` below three consecutive asks, `unreadable` at the third
- `error`, or exit 1 with empty stdout → `unreadable`, never `none`

<!-- usage: backlog:offer -->

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

<!-- /usage -->

`--exclude` / `--repo` forward to `backlog:next`; the budget flags forward to `backlog:budget`. stdout is the verdict, then on `run` the issue numbers; the retry count is the last stderr line.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the event stream (once per drain, best-effort), so the next `run:step` fires the retrospective before the idle watch. A watch opened while children still merge is left unmarked.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:offer` in detail".

### `josh backlog:drive`

Run the `backlogrun` parent loop as one wait: offer, launch, await, merge, then offer again. It uses the same `backlog:offer`, `lane:launch`, and `run:merge` decisions as the individual commands.

<!-- usage: backlog:drive -->

```bash
pnpm josh backlog:drive --owner "$PPID" [--max <n>] [--idle <minutes>] [--only]
```

<!-- /usage -->

An open carry record supplies the start time, merged count and named issues. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `judge`, `watch`, `triage`, `retrospective` or `window`) or `stop <reason>`; the second carries resume flags.

A watch with no child running sends one `💤` Telegram per idle episode, listing the merged count, the `needs-decision` issues and the issues waiting on a not-before date; the next dispatch ends the episode.

The `needs-human-review` and `already-done` labels a backlog run reads are described, with their creation commands, in [Labels and run states](./labels-and-run-states.md).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh backlog:drive` in detail".

## Review, delegation and oracles

Brief and attest a review, decide what a run delegates, and list the computed answers a run reads.

### `josh review:brief`

Print the whole `/code-review` invocation — level, what `josh gate` proved, target and checkout. Pass the output to `/code-review`; the level is on line one.

<!-- usage: review:brief -->

```bash
pnpm josh review:brief                       # round 1
pnpm josh review:brief --round 2             # verification pass, scoped to the fix delta
pnpm josh review:brief --level-only          # the level alone (pre-commit review)
pnpm josh review:brief --level-only --json   # level and reason, machine-readable
```

**Options:**

- `--round 2` — target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).
- `--level-only` — print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.
- `--staged` / `--json` — the staged diff; machine-readable level and reason.

<!-- /usage -->

It refuses to compose a brief when the scoped checks have never been green on this tree; run `pnpm josh lint:related && pnpm josh test:related`, then reissue.

The brief prints the `reviewer` profile; pass its model and effort explicitly to the review subagent.

#### The review level

`pnpm josh review:brief --level-only` prints the `/code-review` level this change is reviewed at. The input is the list of changed paths and nothing else.

| Every changed path is…                                                                   | Level    | Rounds  |
| ---------------------------------------------------------------------------------------- | -------- | ------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1       |
| anything else                                                                            | `medium` | up to 2 |

One non-inert path decides the whole change; an empty diff also takes `medium`. Three things that look inert are not — `.vscode/**`, `.gitattributes` and `.prettierignore` are written into every consumer by `josh init` / `josh sync`. Documentation is not inert either: `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` stay `medium`.

### `josh review:round2`

Say whether the second `/code-review` round is due, or may be skipped. Run it once round 1's fixes are in.

<!-- usage: review:round2 -->

```bash
pnpm josh review:round2                    # → required
pnpm josh review:round2 --round-1-closed   # → required | skip
pnpm josh review:round2 --json             # the verdict and the reason, machine-readable
```

**Options:**

- `--round-1-closed` — the caller states every round-1 High/Medium finding closed and none was filed or deferred; its absence answers `required`.
- `--json` — machine-readable verdict and reason.

<!-- /usage -->

`skip` when the fix delta is empty or touches only inert paths (docs, prompts, comment-only code); `required` otherwise. Full reasoning: `prompts/review.md`.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh review:round2` in detail".

### `josh disposition`

Say whether a review finding **reaches a runtime path** (`runtime`, any non-inert path) or is inert (`non-runtime`) — the machine half of the three-way disposition, sharing `review-level.ts`'s inert set, so only "is the defect confirmed" is left to a person. Verdict on stdout, reason on stderr. Full reasoning: `prompts/review.md` → "Three-way disposition after the cap".

<!-- usage: disposition -->

```bash
pnpm josh disposition <path...>   # → runtime | non-runtime
```

<!-- /usage -->

### `josh review:attest`

Record, or verify, which checkout a `/code-review` actually read — it is forked into the session's working directory, so a lane run can be reviewed from the wrong tree. `josh review:brief` prints a nonce; `attest <nonce>` reads the checkout it is run in and exits non-zero when that is not the briefed one.

<!-- usage: review:attest -->

```bash
pnpm josh review:attest <nonce>   # run by the review, from the checkout it read
pnpm josh review:attest --check   # run by the run, before it acts on the review
```

**Options:**

- `<nonce>` — attest the checkout the review read.
- `--check` — verify before acting; `josh followup` asks again before merging.

<!-- /usage -->

Answers `ok`, `missing` (a refusal), `mismatch` or `not-required`; an attestation expires after eight hours, and an `ok` is still refused on an unread issue update ([`josh issue:ack`](#josh-issueack)).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh review:attest` in detail".

### `josh delegate`

Say whether a step of a run may go to a cheaper execution tier. Verdict to stdout, reason to stderr.

<!-- usage: delegate -->

```bash
pnpm josh delegate gate-fix   # → delegate
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

<!-- /usage -->

**The list is the whole of the rule: anything not on the list is `keep`.** A step earns its place by naming how a wrong result is caught — by something in the parent tier that costs less than redoing the step.

| Step                         | Delegatable because                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-fix`                   | `pnpm josh gate` re-runs; a wrong fix fails it again, naming the file                                                                                                        |
| `epic-child`                 | the parent reads the child's state from GitHub, so a child reported done but not merged shows as still open                                                                  |
| `followup-filing`            | the parent reads the filed Issue with `pnpm josh issue:state <new>`, so one reported filed but not created shows as absent                                                   |
| `survey`                     | the reported locations are checked directly; a fabricated or missed one fails one `grep`                                                                                     |
| `investigation`              | the parent opens the cited lines; an unsupported conclusion fails there, far cheaper than redoing the reading                                                                |
| `implementation-unit`        | the parent runs the whole change through `pnpm josh gate` and a `/code-review` it would run anyway, so a unit's mistake fails the same backstop a serial edit passes through |
| `lane-failure-investigation` | the `backlogrun` parent opens the cited lines and re-reads the child with `pnpm josh issue:state`; parking, re-dispatching and filing stay with the parent                   |

**These were considered and kept**; `pnpm josh delegate <step>` answers `kept deliberately` for them, distinguishing them from a step that is merely unlisted:

| Step               | Kept because                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `notify-body`      | no verifier; a wrong body is sent and read as though it were right                      |
| `issue-comment`    | no verifier; a decision log or completion comment _is_ the record, so nothing checks it |
| `status-read`      | a misread routes the run to the wrong child and no later step disagrees                 |
| `diagnosis`        | a wrong root cause produces a fix that passes the gate and leaves the defect            |
| `design`           | the cost of a wrong design is paid by every step after it                               |
| `split-assessment` | a missed split widens one Issue into a batch nobody authorized                          |
| `review`           | the review is the last thing between a defect and a merge; a cheaper one finds less     |

**`investigation` is the only row that carries a threshold, and the threshold is 3 files, and it is a count, not a forecast.** What comes back is the conclusion plus the `file:line` citations that support it, never the file text; a throwaway probe script is written, run and deleted inside the unit. **It is not `survey`, and it is not `diagnosis`**: `survey` reports where something appears and is checked by one `grep`, while a root cause stays with the main line. `pnpm josh delegate --list` prints the count. **A delegation resets the counter rather than spending it**; `josh investigation:guard` does the counting (`docs/maintainers/josh-commands-backlog-rationale.md` → "`josh delegate` no longer counts investigation reads").

**The mechanism is not the unit.** **One row covers both batch entry points**: an epic's child and one named issue of a `backlogrun` are the same unit, so both were wired to `epic-child`. **`followup-filing` is a third such unit**: the parent composed the finding text either way, so the unit's work is mechanical. **`implementation-unit` is a fourth**: the writing of one Step 0 unit goes to a subagent while the design that decided _what_ to write stays in the main line, and only file-disjoint units split — `josh fanout` confirms that mechanically, so two subagents never race on one file. Rule: `.claude/skills/workflow-commands/delegation.md`.

### `josh fanout`

Say whether proposed implementation units are file-disjoint, so they may be dispatched in one fan-out turn. Each argument is one unit's comma-separated file list; the verdict is on stdout, the reason on stderr — the same shape as `josh delegate`.

<!-- usage: fanout -->

```bash
pnpm josh fanout scripts/a.ts,scripts/a.test.ts scripts/b.ts     # → parallel
pnpm josh fanout scripts/a.ts,shared.ts scripts/b.ts,shared.ts   # → serial (units share shared.ts)
pnpm josh fanout scripts/a.ts                                    # → serial (fewer than two units)
```

<!-- /usage -->

**File-disjointness is the necessary condition**: a split is refused when any file is in two units. **The default is serial**.

**This is the precondition the `implementation-unit` delegation row reads, and the procedure around it is one fan-out turn:**

1. From the Step 0 change list, group the `<what changes> — Test: … — <file path>` rows into candidate units, each a set of files no other unit touches.
2. Ask `pnpm josh fanout` with each unit's file list. On `serial`, write the change in the main line as usual. On `parallel`, continue.
3. **Launch every unit's subagent in a single turn** — the turn-batching principle (`prompts/collaboration-workflow/turn-batching.md`) reaching the `Agent` launches, not one subagent after another — each briefed with its own files and its slice of the Step 0 table.
4. The main line keeps the design, integrates the returned edits, and runs one `pnpm josh gate` and `/code-review` over the whole — the row's verifier.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh fanout` in detail".

### `josh split:assess`

Measure a branch's change size and answer the split assessment's size question. It counts changed files and changed lines against `main`, **excluding test files** (`*.test.ts` / `*.e2e.ts`), and answers `split` only when both guides are exceeded together, `single` otherwise.

<!-- usage: split:assess -->

```bash
pnpm josh split:assess          # → single
pnpm josh split:assess --json   # the verdict and the reason, machine-readable
```

<!-- /usage -->

`split` needs **both** the file guide (10) and the line guide (400) exceeded — the size question only (`.claude/skills/workflow-commands/split-assessment.md` → "The question").

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh split:assess` in detail".

### `josh oracle:list`

Print the decision oracles — commands that answer a rule question from mechanically readable inputs (`prompts/collaboration-workflow/residency.md` → "第 0 問") — with each one's answers, firing point and single source.

<!-- usage: oracle:list -->

```bash
pnpm josh oracle:list
```

<!-- /usage -->

- **The firing point is what makes an oracle enforced**: a declared one refuses that action until the oracle has run (`scripts/rules/oracle-consulted.ts`); the rest stay visibly unenforced.
- Single source: `scripts/rules/decision-oracle.ts` (the enumeration) and `scripts/rules/oracle-firing.ts` (the firing points).

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh oracle:list` in detail".

### `josh clone:scan`

Count code duplication across files and first-party repos (`JOSH_REPO_PATHS` included) — the measurement `no-clones` lacked.

<!-- usage: clone:scan -->

```bash
pnpm josh clone:scan
```

<!-- /usage -->

Output: `clean`, or `clones: <N>` then each clone `[same-file|cross-file|cross-repo]` with `file:line` (exit 0). Single source: `scripts/clone/clone-scan.ts`.

### `josh cases`

Print the I/O boundaries a diff crosses (`network` / `process` / `fs` / `none`) and the abnormal cases a test declaration must cover.

<!-- usage: cases -->

```bash
pnpm josh cases scripts/a.ts scripts/b.ts   # the boundaries these paths cross
```

<!-- /usage -->

Single source: `scripts/cases/cases-cli.ts`.

Detail: `docs/maintainers/josh-commands-backlog-rationale.md` → "`josh cases` in detail".
