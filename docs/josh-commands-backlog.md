# josh CLI — Issue, Epic, Backlog and Review Command Reference

The commands the issue-driven workflow calls to read and file issues, track epics, pick and plan a backlog, brief and attest a review, and decide what a run delegates. Moved out of [josh-commands-automation.md](josh-commands-automation.md), which keeps the other automation commands; the run, lane and session commands are in [josh-commands-run.md](josh-commands-run.md), the commands you type by hand are in [josh-commands.md](josh-commands.md), and every command is indexed in the [Command Catalog](josh-command-catalog.md). The issues each command came from: `docs/maintainers/josh-commands-backlog-rationale.md` → "Where each command came from".

## Issues

Read, file, fold and cite issues, and lint what is written into them.

### `josh issue:read`

Print each issue's title, state, body and every comment in one call, replacing separate `gh api` body and comments reads.

```bash
pnpm josh issue:read 1715
pnpm josh issue:read 1715 1567 1605          # several numbers, read concurrently
```

Attribute each block by its `issue:` line, never by position. Output past the Bash cap is written as part files under it, and only their paths are printed — read every part with the Read tool in one turn. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any number went unanswered. Any non-numeric token refuses the whole call.

### `josh issue:state`

Print each issue's state, labels and whether a run must stop on it, in the spelling the workflow documents compare against.

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read a child in another repository; applies to every number.

State is `OPEN` / `CLOSED` / `MERGED`. `human_review:` answers whether the issue carries `needs-human-review`, matched case-insensitively. Output past the Bash cap is written as part files under it, as `issue:read` does. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered.

### `josh issue:release`

Make an existing issue a blocker of its repository's release issue — the one-issue form of `josh issue:file --release`, for an issue a consumer can use only once it is published.

```bash
pnpm josh issue:release 3360
```

1. List the repository's open issues labelled `release`. An unreadable listing files nothing and exits 1, so the blockers are never split across two release issues.
2. When none is open, file `Release <owner/repo> (next version)` with the `release` label. It never gets `auto-ok` on its own — `issue:file` refuses `auto-ok` for the `release` label on every path — so the release stays a person's call; a person may still add `auto-ok`.
3. Record the issue as a `blocked_by` blocker of the release issue and print `release: #<R> (open|filed) is blocked by #<N>`. A failed link exits 1.

---

### `josh issue:scout`

