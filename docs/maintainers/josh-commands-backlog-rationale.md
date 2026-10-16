# josh issue, epic, backlog and review command reference — rationale and history

History behind [josh-commands-backlog.md](../josh-commands-backlog.md), kept here so the reference
states only each command's contract — what it does, its arguments, output, exit codes and side effects.

## `josh delegate` no longer counts investigation reads

The investigation threshold's counting first lived beside the `josh delegate` enumeration; it moved
into `josh investigation:guard`, which is why a delegation resets the counter rather than spending it.

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior. joshuafolkken/kit#3280 moved these commands out of the automation reference.

| Command                | Issues                                   |
| ---------------------- | ---------------------------------------- |
| `josh issue:comment`   | #2304                                    |
| `josh pkg:scout`       | #2216                                    |
| `josh issue:lint`      | #2123, #2212, #2353                      |
| `josh defect:rate`     | #2449, #2455                             |
| `josh report:lint`     | #2123                                    |
| `josh stash:pop`       | #2050                                    |
| `josh epic:next`       | #2779                                    |
| `josh auto-ok:next`    | #2928                                    |
| `josh backlog:next`    | #2244, #2449, #2455, #2776, #2779, #2928 |
| `josh backlog:plan`    | #2778                                    |
| `josh backlog:stalled` | #2359                                    |
| `josh backlog:offer`   | #2335                                    |
| `josh backlog:drive`   | #2499, #2508, #2881                      |
| `josh oracle:list`     | #2324, #2334, #2808                      |

## `josh issue:ack` in detail

`josh run:entry` records the issue as the run's baseline per checkout, so a lane child and a `fullrun` in your own checkout behave alike. The PreToolUse hook polls at most every three minutes with a conditional request and shows a person's body edit or new comment once; josh's own `<!-- josh:run -->`-marked comments and bot comments do not count. `issue:ack` prints what it takes in and makes that read the new baseline. Not detected: comment edits, and the seconds between `josh followup`'s last check and the merge.

## `josh issue:release` in detail

- `--wait` — point the edge the other way: the issue is blocked by the release issue, for an issue that needs the published version. Prints `release: #<N> waits on #<R> (open|filed)`. `backlog:next` offers the issue again once the release issue closes, with no label for a person to remove — a run records a wait for publication this way rather than with `needs-decision` (`.claude/skills/workflow-commands/prerequisite.md`).

## `josh issue:file` in detail

4. Print the `auto-ok` decision, judged the same way for every filing, including one a person asked for. It is not applied with `--no-auto-ok`, for another repository, or when the labels carry `release`, `breaking-change` (including a body that declares `- 互換性: 破壊的変更`), `deferred`, `needs-human-review` or `epic`. Otherwise the body's `## 背景` decides it: `- 人の判断: 不要` applies it, `- 人の判断: 要` does not. A body that declares neither, or both, is refused at step 2 with how to write the line. When the labels carry `auto-ok` but neither `run:lane` nor `run:solo`, refuse: an untriaged opted-in issue stops `backlog:next` from offering anything. Pass `--label run:lane`, or `--label run:solo` for a defect in kit's own verification (`backlogrun-lanes.md`), or `--no-auto-ok`.

