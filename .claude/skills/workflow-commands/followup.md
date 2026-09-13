# Finishing a run — `pnpm josh followup`

Everything between a green CI and a merged PR: what `followup` scans for, the gate that stops a run,
how auto-merge is authorized, and the Telegram notifications. `fullrun` and `queue` both end here;
`halfrun` never reaches this file, because it stops before the commit.

This file is the single source of the rule.

## Where it sits — Step 5, after `pnpm josh git`

`pnpm josh followup` is a **separate script run after `pnpm josh git`**, not a stage inside it. The
commit and the pull request come first; this is everything after them.

What one invocation does, in order:

- **Waits for the CI status checks — the required ones only.** A non-required check (CodeQL, Workers
  Builds) is never waited on. A non-required check that failed is still reported to the user
  (`prompts/collaboration-workflow/operating-rules.md` → "CI チェック失敗時の対応").
- **Checks unresolved CodeRabbit line comments**, posting the ignore-reason comment when one is
  supplied.
- **Scans the AI reviewers' top-level comments** — run independently of CI status.
- **Sends the `completion` Telegram (✅) itself**, once every gate above has passed. A CI failure or an
  exception is re-thrown as-is with **no** Telegram sent — so a silent run is a failed run. **It fires
  before the merge, not after it**: a merge rejected by branch protection or a conflict leaves the ✅
  already sent, so never read a received completion Telegram as proof the pull request merged — read
  what the command printed.
- **Merges** — unless `--no-merge` was passed. **Merging is the default**, and `--merge` is a
  deprecated no-op. `--no-merge` is the only thing that stops it.
- **Posts the completion report to the Issue**, after the merge: it edits the Issue body when the body
  is empty, and adds a comment when it already has content. The report never goes to the pull request.
  A run that stopped at the merge therefore has no Issue comment, and the missing comment is what a
  failed merge looks like from GitHub.
- **Closes the epics the Issue completes**, on a merged run only.
- **Takes the `in-progress` label back off the Issue**, on a merged run only. A run that merged nothing
  keeps it. The removal reads the Issue's labels and sends back the spelling GitHub stored, so an
  `In-Progress` repository is not missed, and an Issue that never carried the label is never written to.
- **Nothing after the merge can end the run.** Once the pull request has merged, every remaining step —
  the Issue comment, the epic close, the run report, the review records and the working-tree hold
  release — runs on its own: one that fails is reported by name, with the command that finishes it by
  hand where one exists (`pnpm josh run:release --force` for the hold; `gh pr comment` or `gh api …
  /comments` for the completion report). Before the merge nothing changes: a failure there still ends
  the run, because re-running the command is the whole recovery. **A reported cleanup failure is not a
  merge failure**: read the ⚠ lines, run what they name, and do not re-run the merge.
- **Recovers the issue number from the pull request body** when the invocation named none: the `closes
  #N` keyword supplies it.
- **Emits the run report and appends it to `.time-history.jsonl`**, on a merged run only. It measures
  nothing of its own — the report is the same block `josh time` builds (elapsed, turns, round trips,
  the per-round-trip cost, and the same figures against the previous recorded run). The record is
  looked up from where the run happened and appended to the durable checkout. **It cannot fail a run**:
  a history that cannot be read or written prints one line saying the measurement was unavailable,
  names the `pnpm josh time --issue <N>` that would take it, and sends that same fact as a `warning`
  Telegram (⚠️). The warning is not a `failure`: the run merged, and only its measurement did not land.
  **It never fires for a history that was switched off** — `JOSH_TIME_HISTORY=0` turns the whole step
  off. `pnpm josh time --period <days>` reads the accumulation back.

### The post-execution reference is in `followup-reference.md`

Everything the run reaches **after** it issues `pnpm josh followup` is in `followup-reference.md`, so
the read that lands in the turn that issues the command stays small: the per-stage timing block the
command prints and how to read it, the `failure` Telegram sent by hand when recovery is given up, the
AI-reviewer comment scan, the config-file report, and the release ask that closes the completion
summary. What stays below is what a run needs **before** it issues the command.

### The options

| Option | What it is |
| --- | --- |
| `--no-merge` | **The only flag that stops the merge.** Merging is the default; `--merge` is a deprecated no-op |
| `--notify-target` | `pr` \| `issue` \| `both`, defaulting to `issue`. **Keep the default** — the workflow puts no completion report on the pull request |
| `--notify-message` | The completion comment body, in the `JOSH_SESSION_LANG` language (`ja` when unset), in the two-layer report shape: three lines of `Cause: / Fix: / Result:` first, one plain sentence each with no jargon or file names, then the changes as bullets under `Details:`. **Not a bare list of `Added … / Changed …`** |
| `--notify-message-file` | The same body, read from a file (`-` reads stdin). **Use it whenever the report names a command or a path** — inside shell double quotes a backtick or a `$` is evaluated before this command starts (`prompts/collaboration-workflow/shell-body.md`) |
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
decoration**: leave it out and this command merges.

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

