# Finishing a run — `pnpm josh followup`

Everything between a green CI and a merged PR: what `followup` scans for, the gate that stops
a run, how auto-merge is authorized, and the Telegram notifications. `fullrun` and `queue` both end
here; `halfrun` never reaches this file, because it stops before the commit.

This file is the single source of the rule. `prompts/collaboration-workflow/completion-notify.md` is
a pointer to it (joshuafolkken/kit#1187 rollout of the joshuafolkken/kit#1174 pattern), and the two
sections it also replaced — "Auto-merge（default for `fullrun`）" and "`completion` 通知は
`pnpm josh followup` 経由のみ" — were cut out of
`prompts/collaboration-workflow/operating-rules.md`, which keeps its other operating rules and is
still cited for them.

## Where it sits — Step 5, after `pnpm josh git`

`pnpm josh followup` is a **separate script run after `pnpm josh git`**, not a stage inside it. The
commit and the pull request come first; this is everything after them.

What one invocation does, in order:

- **Waits for the CI status checks — the required ones only.** A non-required check (CodeQL, Workers
  Builds) is never waited on, so a run does not hang on a check that cannot block the merge. **A
  non-required check that failed is still reported to the user**, per
  `prompts/collaboration-workflow/operating-rules.md` → "CI チェック失敗時の対応", which stays there
  because it is about honest reporting rather than about this command.
- **Checks unresolved CodeRabbit line comments**, posting the ignore-reason comment when one is
  supplied.
- **Scans the AI reviewers' top-level comments** — the section below, run independently of CI status.
- **Sends the `completion` Telegram (✅) itself**, once every gate above has passed. A CI failure or
  an exception is re-thrown as-is with **no** Telegram sent — so a silent run is a failed run, never
  a quiet success. **It fires before the merge, not after it**: a merge rejected by a branch
  protection or a conflict leaves the ✅ already sent, so never read a received completion Telegram
  as proof the pull request merged. Read what the command printed.
- **Merges** — unless `--no-merge` was passed. **Merging is the default**, and `--merge` is a
  deprecated no-op kept for compatibility: passing nothing merges just the same. `--no-merge` is the
  only thing that stops it.
- **Posts the completion report to the Issue**, after the merge: it **edits the Issue body when the
  body is empty, and adds a comment when it already has content**. The report never goes to the pull
  request. A run that stopped at the merge therefore has no Issue comment, and the missing comment —
  not a missing Telegram — is what a failed merge looks like from GitHub.
- **Closes the epics the Issue completes**, on a merged run only.
- **Nothing after the merge can end the run** (joshuafolkken/kit#1539). Once the pull request has
  merged, every remaining step — the Issue comment, the epic close, the run report, the review
  records and the working-tree hold release — runs on its own: one that fails is **reported by name,
  with the command that finishes it by hand where one exists** — `pnpm josh run:release` for the
  hold, `gh pr comment` or `gh api … /comments` for the completion report, whichever the notify target
  named. The epic auto-close and the run report have
  no command of their own and name none, rather than pointing at one that only reports. The steps
  after a failure still run. Before the merge nothing
  changes: a failure there still ends the run, because nothing irreversible has happened and
  re-running the command is the whole recovery. **Three merged runs ended the other way** — #1197,
  #1537 and #1319 each threw at the Issue comment and left the hold behind, and the non-zero exit
  read to `epicrun` and `queue` as a failed child. **A reported cleanup failure is not a merge
  failure**: read the ⚠ lines, run what they name, and do not re-run the merge.
- **Recovers the issue number from the pull request body** when the invocation named none: the
  `closes #N` keyword the closes-and-context stage already reads is what supplies it, so a completion
  report, an epic close and a run report are still made for a run whose command line forgot the
  number.
- **Emits the run report and appends it to `.time-history.jsonl`**, on a merged run only
  (joshuafolkken/kit#1471). Until then the measurement only ever happened when a person typed `diag`,
  so a run nobody asked about left no record at all — and a measurement that is not continuous cannot
  say whether the last change made anything faster. Every `fullrun`, and every child of an `epicrun`
  or a `queue`, ends here, which is why this one seam covers all of them. **It measures nothing of its
  own**: the report is built by the same builder `josh time` calls, and what is printed is a short
  block — elapsed, turns, round trips, the per-round-trip cost, and the same figures against the
  previous recorded run. **It cannot fail a run**: the merge has already happened by the time it runs,
  so a history that cannot be read or written prints one line saying the measurement was unavailable
  and names the `pnpm josh time --issue <N>` that would take it. `JOSH_TIME_HISTORY=0` turns it off,
  and the full tables stay where they were — `pnpm josh time`, and the `diag` skill that reads them.
  **What reads the accumulation back is `pnpm josh time --period <days>`**
  (joshuafolkken/kit#1470): it groups the recorded runs into lanes by the wall clock they occupied and
  reports the backlog's throughput, idle time and serialization — the questions one run's internals
  cannot answer. That is why the record carries the run's `started_at` / `ended_at` as well as its
  headline figures.

### It prints how long each of those stages took

Since joshuafolkken/kit#1349 the command closes with one row per stage and a total, so "where did
`followup` spend its time" is read rather than guessed. The shape, with illustrative durations:

```
followup stage: closes-and-context        1.5 s
followup stage: checks-wait               28.4 s
followup stage: coderabbit-comments       1.3 s
followup stage: ai-review-comments        2.0 s
followup stage: telegram                  1.1 s
followup stage: merge                     2.6 s
followup stage: completion-and-epic-close 2.4 s
followup stages total:                    39.3 s
```

- **The block is printed on a failed run too**, up to and including the stage that threw, which is
  named `interrupted`. A `followup` that exits non-zero on an AI-review blocker or a red check is the
  invocation whose wait was longest, and one that printed nothing would leave the measurement blind to
  exactly those. **A short block there is the run stopping early, not the printer breaking**: the
  stages after the failure never ran, so they have no duration to report.
- **The `merge` row appears only on a run that merged**, so a `--no-merge` block is a row shorter.
- **Two rows say `and` because the requests behind them go out together** (joshuafolkken/kit#1446).
  `closes-and-context` is the former `closes-check` plus `context` — the pull request body, the
  repository name, the pull request URL and the issue title, four reads that need nothing from one
  another; `completion-and-epic-close` is the former `completion-comment` plus `epic-close`. A lap
  records an interval rather than a call, so a batch is one row, and the name is what says which
  stages it holds. **The one dependency inside the batch is kept**: with no issue number on the
  command line the title read waits for the body that names it, and only that read waits.
  **`checks-wait` is untouched**, which is the point — what was overlapped was never a wait.
- **The total is the sum of the stages, not the command's whole wall clock.** What sits outside it is
  the tail the workflow script prints afterwards — the next-issue listing and the version line — so a
  `pnpm josh time` reading of the same span is a second or two longer, and that gap is the tail.
- **What was measured is on joshuafolkken/kit#1349**, and cutting any of it is deliberately not this
  block's business: the required-check wait and the AI-review scan are the merge gate, and narrowing
  either to make a number smaller is the workaround `CLAUDE.md` prohibits.

A `failure` Telegram is sent **by hand, exactly once**, and only when the agent has finally given up
recovering — never once per retry:

```bash
pnpm josh notify --task-type failure --issue-url "<issue-url>" --body "<the reason and what is unresolved>"
```

### The options

| Option | What it is |
| --- | --- |
| `--no-merge` | **The only flag that stops the merge.** Merging is the default; `--merge` is a deprecated no-op |
| `--notify-target` | `pr` \| `issue` \| `both`, defaulting to `issue`. **Keep the default** — the workflow puts no completion report on the pull request |
| `--notify-message` | The completion comment body, in the `JOSH_SESSION_LANG` language (`ja` when unset), in the two-layer report shape: three lines of `Cause: / Fix: / Result:` first, one plain sentence each with no jargon or file names, then the changes as bullets under `Details:`. **Not a bare list of `Added … / Changed …`** |
| `--notify-message-file` | The same body, read from a file (`-` reads stdin). **Use it whenever the report names a command or a path** — a report that does is the ordinary case here, and inside shell double quotes a backtick or a `$` is evaluated before this command starts: joshuafolkken/kit#1198 recorded a completion body that reached Telegram with a word missing, and a comment body whose own words ran as git commands. No `\n` expansion happens to a file, which already holds real newlines; passing both flags is refused rather than ranked (`prompts/collaboration-workflow/shell-body.md`) |
| `--coderabbit-ignore-reason` | The reason comment for leaving CodeRabbit line comments unresolved |
| `--ai-review-ignore-reason` | The reason comment for leaving an AI-review blocker (Claude Review / a CodeRabbit summary) unresolved |
| `--issue-number` | The Issue number — or give it positionally as `"<title> #<number>"` |

Example 1 — the basic form (`fullrun` includes the merge):

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>
Cause: <why this was needed, in one plain sentence>
Fix: <what was changed, in one plain sentence>
Result: <what is different for the user now>

Details:
- Added ...
- Changed ..."
```

Example 2 — with a CodeRabbit ignore reason:

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --coderabbit-ignore-reason "<why the finding does not apply>"
```

Example 3 — with an AI-review (Claude Review) blocker ignore reason:

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --ai-review-ignore-reason "<tracked in issue #123>"
```

Example 4 — no merge (after a `kickoff`, or when the merge is done by hand). **`--no-merge` is not
decoration here**: leave it out and this command merges, because merging is what `followup` does
unless told otherwise.

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --no-merge \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ..."
```

## AI reviewer comment scan (automatic in `pnpm josh followup`)

`pnpm josh followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**. This scan runs after CI is green and after the existing CodeRabbit line-comment check. The goal is to ensure substantive findings posted by AI reviewers _after_ CI goes green are not silently shipped.

**Temporary (kit#753)**: while CodeRabbit reviews are slow, CodeRabbit is non-blocking end to end — it is excluded from the default required checks (restore via `JOSH_REQUIRED_CHECKS`), `Actionable comments posted: N` is downgraded to an informational log, and unresolved CodeRabbit line comments no longer require an ignore reason. Every skip is printed to the console and appended to the completion Telegram body. Claude Review blockers are unchanged. Revert together with kit#752.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices (`rate limited by coderabbit.ai` / `Rate limit exceeded`) and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm josh followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR (mirroring the CodeRabbit ignore-reason flow) and proceeds to completion.
- Acknowledgment-only Claude comments (`All issues resolved ✓`, `Everything else looks good`) do not match the blocker heuristics, so rounds where the AI reviewer explicitly signs off do not trigger a false positive.
- **A comment listing that could not be read is treated exactly like a standing blocker.** A rate limit, expired auth, a dropped connection — every one of them used to arrive as an empty listing, so the gate passed without having read anything (joshuafolkken/kit#973). `confirmation` Telegram, non-zero exit, re-run once the read succeeds. `--ai-review-ignore-reason` still gets past it, because what it means is unchanged: a person has looked — and the run then carries an audit note saying the scan was bypassed.
- **The CodeRabbit line-comment listing is the exception**: unreadable there is reported as an audit note rather than blocking, because kit#753 has CodeRabbit not blocking the merge at all. That reader also answers unreadable when the PR number itself would not resolve, which the top-level scan never has to do. Revert with kit#752.

## Config file reporting (inside `pnpm josh followup`)

**Nothing here asks you to compare anything by eye** (joshuafolkken/kit#1578). `pnpm josh followup` reads the tracked branch diff itself and matches every changed path against everything `josh sync` distributes — the three lists `AI_COPY_FILES`, `AI_COPY_FILE_MAPPINGS`, `AI_COPY_DIRECTORIES`, plus `SYNCED_PATHS`, the destinations `sync` writes directly (`playwright.config.ts`, `eslint.config.js`, the rest).

**It stops nothing** (joshuafolkken/kit#1592). What it produces is a report: the claimed paths and the list that claimed each one go into **the completion notification and the completion report on the Issue**, and the run continues to the CI wait and the merge exactly as a run that distributes nothing does. A run passing `--no-merge` is not reported on, because nothing has been distributed yet.

**It was a confirmation stop until joshuafolkken/kit#1592, and measurement is what removed it rather than preference.** In kit the condition is nearly always true, because kit is the distribution source: every change to `CLAUDE.md`, to `prompts/`, to `.claude/skills/` or to the distributed part of `docs/` is by definition a change to a distributed path. Measured on `epicrun #1413`, **two of three children stopped here** — and in both, the distributed file was the one that child's own acceptance criteria had ordered changed. The gate was not catching an unintended edit; it was stopping the work, and ending unattended execution until a person retyped one command.

**There is deliberately no branch on which repository this is.** Stopping in a consumer project — where editing a distributed file really is the mistake `CLAUDE.md` → "Route distributed-doc / config changes upstream to kit" names, since the next `josh sync` overwrites it silently — while staying quiet in kit was weighed and rejected on joshuafolkken/kit#1592: it needs a distribution-source test this package does not have, no case is recorded of the gate having saved a consumer's work, and the report below reaches a consumer's reader just as well.

**The matching itself is unchanged, and so is the reason it is mechanical.** The instruction the mechanical read replaced was skipped in two runs out of three on the day it was measured, and one of those two could not have succeeded by eye at all: `AI_COPY_DIRECTORIES` holds directories, so a distributed path such as `.claude/skills/workflow-commands/epicrun.md` appears in no list textually.

```bash
pnpm josh sync:scope    # managed | clean, naming which list claimed each path; alias: josh sys
```

- **There is no flag to pass and nothing to approve.** `--managed-config-ignore-reason` is gone with the stop it existed to get past.
- This report is produced independently of AI reviewer comment scanning, which still stops the run on a standing blocker

## `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. The user does **not** need to add a keyword. Invoking `fullrun` is itself the explicit authorization to merge.

```bash
pnpm josh followup "<title> #<N>" --notify-message "..."
pnpm josh ms
```

- **Always run `pnpm josh ms` after a successful merge.** `pnpm josh followup` leaves the working tree on the merged feature branch; running `pnpm josh ms` (= checkout default branch + `git pull`) returns it to the default branch with the merge commit pulled. `fullrun` / `fullrun new` / `queue` always end on the default branch. Skip this step only if the merge itself failed (the workflow already stopped).
- **In a lane, the terminal step is `pnpm josh lane:close <N>` instead, and `josh ms` refuses.** A lane is a linked work tree, and git allows one branch in one work tree at a time — checking the default branch out from a lane takes that lane out of `josh lane:list`, strands its port seat, and makes every other lane's `josh ms` fail with git's `already used by` refusal. `josh ms` therefore exits non-zero there and says so, which is the expected answer rather than a failure to recover from (joshuafolkken/kit#1535). The default-branch refresh is the parent's, in the primary checkout, exactly as `epicrun.md` already describes.
- **AI review findings are checked automatically.** `pnpm josh followup` scans for CodeRabbit / Claude Review findings before merging. If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run `pnpm josh followup`. **Green CI is not authorization to merge while AI review findings are open.** (SonarCloud findings are **not** scanned by `followup` the way CodeRabbit / Claude comments are. Instead the `sonar-qube.yml` CI workflow runs the scan with `sonar.qualitygate.wait=true`, so a red Quality Gate fails the required `SonarQube` check — which `followup` already waits on before merging.)
- **CodeRabbit rate-limit is not a finding.** If the only CodeRabbit comment is a rate-limit warning (body contains `rate limited by coderabbit.ai` or `Rate limit exceeded`) and there is no substantive review, treat it as "no findings" and proceed. The same applies if CodeRabbit produced no comment at all on the latest commit.
- **Verify CodeRabbit findings before bypassing.** When CodeRabbit posts a substantive finding, do not pass `--coderabbit-ignore-reason` reflexively — first verify whether the finding is correct. Concrete example: CodeRabbit may flag a GitHub Actions SHA pin like `pnpm/action-setup@<sha> # v6.0.8` as "not matching the tag", because it queried `gh api repos/<owner>/<repo>/git/ref/tags/v6.0.8` which returns the **annotated-tag-object SHA**, not the **commit SHA** that the tag points to. GitHub Actions pins use the commit SHA. Confirm with `gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` — if that matches the pinned SHA, the finding is a false positive. Only then bypass with `--coderabbit-ignore-reason "<verification-based-reason>"`, citing the verification command and its output.
- Merge goes through REST internally — the pull request's own merge endpoint with an explicit `merge_method`, a direct merge rather than GitHub's `--auto` flag (`gh pr merge` goes through GraphQL, which a cloud session is refused; joshuafolkken/kit#1029). All required checks are already green by this point. **That path is `followup`'s, not yours**: `.claude/settings.json` refuses `gh pr merge`, and since joshuafolkken/kit#1062 the `gh api` and `gh api graphql` spellings of the same merge as well — `followup` is unaffected because it calls gh from inside a node script, so the Bash matcher only ever sees `pnpm josh …`. The deny is the implementation; the prohibition in `CLAUDE.md` → "Git Rules" is the rule, and it is what covers any spelling the patterns still miss.
- Use the merge strategy the repo allows (`--merge` / `--squash` / `--rebase`). Default to `--merge`. Inspect with `gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` when unsure.
- Do **not** pass `--delete-branch` unless the user asks. Branch cleanup is a separate explicit instruction.
- If the merge fails (e.g. branch protections not met, conflicts), report the reason and stop — do not retry with different flags or bypass protections.
- **If the user wants to skip the merge step**, use `kickoff` (plan-only) or explicitly say "do not merge" / "do not auto-merge" in the same turn. In that case, pass `--no-merge` to `pnpm josh followup`. Outside a `fullrun` invocation, never run `gh pr merge` on your own.

The portable, cross-AI wording of this section used to sit in `prompts/collaboration-workflow/operating-rules.md` as well; it is single-sourced here now (joshuafolkken/kit#1187).

## Completion notifications: always via `pnpm josh followup`

Never send `completion` Telegram notifications manually with `pnpm josh notify --task-type completion ...`. Always use `pnpm josh followup` — it fetches the PR URL through REST (`repos/{owner}/{repo}/pulls/{N}`) and always includes it, whereas the manual CLI does not auto-populate `--pr-url` and will produce a Telegram message missing the PR link.

**Always run `pnpm josh followup` in the foreground** (no `&` suffix, no shell backgrounding). It waits for CI — 32 minutes by default, about 34 worst case (see `docs/josh-commands.md`) — which can outlast one tool call, so give the call the largest timeout it accepts (in Claude Code, `timeout: 600000`, 10 min). Where the harness detaches an over-running command and reports when it finishes, wait for that report instead of re-running. Where it kills the call at the cap instead, the merge and the completion notification are lost with it: set `JOSH_CI_TIMEOUT_SECONDS` to a budget that fits inside the cap for that run and re-run `followup` once CI has settled. Shell backgrounding never works — a process started with `&` inside a tool call does not survive the call returning, so the command silently disappears and the PR stays unmerged.

- Applies to the initial PR and every follow-up commit (CodeRabbit fixes, re-review iterations, merges from main, etc.) — re-run `pnpm josh followup "<title> #<N>" --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"` each time you want to notify completion (notification is sent right before the merge).
- `pnpm josh notify` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications (no automated alternative exists for those).
- **The count of unreleased merges is surfaced at completion — not a version.** When `pnpm josh followup` finishes it prints `🚚 unreleased merges on main: <n>` as the final console line and puts the same count in the `completion` Telegram body, so a release nobody has run stays visible (joshuafolkken/kit#1486). **Do not report a shipped version.** A child no longer bumps, so the project's `package.json` names the *previous* release rather than anything this run shipped, and what does ship is decided later by `pnpm josh release`. The Telegram is sent before the merge and says so; the console line is printed after it, from a freshly fetched default branch, and needs no such note. Surface the count as the closing line of your completion summary.