Before an issue is filed, answer the two questions every filing asks: has this already been filed, and which epic does it belong to. [`josh issue:file`](#josh-issuefile) runs this scan as a filing step and holds the filing until every candidate is named in `--distinct`.

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"
pnpm josh issue:scout "<title>" --body "follows on from #1246"
pnpm josh issue:scout "<title>" --body-file draft.md
```

**Options:**

- `--body "<text>"` — supply prose references (`#N`) so the epic half has a number to work from; without one it prints `Epic: not asked`.
- `--body-file <path>` — pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".

The duplicate half scores titles by token overlap; a candidate needs ≥2 significant shared words and similarity ≥0.35. An issue the body references explicitly is a candidate too, even when its title is not similar. An incomplete search prints `Duplicates: incomplete`. The epic half is [`josh epic:bundle`](#josh-epicbundle)'s decision, and does not replace it.

### `josh issue:file`

The one path for filing an issue. It runs every filing step, in order. A direct filing through `gh api …/issues` or `gh issue create` is refused every time by the `direct-filing` guard, which points to this command.

```bash
pnpm josh issue:file "<title>" --body-file body.md --depth 1
pnpm josh issue:file "<title>" --body-file body.md --depth 0 --route tier-a --repo joshuafolkken/kit
pnpm josh issue:file "<title>" --body-file body.md --depth 1 --distinct 2801,2795
```

**Options:**

- `--body-file <path>` — the body. Required.
- `--depth <0|1|2>` — the depth label. Required. The criteria are `.claude/skills/workflow-commands/observation-filing.md` → "The depth test".
- `--route <tier-a|split|interrupt|review-cap>` — the `route:` label naming the filing route. Omit it for a filing with no route.
- `--label <name>` — an extra label (for example `epic`). Repeatable.
- `--repo <owner/repo>` — the target repository. Defaults to this repository.
- `--distinct <N,…>` — duplicate candidates you read and judged distinct.
- `--over-cap` — the run is blocked by this filing; the cap lets it through.
- `--no-auto-ok` — needs a person's judgement (Tier B / C); no `auto-ok`.
- `--requested` — a person asked for this filing (a `new` entry, or a request in conversation). The carry record and the branch's issue are not read, so `auto-ok` comes only from `--label auto-ok`.
- `--release` — a consumer can use the change only once it is published. The filed issue becomes a blocker of the target's release issue (step 10).

**Steps (run in this order):**

1. Refuse when the target is third-party (Tier C).
2. Check the body against the same criteria as [`josh issue:lint`](#josh-issuelint). Refuse on any problem.
3. For another repository, confirm `## Origin` names the originating issue (`owner/repo#N` or a URL). Refuse when it does not.
4. Print the `auto-ok` decision (applied in a `backlogrun` or when the branch's issue has it, unless `--no-auto-ok`, `--requested` or a `release` label withholds it). When the labels carry `auto-ok` but neither `run:lane` nor `run:solo`, refuse: an untriaged opted-in issue stops `backlog:next` from offering anything. Pass `--label run:lane`, or `--label run:solo` for a defect in kit's own verification (`backlogrun-lanes.md`), or `--no-auto-ok`.
5. Unless the filing is a split child (`--route split` — the split assessment already decided it is separate), when the same finder already filed an issue into the same repository that is still open (a `filed` event not named in `--distinct`, by the same finder — the lane child, else the issue the branch names, read across every invocation on the stream; with no finder, a `filed` event with none in the current invocation), ask the [`josh issue:fold`](#josh-issuefold) question and print `fold: <reason> · filed earlier by this finder: <refs>`. Only `fold` refuses, naming the earlier issue to add the finding to and the `--distinct <N>` that declares it a separate deliverable; `undetermined` (no diff that measures the size) files. A first filing asks nothing.
6. Count the target's open issues and print `wip: <count> open in <owner/repo> · cap <cap> · <verdict>`: `within` up to the cap; past it `exempt` (route `interrupt` / `split` / `tier-a`, or `--over-cap`), else `held`, which asks the exemption question and refuses; an unreadable count warns.
7. Run the same duplicate search as [`josh issue:scout`](#josh-issuescout) and print its report. While there are candidates, file nothing until every one is named in `--distinct`. A duplicate is not filed; it is folded into the existing issue by `issue-fold-existing.md`. A filing to another repository points `GH_REPO` at the target, so the duplicate search and the epic decision run there.
8. Create any missing workflow label (depth / route) with its color and description — the same set as [`josh sync`](josh-commands.md#josh-sync). A label that cannot be created is printed with a warning, and the filing goes on.
9. File with all labels in one request; print the URL.
10. With `--release`, link the filed issue to the target's release issue, as [`josh issue:release`](#josh-issuerelease) does. A link that does not complete prints `⚠` with that command to re-run, prefixed with `GH_REPO=<target>` so a `--repo` filing is linked in the target rather than the current repository.
11. Run [`josh epic:bundle`](#josh-epicbundle) on the filed issue. When it gives no answer, print `⚠` with the command to re-run. The issue already exists, so the exit code stays 0.

A refusal in steps 1–7 files nothing and exits 1. The per-run filing cap (`filing-cap`) applies to calls of this command; a refused call is not counted. The WIP cap and the fold question are this command's own steps, so no delivered rule refuses the call ahead of them.

### `josh issue:fold-existing`

After the existing issue and the draft have been read — bodies, comments, state, pull requests and dependencies — return `duplicate` / `fold` / `separate` / `inspect` from that assessment record. It only decides; it never updates the issue.

```bash
pnpm josh issue:fold-existing assessment.json --json
```

The JSON carries `content` (`duplicate` / `compatible` / `separate` / `unknown`), `is_open`, `is_unstarted`, `has_pull_request`, `has_complete_read`, `has_dependency_conflict`, `is_separable`, `size_verdict` (`single` / `split`), `existing_body`, `draft_body` and `verification`. Omit any fact you do not know; the answer is then `inspect`. Only on `fold` does the output JSON's `body` carry the proposed addition, with the original body kept. Confirm the original body and comments have not changed since the assessment, update through REST, and re-read with `pnpm josh issue:read <N>`. `separate` returns to the ordinary filing path.

### `josh issue:fold`

Before a run files a **second** finding in one session, answer whether the findings fold into one issue or stay separate — the filing-time counterpart to the split assessment, reading its same two questions (separability, and whether the whole clearly exceeds one verification gate).

```bash
pnpm josh issue:fold "First finding" "Second finding"                 # fold | separate | no-fold-needed | undetermined
pnpm josh issue:fold "a" "b" --not-separable                          # the pair is really one deliverable → fold
pnpm josh issue:fold "a" "b" --json                                   # the verdict and reason, machine-readable
```

**Options:**

- `--not-separable` — declare the judgement half: the findings are one deliverable, so they fold whatever their size.
- `--json` — print the verdict and reason as JSON.

The size half is [`josh split:assess`](#josh-splitassess)'s own verdict, called not recomputed — the counting and the guide are single-sourced there. `separate` needs both halves (separable **and** over the size guide); every other measured case folds, and a lone candidate answers `no-fold-needed` without measuring. **A diff that cannot be read, or that has no non-test file, answers `undetermined`**: an empty diff is the state of a run that has not yet written its findings, and reading it as under the guide would fold every one of them. The size is then the whole request's estimate (`split-assessment.md` → "The question"). [`josh issue:file`](#josh-issuefile) asks this question itself on a run's second filing (its step 5), so a filing needs no separate call.

### `josh issue:cite`

Print the paste-ready number-link citation line for each issue in one call, so the correct session-facing form — `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <summary>` — costs one command rather than a title read per issue. The summary is the issue's own title, fetched; adapt it to the session language when it matters.

```bash
pnpm josh issue:cite 2220
pnpm josh issue:cite 2220 1758 1252                        # several numbers, read concurrently
pnpm josh issue:cite 45 --repo joshuafolkken/app-kit       # bare numbers in another repository
pnpm josh issue:cite joshuafolkken/app-kit#45 2220         # per-token owner/repo#N notation
```

**Options:**

- `--repo <owner/repo>` — the repository for every bare number; a token written `owner/repo#N` overrides it for itself.

Citation lines go to stdout so the block stays paste-ready; a number that resolves to nothing or a read that failed is named on stderr rather than dropped, and any failure sets a non-zero exit. Any non-numeric token refuses the whole call. The [`Stop` hook's citation notice](../prompts/collaboration-workflow/issue-citation.md) points at this command with the numbers it detected already filled in.

### `josh issue:comment`

Post one comment to an issue (a PR comment is an issue comment over REST) with the body passed by path, and print the comment URL. It is the write side the read commands lacked — before it, every park, decision record and plan comment fell to a raw `gh api … body=@<path>`, where `-f` / `--raw-field` sends the literal `@<path>` and `-F` / `--field` reads the file, one character apart and silent when wrong. One command removes the choice.

```bash
pnpm josh issue:comment 2304 --body-file /tmp/park.md   # the body from a file — no shell evaluates it
pnpm josh issue:comment 2304 --body "a short note"      # inline, for a body with no backticks or $
```

**Options:**

- `--body <text>` — the comment body, inline. Trimmed, with `\n` expanded to a newline.
- `--body-file <path>` — read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.

The body travels through [`cli-body.ts`](../scripts/josh/cli-body.ts), shared with `notify` / `followup`, so no shell evaluates it; `--body` and `--body-file` at once is refused rather than ranked. `pnpm josh rule:guard` refuses the `-f body=@…` misfire before it runs (the `raw-field-body` row), so the literal `@<path>` cannot reach GitHub.

### `josh pkg:scout`

Before the Package-First tier decision, rank candidate packages by measured metrics so Tier A ("clearly best") and Tier B ("genuine toss-up") are read off the output rather than judged. It queries the npm registry and prints one line per candidate: npm score, weekly downloads, last publish, bundled-types mark, license and unpacked install size.

```bash
pnpm josh pkg:scout "date formatting" --size 5
```

`--size <n>` sets how many candidates to fetch and rank (default 10). The verdict reads the top two's relative lead `(top − second) / top`: `clear` when the leader is ahead by at least 15% (select it, Tier A), `close` when within it (ask the user, Tier B). A failed per-candidate read leaves that metric blank (`—`).

### `josh issue:lint`

Check an issue body file against the template's four required headings — `## 背景`, `## 現象`, `## 期待結果`, `## 受け入れ条件` — and its bug classification (source: `prompts/collaboration-workflow/issue-template.md`). Run this before filing.

```bash
pnpm josh issue:lint /tmp/issue-body.md
```

Prints `ok` and required labels when headings and either `## 背景` declaration — `- 種別: 不具合` or `- 種別: 非不具合` — are present. Missing or conflicting declarations exit 1. [`josh issue:file`](#josh-issuefile) runs this check as a filing step and applies the labels it prints; a non-bug issue without other labels prints `labels: none`. Headings and declarations must stand alone outside code examples.

A body declaring itself a behavior-change Issue with `- 種別: 振る舞い変更` is additionally held to three headings — `## 発火点`, `## ベースライン` and `## 再現`. The firing point is matched against the delivery table: a hook-deliverable tool (`Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`) passes, a real but undeliverable tool is a mismatch, and a non-tool name is off the table. The baseline must be `` `<command>` → <value> `` so it is re-runnable; prose is refused. The reproduction must be a backticked command and its actual output in a fenced block (` ``` ` or `~~~`); prose ("確認した") is refused for the same reason — a defect claimed from a reading rather than a reproduction is caught at filing. A code-only Issue is held to none of this. After merge, [`josh measure:rerun`](josh-commands-automation.md#josh-measurererun) re-runs the baseline.

### `josh defect:rate`

Print the defect rate of merged work over a window — the number that says whether to add a new mechanism or stabilize.

```bash
pnpm josh defect:rate            # the last 14 days
pnpm josh defect:rate --days 30
```

**Options:**

- `--days <n>` — the window in whole days (default 14, at most 3650). Anything else prints the usage and exits 1.

**Behavior:** the numerator is issues filed in the window labelled `bug`, `bugfix` or `route:interrupt`, or declaring `- 種別: 不具合`; the denominator is issues closed as completed in the window labelled `enhancement`. The labels read older issues, whose bodies rarely declared a kind, by the same standard as newer ones. With no completed enhancement, prints `n/a`. The search API returns at most 1000 results; beyond that the counts are lower bounds. An unreadable search exits 1. `backlog:next` uses this rate to prioritize defects.

### `josh issue:backlinks`

Classify an origin issue's upstream backlinks into one fixed word. The backlink headings (`## Origin` / `## Upstream issues` / `## Upstream candidate`, single-sourced in `prompts/collaboration-workflow/issue-template.md`) were fixed so a grep could find them; this is that grep. It reads issue N, then the bodies of every upstream it lists, and checks the pair points both ways.

```bash
pnpm josh issue:backlinks 2123
```

**Verdicts:** `ok` (exit 0) when `## Upstream issues` lists repository-qualified references and each listed upstream cites `## Origin` back — a body with only `## Upstream candidate` (nothing filed yet) also reads `ok`; `missing-upstream` when no backlink heading is present; `missing-origin` when a listed upstream does not point back; `wrong-heading` for a near-miss heading (`## Upstream`), a bare `#N` reference, or a checkbox reference. Anything but `ok` exits 1.

### `josh report:lint`

Check a two-layer work summary (`CLAUDE.md` Step 0, single-sourced in `prompts/collaboration-workflow/report-format.md`) on stdin against the half a machine can enforce: the labels are present, no overview line runs over its character ceiling, nothing wraps the summary in a code fence, and no file path or CLI flag leaks into the overview.

```bash
pnpm josh report:lint < summary.md
```

Prints `ok` (exit 0), or the violations one per line followed by one line naming the template's section in `report-format.md` (exit 1). The judgement half — whether the overview names a concrete subject — is left to the writer, because a machine cannot answer it.

### `josh stash:pop`

Pop the stash whose message matches, and no other. The stash is a repository-wide stack every work tree shares, so a bare `git stash pop` — or a positional `stash@{n}` read before another lane pushed — takes whichever entry now sits on top; that is how one lane's parked work reached another's tree. This resolves the selector from the message immediately before the pop, targeting the entry itself rather than a position that moves.

```bash
pnpm josh stash:pop "backlogrun: parked #2028"
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir"   # into a lane's work tree
```

**Options:** `--dir <path>` applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.

**Verdicts:** `popped` and `conflicted` (exit 0), `no-match` and `ambiguous` (exit 1). A pop that applies but leaves conflicts is `conflicted` — the stash is on the tree, resolve the conflicts and continue. A message matching no stash, or more than one, is refused rather than guessed at — pass a message that identifies exactly one entry.

## Epics and backlog

Track an epic's children and pick what an unattended run takes next.

### `josh epic`

Create the epic issue that tracks a batch of child issues from one split. Satisfies all four mechanical requirements (`epic` label, task-list child rows, machine-readable `Dependencies`, an `Execution` run command) by construction.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file rationale.md
```

**Options:**

- `--ordered` — argument order is the dependency order; writes the arrow chain, records the matching `blocked-by` relations, and adds a `### Declared order` entry under `## Decisions`.
- `--rationale-file <path|->` — split rationale prose (`-` reads stdin).
- `--origin <owner/repo#N>` — backlink when the split originated in another repository.

The `Execution` section prints `backlogrun #<E> --only`. A `blocked-by` write that fails is reported as a count while the epic and task list stay correct.

#### `josh epic --promote` — turn an existing issue into an epic

```bash
pnpm josh epic --promote 858 101 102 103 [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]
```

Appends the epic's sections to the existing issue instead of replacing its body, so discussion and epic stay on one issue. Otherwise matches `josh epic`. Re-running is refused. Promote a request, discussion or container; when the issue is itself a deliverable, keep it as a child and create a new epic.

#### `josh epic --add` — insert children into an existing epic

```bash
pnpm josh epic --add 893 894                  # track #894, declaring no order for it
pnpm josh epic --add 893 894 --before 891     # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890      # #894 starts once #890 is done
pnpm josh epic --add 893 894 --decision-file why.md   # …and record why, in one call
```

Writes all three places an epic's order lives — the task list, the `## Dependencies` arrow declaration, and the native `blocked-by` relations — from one input, so they cannot disagree.

**Options:**

- `--before <M>` — insert before `#M`, re-pointing what `#M` was waiting on so the chain is never broken.
- `--after <M>` — start after `#M`; branches when `#M` already has a successor, extends when it is a tail.
- `--order-before <M>` / `--order-after <M>` — move the task-list row only; write no `blocked-by` relation.
- `--decision-file <path|->` — record why the child was placed.
- `--remove <E> <M> <N> [<N2> …]` — delete a declared order from the body and the relations; each consecutive pair is one link.

Nothing is written unless all three places will agree. `#M` must be a child of the epic; a position naming an issue being placed, or a hub the declaration cannot position within, is refused without writing. A cross-repository target is refused with the bare-number command to run instead.

#### `josh epic --reconcile` — bring the declaration and the recorded relations back into agreement

```bash
pnpm josh epic --reconcile 2184   # rewrite the body to match the recorded blocked-by, and record any order the body declared
```

When the `## Dependencies` declaration and the native `blocked-by` relations disagree, `--add` and `--remove` both refuse and `backlog:next` reports the graph unusable — and the only other exit was to edit the epic body by hand. `--reconcile` is that repair. There is no judgement in it: a relation recorded but never declared is written into the declaration (the relation is the GitHub-side fact, the body its copy), and an order declared but never recorded is aligned by recording the relation. The result declares exactly what it records.

- It **writes no `## Decisions`** — synchronizing a copy is not a decision, so nothing is recorded on the epic or its children.
- When the two already agree it writes nothing and prints `nothing to reconcile`.
- A circular union of declared and recorded orders is refused without writing; there is nothing to reconcile a cycle to.
- On success it states that `epic:audit` and `backlog:next` now agree on the epic's order.

### `josh epic:next`

List an epic's runnable children, bundled per repository. All state lives on GitHub, so asking again after any interruption gives the same answer.

```bash
pnpm josh epic:next 858
pnpm josh epic:next 858 --repo joshuafolkken/kit   # just the next child for one repository
pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes   # one child per free lane there
```

**Options:**

- `--repo <owner/repo>` — answer for one repository; stdout carries one token (an issue number, or `wait`/`stop`/`complete`), everything else on stderr.
- `--lanes` — print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 6. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in [`josh backlog:next`](#josh-backlognext)).

With `--repo`, the occupancy line names each `in-progress` holder with its label age read from the issue timeline — `in-progress for <n> min`, marked `stale` past 90 minutes or when the label predates the timeline, `label age unread` when the timeline could not be read.

Several leading epic arguments merge into one candidate pool per repository. A cross-repository dependency resolves only when the blocker is closed **and** its declared version has published. `run`/`wait`/`stop`/`complete` exit `0`; an unusable graph (cycle, or body/relations disagreement) exits `1`.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog. It finds candidates and recommends; it writes nothing. [`josh issue:file`](#josh-issuefile) runs it on the issue it creates as its last filing step.

```bash
pnpm josh epic:bundle 874
```

Only two things count as a signal: the two issues referring to each other in prose, or an already-recorded `blocked-by`. A similar title never counts on its own.

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

```bash
pnpm josh epic:audit 858
```

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

```bash
pnpm josh epic:check 700
```

**Output / exit codes:** exits `0` when every requirement is satisfied, `1` otherwise, so it works as a gate. The dependencies check wants exactly one of the two machine-readable forms — neither present is ambiguous, both present is a contradiction.

### `josh auto-ok:next`

Print the next opted-in standalone issue an unattended run may pick up outside an epic. Read-only; ranks `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then issues other open issues wait on, then newest-first, skipping `epic`, `in-progress`, `needs-decision` and any candidate whose `blockedBy` is still open.

```bash
pnpm josh auto-ok:next
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
# create the label once, where wanted:
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

- `--exclude <N>` — drop issues from the answer; comma-separated, repeatable.

stdout is one token — the issue number, or `none`, or empty with exit 1 if the listing could not be read; explanations to stderr.

### `josh backlog:next`

Order the whole opted-in backlog in one command — standalone `auto-ok` issues plus the descendants of every epic whose root carries `auto-ok`, followed transitively through nested epics. Read-only. Tokens are bare numbers scoped to the repository.

```bash
pnpm josh backlog:next
pnpm josh backlog:next --exclude 1630  # skip the issue just merged
```

- `--exclude <N>` — drop issues from every bucket; comma-separated, repeatable.

stdout is one token per line (all exit 0 unless noted): `<number>…` (each an issue a run may start, possibly in parallel), `wait` (resolves on its own), `stop` (needs a person), `triage` (a candidate is untriaged — see below), `retry` (429/5xx or a request that never arrived), `error` (an unusable graph; anything GitHub answered with, 403 included), `none` (nothing opted in), or empty with exit 1 if a listing could not be read. Explanations to stderr.

**Triage gate**: a candidate is triaged when it carries `run:solo` (runs alone) or `run:lane` (may run beside others), matched case-insensitively. When any candidate of this repository carries neither, the command prints `triage` and no numbers — an untriaged issue may be one that must run alone, so none of the others may start either — and names the untriaged issues on stderr. `backlog:offer` maps it to the budget answer `untriaged`, `backlog:budget` answers `triage`, and `backlog:drive` hands it back to the parent. The gate runs before the `run:solo` gate below. `epic:next --lanes` applies it to a named epic's lanes too.

**Defect priority**: on a `run` answer the command measures `defect:rate` over its default 14 days. While the rate is strictly above the baseline (0.73, `BASELINE_RATE` in `scripts/issue/defect-rate.ts`), the runnable numbers are re-ordered — defects (counted as `defect:rate`'s numerator counts them) first, new mechanisms (`- 種別: 振る舞い変更` without either) last, everything else in between — each kind keeping the graph's order. At or below the baseline, or when the rate cannot be read (noted on stderr), the order is unchanged. Only the order within the runnable set changes, so no dependency is crossed.

**Ranking**: after the defect priority, this repository's runnable numbers are sorted by three keys, the earlier order breaking ties — `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then the number of open backlog issues blocked by it. The `run:solo` gate below sees the whole ranking; only then are the standalone (non-epic) numbers cut to five, and a number past the cut is listed as waiting.

**`run:solo` gate**: on a `run` answer the command reads the repository's open `in-progress` issues (parked ones excluded) and applies three rules. While a `run:solo` issue is running, it prints `wait`. When nothing is running, a `run:solo` candidate at the head is printed alone. A `run:solo` candidate further down cuts the list, so only the candidates ahead of it are printed. While other lanes run, a `run:solo` candidate at the head prints `wait`. The label does not move a candidate up the ranking. When the listing cannot be read, or was cut short, it prints `wait`. The reason goes to stderr. `epic:next --lanes` applies the same gate to a named epic's lanes. `backlog:plan` is not gated, but it marks such rows `[run:solo]` and rows with neither label `[untriaged]`.

### `josh backlog:plan`

The whole backlog rendered as a plan a person reads before a run starts — four sections on stdout, using `backlog:next`'s own classification. Separate because that command's stdout is bare tokens a loop branches on.

```bash
pnpm josh backlog:plan
pnpm josh backlog:plan --exclude 1630  # after #1630 merged
pnpm josh backlog:plan --waves         # the run order, wave by wave
```

- `--exclude <N>` — same exclusion as `backlog:next`.
- `--waves` — print the order the run takes instead of the sections. It assumes each wave merges before the next one starts, leaves out issues a run already has, and plans only this repository. Wave 1 is what `backlog:next` prints for an idle repository; each later wave marks the earlier ones closed and applies the same classification and `run:solo` gate again. A wave of several issues is marked `(parallel)`. Issues no wave reaches are listed last with their reason. Read-only, and refused with named issues or `--only`.

```text
Wave 1  #2770 [run:solo]
Wave 2  #2765 [run:solo]
Wave 3  #2774 #2766 #2769   (parallel)
```

Sections: **Ready now** (runnable children, grouped by repository = the parallelism; a `run:solo` row is marked `[run:solo]`, a row with neither `run:solo` nor `run:lane` `[untriaged]`), **Waiting** (each withheld child naming what it waits on), **Waiting on a person** (`needs-decision` children), **Out of scope** (every open issue the backlog will not run, with the reason).

### `josh backlog:stalled`

Report whether ready backlog work is sitting undispatched while a lane is free and nothing has dispatched for a while — the state where a run is alive but not advancing and nobody notices until a person asks. Reads three facts, weighs none: a runnable count from `backlog:next`, the free-lane count, and the age of the last `child-launch` event on the run's stream.

```bash
pnpm josh backlog:stalled
```

stdout is one verdict word, always exit 0 — it reports, it never stops: `stalled` (all three hold), `unreadable` (no run stream to key on), or `ok`. On `stalled` it leaves a `stall` marker on the run's event stream — once per episode, which is what a terminal reader following the stream sees and what `run:step` reads as `backlog:next` — and sends one `⏳` Telegram notification. The cheap conditions gate the costly one: the backlog is only read when the run is already idle past the threshold with a free lane. Wired into the Stop hook (`stop-guard`) so it fires at each loop boundary; failures are swallowed so a report never holds a stop.

### `josh backlog:budget`

Say whether a `backlogrun` may start more work, keep watching, or finish. Read-only. Maps `backlog:next`'s answer into a budget verdict.

```bash
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active"
pnpm josh backlog:budget --answer exhausted  --started "$started" --active "$active" --idle 60
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active" --merged 3 --running 2 --max 5
```

- `--answer <candidates|exhausted|blocked|parked|unreadable|untriaged>` — `backlog:next`'s answer, mapped.
- `--started` / `--active` — when the invocation began / when it last had work (required unless the watch is off).
- `--idle <minutes>` — after candidates run out, keep polling this long (default 30; `--idle 0` turns the watch off).
- `--max <count>` — issues one invocation may take (default unlimited); `--merged` and `--running` count against it.
- `--json` — collapse verdict and reason into `{"budget": "<verdict>", "reason": "…"}`.

stdout is the verdict word (reason to stderr): `run` (start what was offered), `watch` (sleep the interval and ask both again), `stop` (report and finish), `triage` (judge the untriaged issues, then ask again — only after the bound and the maximum), or empty with exit 1 if the invocation is unreadable. The whole-run bound (8 hours) is decided here and outranks both budgets, but a `parked` or `unreadable` answer outranks the bound. A watch polls every 5 min.

### `josh backlog:offer`

A `backlogrun` loop-head event in one call: `backlog:next`, mapped to a budget word, then `backlog:budget`. This section is the single source of the mapping: issue numbers → `candidates`; `wait` → `blocked` with children in flight, `exhausted` without; `none` → `exhausted`; `stop` → `parked`; `triage` → `untriaged`; `retry` → `blocked` below three consecutive asks, `unreadable` at the third (any other answer resets the count); `error`, or exit 1 with empty stdout, → `unreadable` — never `none`, and never re-asked.

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

`--exclude` / `--repo` forward to `backlog:next`; `--started` / `--active` / `--merged` / `--running` / `--max` / `--idle` forward to `backlog:budget` (`--answer` is computed here). `--running` also decides `wait` (→ `blocked` with children in flight, else `exhausted`) and `--retries` decides `retry` (→ `blocked` below three, `unreadable` at the third). stdout is the verdict, then — on `run` — the issue numbers one per line; the new retry count is the last stderr line (`retries: <n>`) and in `--json`. Exit 1 from `backlog:next` maps to `unreadable`, never `none`.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the event stream (once per drain, best-effort), so the next `run:step` fires the retrospective before the idle watch. A watch opened while children still merge is left unmarked.

### `josh backlog:drive`

Run the `backlogrun` parent loop as one wait: offer, launch, await, merge, then offer again. It uses the same `backlog:offer`, `lane:launch`, and `run:merge` decisions as the individual commands.

```bash
pnpm josh backlog:drive --owner "$PPID" [--max <n>] [--idle <minutes>] [--only]
```

An open carry record supplies the start time, merged count and remaining named issues. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `watch`, `triage`, `retrospective`, or `window`), or `stop <reason>` after `run:report` and `run:carry --end`; the second line contains resume flags. The driver merges without the context hand-off check — the supervisor that runs it has no session to cut, so a merge is never handed back as `over` — and it excludes every child still in flight from the offer, so a child that merged its own PR before the loop collected it is never offered for a second launch. A judgment hand-off carries a `Next:` line naming the section to act by and the command that hands the loop back (`run:carry --cut`). A `stop` from `run:merge` is read like the offer's: that child is collected, nothing new starts, and every child still in flight is collected before the run ends as `stop`. A drained backlog yields for the retrospective only when `JOSH_RETROSPECTIVE` is on (the same switch `run:step` reads, loaded from `.env`); with the switch off, or once the retrospective has run, the idle watch continues and a drained `stop` ends the run itself. Named issues are dispatched in their recorded order; `--only` reports and ends after the list. On restart, only lanes with a launch event from this invocation are adopted. A merge is counted once per Issue in the carry record, including when the process stops between counting and the merge event. Launches pass `--stash` while the `josh latest` stash exists.

The `needs-human-review` and `already-done` labels a backlog run reads are described, with their creation commands, in [Labels and run states](./labels-and-run-states.md).

## Review, delegation and oracles

Brief and attest a review, decide what a run delegates, and list the computed answers a run reads.

### `josh review:brief`

Print the whole `/code-review` invocation — level, what `josh gate` proved, target and checkout. Pass the output to `/code-review`; the level is on line one.

```bash
pnpm josh review:brief            # round 1
pnpm josh review:brief --round 2  # verification pass, scoped to the fix delta
pnpm josh review:brief --level-only          # the level alone (pre-commit review)
pnpm josh review:brief --level-only --json   # level and reason, machine-readable
```

- `--round 2` — target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).
- `--level-only` — print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.
- `--staged`, `--json` — the staged diff; machine-readable level and reason.

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

```bash
pnpm josh review:round2                     # → required
pnpm josh review:round2 --round-1-closed    # → required | skip
pnpm josh review:round2 --json              # the verdict and the reason, machine-readable
```

- `--round-1-closed` — the caller states every round-1 High/Medium finding closed and none was filed or deferred; its absence answers `required`.
- `--json` — machine-readable verdict and reason.

`skip` on **Arm A** (the fix delta is empty) or **Arm B** (every path in the fix delta is inert by [`josh review:brief --level-only`](#josh-reviewbrief)'s classification); `required` for anything else, including a missing `--round-1-closed`, a missing round-1 snapshot, a snapshot against a different change base, and one non-inert path. Full reasoning: `prompts/review.md`.

### `josh disposition`

Say whether a review finding **reaches a runtime path** (`runtime`, any non-inert path) or is inert (`non-runtime`) — the machine half of the three-way disposition, sharing `review-level.ts`'s inert set, so only "is the defect confirmed" is left to a person. Verdict on stdout, reason on stderr. Full reasoning: `prompts/review.md` → "Three-way disposition after the cap".

```bash
pnpm josh disposition <path...>   # → runtime | non-runtime
```

### `josh review:attest`

Record, or verify, which checkout a `/code-review` actually read — it is forked into the session's working directory, so a lane run can be reviewed from the wrong tree. `josh review:brief` prints a nonce; `attest <nonce>` reads the checkout it is run in and exits non-zero when that is not the briefed one.

```bash
pnpm josh review:attest <nonce>   # run by the review, from the checkout it read
pnpm josh review:attest --check   # run by the run, before it acts on the review
```

- `<nonce>` — attest the checkout the review read.
- `--check` — verify before acting; `josh followup` asks again before merging.

Answers: `ok` (attested the briefed checkout), `missing` (a brief was recorded and nothing attested it — a refusal, not a pass), `mismatch` (a different root, branch or HEAD), `not-required` (no brief recorded in this checkout inside a run's lifetime). All three fields are checked; scoped to a checkout that briefed a review, expiring after eight hours.

### `josh delegate`

Say whether a step of a run may go to a cheaper execution tier. Verdict to stdout, reason to stderr.

```bash
pnpm josh delegate gate-fix   # → delegate
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

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

```bash
pnpm josh fanout scripts/a.ts,scripts/a.test.ts scripts/b.ts   # → parallel
pnpm josh fanout scripts/a.ts,shared.ts scripts/b.ts,shared.ts # → serial (units share shared.ts)
pnpm josh fanout scripts/a.ts                                   # → serial (fewer than two units)
```

**File-disjointness is the necessary condition, and it is mechanical.** Two subagents editing one file in parallel race on it — the later write lands on the earlier, or the gate has to reconcile a collision the parallelism was meant to save. So the split is refused the moment any file appears in more than one unit, and the naming of what collides is on stderr. **The default is serial**: fewer than two units is nothing to run in parallel, and an Issue whose units share files stays serial exactly as one that will not split does.

**This is the precondition the `implementation-unit` delegation row reads, and the procedure around it is one fan-out turn:**

1. From the Step 0 change list, group the `<what changes> — Test: … — <file path>` rows into candidate units, each a set of files no other unit touches.
2. Ask `pnpm josh fanout` with each unit's file list. On `serial`, write the change in the main line as usual. On `parallel`, continue.
3. **Launch every unit's subagent in a single turn** — the turn-batching principle (`prompts/collaboration-workflow/turn-batching.md`) reaching the `Agent` launches, not one subagent after another — each briefed with its own files and its slice of the Step 0 table.
4. The main line keeps the design that decided _what_ to write, integrates the returned edits, and runs the one `pnpm josh gate` and `/code-review` over the whole. That gate and review — which the parent runs anyway — is the row's verifier: a unit's mistake fails the same backstop a serial edit passes through, and the disjointness `josh fanout` confirmed keeps two units from colliding on a file. The design stays in the main line, which is why `design` is rejected while the writing is delegated.

### `josh split:assess`

Measure a branch's change size and answer the split assessment's size question. It counts changed files and changed lines against `main`, **excluding test files** (`*.test.ts` / `*.e2e.ts`), and answers `split` only when both guides are exceeded together, `single` otherwise.

```bash
pnpm josh split:assess          # → single
pnpm josh split:assess --json   # the verdict and the reason, machine-readable
```

`split` needs **both** the file guide (10) and the line guide (400) exceeded; either alone, or an empty diff, is `single` — the conservative default of `.claude/skills/workflow-commands/split-assessment.md` → "The question". It answers the **size** question only: separability stays a judgement, so `split` is the size condition met, not a decision to divide the Issue. Untracked files have no diff base — commit before measuring for an exact count.

### `josh oracle:list`

Print the decision oracles — commands that answer a rule question from mechanically readable inputs alone (question 0 of the rule-placement criterion, `prompts/collaboration-workflow/residency.md` → "第 0 問"). Each row carries the command, its answer vocabulary, its **firing point** (or the reason none can be named) and its single-source document. Adding a new oracle means adding a row here and a firing-point declaration in `scripts/rules/oracle-firing.ts`, and nowhere else.

```bash
pnpm josh oracle:list
```

- **The firing point is what makes an oracle enforced**. A declared firing point — the action the oracle must precede — wires a generic `oracle-consulted` delivered rule that refuses that action until the oracle's command has run (`scripts/rules/oracle-consulted.ts`). One is wired: `pkg:scout` (a package add). `issue:lint` no longer has one — [`josh issue:file`](#josh-issuefile) runs the lint as a filing step. `release:scope` is on the reason side, not a firing point: it reads the release owed _after_ `pnpm josh followup` merges, so it trails the merge rather than gating it. The rest declare why no firing point can be named and stay **visibly unenforced** rather than silently so, so a new oracle must always answer whether it has a firing point.
- Single source: `scripts/rules/decision-oracle.ts` (the enumeration) and `scripts/rules/oracle-firing.ts` (the firing points).

### `josh clone:scan`

Count code duplication across files and first-party repos (`JOSH_REPO_PATHS` included) — the measurement `no-clones` lacked. Output: `clean`, or `clones: <N>` then each clone `[same-file|cross-file|cross-repo]` with `file:line` (exit 0). Single source: `scripts/clone/clone-scan.ts`.

### `josh cases`

Read changed paths and print the I/O boundaries the diff crosses (`network` / `process` / `fs` / `none`) and, for each, the mandatory abnormal cases a test declaration must account for (non-200, timeout, empty response, malformed JSON, rate limit). A decision oracle: the unit suite blocks network by design, so these cases are confronted at declaration time. Single source: `scripts/cases/cases-cli.ts`.