## `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup`, which handles the full sequence
internally: wait for CI → verify AI review findings → send completion notification → merge. The user
does **not** need to add a keyword. Invoking `fullrun` is itself the explicit authorization to merge.

```bash
pnpm josh followup "<title> #<N>" --notify-message "..."
pnpm josh ms
```

- **Always run `pnpm josh ms` after a successful merge.** `pnpm josh followup` leaves the working tree
  on the merged feature branch; `pnpm josh ms` (checkout default branch + `git pull`) returns it to the
  default branch with the merge commit pulled. Skip this step only if the merge itself failed.
- **In a lane, the terminal step is `pnpm josh lane:close <N>` instead, and `josh ms` refuses.** A lane
  is a linked work tree, and git allows one branch in one work tree at a time. `josh ms` exits non-zero
  there and says so, which is the expected answer. The default-branch refresh is the parent's, in the
  primary checkout.
- **AI review findings are checked automatically.** `pnpm josh followup` scans for CodeRabbit / Claude
  Review findings before merging. If blockers are found, it sends a `confirmation` Telegram and exits
  non-zero — fix the findings and re-run. **Green CI is not authorization to merge while AI review
  findings are open.** (SonarCloud findings are not scanned by `followup`; the `sonar-qube.yml` CI
  workflow runs the scan with `sonar.qualitygate.wait=true`, so a red Quality Gate fails the required
  `SonarQube` check, which `followup` waits on.)
- **CodeRabbit rate-limit is not a finding.** If the only CodeRabbit comment is a rate-limit warning
  (`rate limited by coderabbit.ai` or `Rate limit exceeded`) and there is no substantive review, treat
  it as "no findings" and proceed. Same if CodeRabbit produced no comment on the latest commit.
- **Verify CodeRabbit findings before bypassing.** Do not pass `--coderabbit-ignore-reason` reflexively
  — first verify. Example: CodeRabbit may flag a GitHub Actions SHA pin like `pnpm/action-setup@<sha> #
  v6.0.8` as "not matching the tag" because it queried the annotated-tag-object SHA, not the commit
  SHA. Confirm with `gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` — if that matches the
  pinned SHA, the finding is a false positive. Only then bypass, citing the verification command.
- Merge goes through REST internally — the pull request's own merge endpoint with an explicit
  `merge_method` (`gh pr merge` goes through GraphQL, which a cloud session is refused). **That path is
  `followup`'s, not yours**: `.claude/settings.json` refuses `gh pr merge` and the `gh api` / `gh api
  graphql` spellings of the same merge; `followup` calls gh from inside a node script. The prohibition
  in `CLAUDE.md` → "Git Rules" is the rule.
- Use the merge strategy the repo allows (`--merge` / `--squash` / `--rebase`); default to `--merge`.
  Inspect with `gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge,
  allow_rebase_merge}'` when unsure.
- Do **not** pass `--delete-branch` unless the user asks.
- If the merge fails (branch protections, conflicts), report the reason and stop — do not retry with
  different flags or bypass protections.
- **If the user wants to skip the merge step**, use `kickoff` or say "do not merge" in the same turn,
  and pass `--no-merge`. Outside a `fullrun` invocation, never run `gh pr merge` on your own.

## Completion notifications: always via `pnpm josh followup`

Never send `completion` Telegram notifications manually with `pnpm josh notify --task-type completion
...`. Always use `pnpm josh followup` — it fetches the PR URL through REST
(`repos/{owner}/{repo}/pulls/{N}`) and always includes it, whereas the manual CLI does not
auto-populate `--pr-url`.

**Always run `pnpm josh followup` in the foreground** (no `&`, no shell backgrounding). **It is the
deliberate exception to `background-commands.md`**: nearly every step after it reads its result, so
detaching it would buy an empty turn. It waits for CI — 32 minutes by default, about 34 worst case —
which can outlast one tool call, so give the call the largest timeout it accepts (in Claude Code,
`timeout: 600000`). Where the harness detaches an over-running command and reports when it finishes,
wait for that report instead of re-running. Where it kills the call at the cap, set `JOSH_CI_TIMEOUT_SECONDS`
to a budget that fits inside the cap and re-run once CI has settled. Shell backgrounding never works.

- Applies to the initial PR and every follow-up commit — re-run `pnpm josh followup "<title> #<N>"
  --notify-message "..."` each time you want to notify completion (notification is sent right before
  the merge).
- `pnpm josh notify` remains the right tool for `planning`, `confirmation`, `kickoff_retry` and
  `failure` notifications.
- **The count of unreleased merges is surfaced at completion — not a version.** When `pnpm josh
  followup` finishes it prints `🚚 unreleased merges on main: <n>` and puts the same count in the
  `completion` Telegram body. **Do not report a shipped version**: a child no longer bumps, so
  `package.json` names the *previous* release, and what ships is decided later by `pnpm josh release`.
  What the run *does* about it is `followup-reference.md` → "When `pnpm josh release` runs".