5. Unless the filing is a split child (`--route split` — the split assessment already decided it is separate), when the same finder already filed an issue into the same repository that is still open (a `filed` event not named in `--distinct`, by the same finder — the lane child, else the issue the branch names, read across every invocation on the stream; with no finder, a `filed` event with none in the current invocation), ask the [`josh issue:fold`](../josh-commands-backlog.md#josh-issuefold) question and print `fold: <reason> · filed earlier by this finder: <refs>`. Only `fold` refuses, naming the earlier issue to add the finding to and the `--distinct <N>` that declares it a separate deliverable; `undetermined` (no diff that measures the size) files. A first filing asks nothing.

## `josh issue:fold-existing` in detail

The JSON carries `content` (`duplicate` / `compatible` / `separate` / `unknown`), `is_open`, `is_unstarted`, `has_pull_request`, `has_complete_read`, `has_dependency_conflict`, `is_separable`, `size_verdict` (`single` / `split`), `existing_body`, `draft_body` and `verification`. Omit any fact you do not know; the answer is then `inspect`. Only on `fold` does the output JSON's `body` carry the proposed addition, with the original body kept. Confirm the original body and comments have not changed since the assessment, update through REST, and re-read with `pnpm josh issue:read <N>`. `separate` returns to the ordinary filing path.

## `josh issue:fold` in detail

The size half is [`josh split:assess`](../josh-commands-backlog.md#josh-splitassess)'s own verdict, called not recomputed — the counting and the guide are single-sourced there. `separate` needs both halves (separable **and** over the size guide); every other measured case folds, and a lone candidate answers `no-fold-needed` without measuring. A diff that cannot be read, or that has no non-test file, answers `undetermined`: an empty diff is the state of a run that has not yet written its findings, and reading it as under the guide would fold every one of them. The size is then the whole request's estimate (`split-assessment.md` → "The question"). [`josh issue:file`](../josh-commands-backlog.md#josh-issuefile) asks this question itself on a run's second filing (its step 5), so a filing needs no separate call.

## `josh issue:comment` in detail

Post one comment to an issue (a PR comment is an issue comment over REST) with the body passed by path, and print the comment URL. It is the write side the read commands lacked — before it, every park, decision record and plan comment fell to a raw `gh api … body=@<path>`, where `-f` / `--raw-field` sends the literal `@<path>` and `-F` / `--field` reads the file, one character apart and silent when wrong. One command removes the choice.

## `josh issue:lint` in detail

Prints `ok` and required labels when headings and either `## 背景` declaration — `- 種別: 不具合` or `- 種別: 非不具合` — are present. Missing or conflicting declarations exit 1. [`josh issue:file`](../josh-commands-backlog.md#josh-issuefile) runs this check as a filing step and applies the labels it prints; a non-bug issue without other labels prints `labels: none`. Headings and declarations must stand alone outside code examples.

A body declaring itself a behavior-change Issue with `- 種別: 振る舞い変更` is additionally held to three headings — `## 発火点`, `## ベースライン` and `## 再現`. The firing point is matched against the delivery table: a hook-deliverable tool (`Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`) passes, a real but undeliverable tool is a mismatch, and a non-tool name is off the table. The baseline must be `` `<command>` → <value> `` so it is re-runnable; prose is refused. The reproduction must be a backticked command and its actual output in a fenced block (` ``` ` or `~~~`); prose ("確認した") is refused for the same reason — a defect claimed from a reading rather than a reproduction is caught at filing. A code-only Issue is held to none of this. After merge, [`josh measure:rerun`](../josh-commands-automation.md#josh-measurererun) re-runs the baseline.

## `josh defect:rate` in detail

**Behavior:** the numerator is issues filed in the window labelled `bug`, `bugfix` or `route:interrupt`, or declaring `- 種別: 不具合`; the denominator is issues closed as completed in the window labelled `enhancement`. The labels read older issues, whose bodies rarely declared a kind, by the same standard as newer ones. With no completed enhancement, prints `n/a`. The search API returns at most 1000 results; beyond that the counts are lower bounds. An unreadable search exits 1. `backlog:next` uses this rate to prioritize defects.

## `josh issue:backlinks` in detail

**Verdicts:** `ok` (exit 0) when `## Upstream issues` lists repository-qualified references and each listed upstream cites `## Origin` back — a body with only `## Upstream candidate` (nothing filed yet) also reads `ok`; `missing-upstream` when no backlink heading is present; `missing-origin` when a listed upstream does not point back; `wrong-heading` for a near-miss heading (`## Upstream`), a bare `#N` reference, or a checkbox reference. Anything but `ok` exits 1.

## `josh stash:pop` in detail

Pop the stash whose message matches, and no other. The stash is a repository-wide stack every work tree shares, so a bare `git stash pop` — or a positional `stash@{n}` read before another lane pushed — takes whichever entry now sits on top; that is how one lane's parked work reached another's tree. This resolves the selector from the message immediately before the pop, targeting the entry itself rather than a position that moves.

## `josh epic --reconcile` — bring the declaration and the recorded relations back into agreement in detail

When the `## Dependencies` declaration and the native `blocked-by` relations disagree, `--add` and `--remove` both refuse and `backlog:next` reports the graph unusable — and the only other exit was to edit the epic body by hand. `--reconcile` is that repair. There is no judgement in it: a relation recorded but never declared is written into the declaration (the relation is the GitHub-side fact, the body its copy), and an order declared but never recorded is aligned by recording the relation. The result declares exactly what it records.

## `josh backlog:next` in detail

stdout is one token per line (all exit 0 unless noted): `<number>…` (each an issue a run may start, possibly in parallel), `wait` (resolves on its own), `stop` (needs a person), `triage` (a candidate is untriaged — see below), `retry` (429/5xx or a request that never arrived), `error` (an unusable graph; anything GitHub answered with, 403 included), `none` (nothing opted in), or empty with exit 1 if a listing could not be read. Explanations to stderr.

**Triage gate**: a candidate is triaged when it carries `run:solo` (runs alone) or `run:lane` (may run beside others), matched case-insensitively. When any candidate of this repository carries neither, the command prints `triage` and no numbers — an untriaged issue may be one that must run alone, so none of the others may start either — and names the untriaged issues on stderr. `backlog:offer` maps it to the budget answer `untriaged`, `backlog:budget` answers `triage`, and `backlog:drive` hands it back to the parent. The gate runs before the `run:solo` gate below. `epic:next --lanes` applies it to a named epic's lanes too.

Defect priority: on a `run` answer the command measures `defect:rate` over its default 14 days. While the rate is strictly above the baseline (0.73, `BASELINE_RATE` in `scripts/issue/defect-rate.ts`), the runnable numbers are re-ordered — defects (counted as `defect:rate`'s numerator counts them) first, new mechanisms (`- 種別: 振る舞い変更` without either) last, everything else in between — each kind keeping the graph's order. At or below the baseline, or when the rate cannot be read (noted on stderr), the order is unchanged. Only the order within the runnable set changes, so no dependency is crossed.

Ranking: after the defect priority, this repository's runnable numbers are sorted by three keys, the earlier order breaking ties — `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then the number of open backlog issues blocked by it. The `run:solo` gate below sees the whole ranking; only then are the standalone (non-epic) numbers cut to five, and a number past the cut is listed as waiting.

`run:solo` gate: on a `run` answer the command reads the repository's open `in-progress` issues (parked ones excluded) and applies three rules. While a `run:solo` issue is running, it prints `wait`. When nothing is running, a `run:solo` candidate at the head is printed alone. A `run:solo` candidate further down cuts the list, so only the candidates ahead of it are printed. While other lanes run, a `run:solo` candidate at the head prints `wait`. The label does not move a candidate up the ranking. When the listing cannot be read, or was cut short, it prints `wait`. The reason goes to stderr. `epic:next --lanes` applies the same gate to a named epic's lanes. `backlog:plan` is not gated, but it marks such rows `[run:solo]` and rows with neither label `[untriaged]`.

## `josh backlog:plan` in detail

- `--waves` — print the order the run takes instead of the sections. It assumes each wave merges before the next one starts, leaves out issues a run already has, and plans only this repository. Wave 1 is what `backlog:next` prints for an idle repository; each later wave marks the earlier ones closed and applies the same classification and `run:solo` gate again. A wave of several issues is marked `(parallel)`. Issues no wave reaches are listed last with their reason. Read-only, and refused with named issues or `--only`.

## `josh backlog:stalled` in detail

stdout is one verdict word, always exit 0 — it reports, it never stops: `stalled` (all three hold), `unreadable` (no run stream to key on), or `ok`. On `stalled` it leaves a `stall` marker on the run's event stream — once per episode, which is what a terminal reader following the stream sees and what `run:step` reads as `backlog:next` — and sends one `⏳` Telegram notification. The cheap conditions gate the costly one: the backlog is only read when the run is already idle past the threshold with a free lane. Wired into the Stop hook (`stop-guard`) so it fires at each loop boundary; failures are swallowed so a report never holds a stop.

## `josh backlog:budget` in detail

stdout is the verdict word (reason to stderr): `run` (start what was offered), `watch` (sleep the interval and ask both again), `stop` (report and finish), `triage` (judge the untriaged issues, then ask again — only after the maximum), or empty with exit 1 if the invocation is unreadable. An `exhausted`, `parked` or `unreadable` answer all enter the same watch: 8 hours from `--active`, restarted when a child runs, and ended early only by `--idle 0`. No bound is counted from `--started`. A watch polls every 60 s, the same interval as a running batch.

## `josh backlog:offer` in detail

A `backlogrun` loop-head event in one call: `backlog:next`, mapped to a budget word, then `backlog:budget`. This section is the single source of the mapping: issue numbers → `candidates`; `wait` → `blocked` with children in flight, `exhausted` without; `none` → `exhausted`; `stop` → `parked`; `triage` → `untriaged`; `retry` → `blocked` below three consecutive asks, `unreadable` at the third (any other answer resets the count); `error`, or exit 1 with empty stdout, → `unreadable` — never `none`, and never re-asked.

`--exclude` / `--repo` forward to `backlog:next`; `--started` / `--active` / `--merged` / `--running` / `--max` / `--idle` forward to `backlog:budget` (`--answer` is computed here). `--running` also decides `wait` (→ `blocked` with children in flight, else `exhausted`) and `--retries` decides `retry` (→ `blocked` below three, `unreadable` at the third). stdout is the verdict, then — on `run` — the issue numbers one per line; the new retry count is the last stderr line (`retries: <n>`) and in `--json`. Exit 1 from `backlog:next` maps to `unreadable`, never `none`.

## `josh backlog:drive` in detail

An open carry record supplies the start time, merged count and remaining named issues. A record that does not read is read again at the 60-second offer interval, up to 6 times, before the driver exits 1 naming what each read answered; a record `run:carry --end` ended, or one another owner holds, ends the driver at once. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `judge`, `watch`, `triage`, `retrospective`, or `window`), or `stop <reason>` after `run:report` and `run:carry --end`; the second line contains resume flags. The driver merges without the context hand-off check — the supervisor that runs it has no session to cut, so a merge is never handed back as `over` — and it excludes every child still in flight from the offer, so a child that merged its own PR before the loop collected it is never offered for a second launch. A judgment hand-off carries a `Next:` line naming the section to act by and the command that hands the loop back (`run:carry --cut`). Only `run:merge`'s control `stop` (the failure guard, or a failed child left unparked) stops the run: that child is collected, nothing new starts, and every child still in flight is collected before the run ends as `stop`. The offer `run:merge` passes through is never read, so its `stop` after a merge is decided by `backlog:offer` on the next pass, as after any other. A drained backlog yields for the retrospective only when `JOSH_RETROSPECTIVE` is on (the same switch `run:step` reads, loaded from `.env`); with the switch off, or once the retrospective has run, the idle watch continues and a drained `stop` ends the run itself. Named issues are dispatched in their recorded order; `--only` reports and ends after the list. On restart, only lanes with a launch event from this invocation are adopted. A merge is counted once per Issue in the carry record, including when the process stops between counting and the merge event. Launches pass `--stash` while the `josh latest` stash exists.

## `josh review:round2` in detail

`skip` on **Arm A** (the fix delta is empty) or Arm B (every path in the fix delta is inert by [`josh review:brief --level-only`](../josh-commands-backlog.md#josh-reviewbrief)'s classification, `docs/**/*.md`, the root `README.md`, under `prompts/`, or a `.ts` / `.js` / `.svelte` file outside `.claude/` whose only change is in comments); `required` for anything else, including a missing `--round-1-closed`, a missing round-1 snapshot, a snapshot against a different change base, and one path outside Arm B. Full reasoning: `prompts/review.md`.

## `josh review:attest` in detail

Answers: `ok` (attested the briefed checkout), `missing` (a brief was recorded and nothing attested it — a refusal, not a pass), `mismatch` (a different root, branch or HEAD), `not-required` (no brief recorded in this checkout inside a run's lifetime). All three fields are checked; scoped to a checkout that briefed a review, expiring after eight hours. An `ok` is still refused on a person's issue update unread or taken in after the brief ([`josh issue:ack`](../josh-commands-backlog.md#josh-issueack)).

## `josh fanout` in detail

**File-disjointness is the necessary condition, and it is mechanical.** Two subagents editing one file in parallel race on it — the later write lands on the earlier, or the gate has to reconcile a collision the parallelism was meant to save. So the split is refused the moment any file appears in more than one unit, and the naming of what collides is on stderr. The default is serial: fewer than two units is nothing to run in parallel, and an Issue whose units share files stays serial exactly as one that will not split does.

4. The main line keeps the design that decided _what_ to write, integrates the returned edits, and runs the one `pnpm josh gate` and `/code-review` over the whole. That gate and review — which the parent runs anyway — is the row's verifier: a unit's mistake fails the same backstop a serial edit passes through, and the disjointness `josh fanout` confirmed keeps two units from colliding on a file. The design stays in the main line, which is why `design` is rejected while the writing is delegated.

## `josh split:assess` in detail

`split` needs **both** the file guide (10) and the line guide (400) exceeded; either alone, or an empty diff, is `single` — the conservative default of `.claude/skills/workflow-commands/split-assessment.md` → "The question". It answers the size question only: separability stays a judgement, so `split` is the size condition met, not a decision to divide the Issue. Untracked files have no diff base — commit before measuring for an exact count.

## `josh oracle:list` in detail

Print the decision oracles — commands that answer a rule question from mechanically readable inputs alone (question 0 of the rule-placement criterion, `prompts/collaboration-workflow/residency.md` → "第 0 問"). Each row carries the command, its answer vocabulary, its **firing point** (or the reason none can be named) and its single-source document. Adding a new oracle means adding a row here and a firing-point declaration in `scripts/rules/oracle-firing.ts`, and nowhere else.

- The firing point is what makes an oracle enforced. A declared firing point — the action the oracle must precede — wires a generic `oracle-consulted` delivered rule that refuses that action until the oracle's command has run (`scripts/rules/oracle-consulted.ts`). One is wired: `pkg:scout` (a package add). `issue:lint` no longer has one — [`josh issue:file`](../josh-commands-backlog.md#josh-issuefile) runs the lint as a filing step. `release:scope` is on the reason side, not a firing point: it reads the release owed _after_ `pnpm josh followup` merges, so it trails the merge rather than gating it. The rest declare why no firing point can be named and stay visibly unenforced rather than silently so, so a new oracle must always answer whether it has a firing point.

## `josh cases` in detail

Read changed paths and print the I/O boundaries the diff crosses (`network` / `process` / `fs` / `none`) and, for each, the mandatory abnormal cases a test declaration must account for (non-200, timeout, empty response, malformed JSON, rate limit). A decision oracle: the unit suite blocks network by design, so these cases are confronted at declaration time. Single source: `scripts/cases/cases-cli.ts`.
