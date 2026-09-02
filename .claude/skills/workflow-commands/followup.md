# Finishing a run — `pnpm josh followup`

Everything between a green CI and a merged PR: what `followup` scans for, the two gates that stop
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
| `--coderabbit-ignore-reason` | The reason comment for leaving CodeRabbit line comments unresolved |
| `--ai-review-ignore-reason` | The reason comment for leaving an AI-review blocker (Claude Review / a CodeRabbit summary) unresolved |
| `--issue-number` | The Issue number — or give it positionally as `"<title> #<number>"` |

Example 1 — the basic form (`fullrun` includes the merge):

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
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
  --merge \
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
  --merge \
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

## Config file update check (during `pnpm josh followup`)

After CI status checks complete during `pnpm josh followup`, inspect `git diff main...HEAD` to determine whether the PR contains changes to files managed and distributed by `josh sync` (e.g., `playwright.config.ts`, `.github/workflows/ci.yml`). If any managed config file was updated, stop before making any subsequent commit and send a `confirmation` Telegram notification:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'CI status check indicates a managed config file was updated\nPlease review the changes before proceeding'
```

- Do not make any follow-up commit, fix, or proceed to merge until the user explicitly confirms
- This check runs independently of AI reviewer comment scanning — both may trigger in the same workflow run

## `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup --merge`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. The user does **not** need to add a keyword. Invoking `fullrun` is itself the explicit authorization to merge.

```bash
pnpm josh followup "<title> #<N>" --merge --notify-message "..."
pnpm josh ms
```

- **Always run `pnpm josh ms` after a successful merge.** `pnpm josh followup --merge` leaves the working tree on the merged feature branch; running `pnpm josh ms` (= checkout default branch + `git pull`) returns it to the default branch with the merge commit pulled. `fullrun` / `fullrun new` / `queue` always end on the default branch. Skip this step only if the merge itself failed (the workflow already stopped).
- **AI review findings are checked automatically.** `pnpm josh followup --merge` scans for CodeRabbit / Claude Review findings before merging. If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run `pnpm josh followup --merge`. **Green CI is not authorization to merge while AI review findings are open.** (SonarCloud findings are **not** scanned by `followup` the way CodeRabbit / Claude comments are. Instead the `sonar-qube.yml` CI workflow runs the scan with `sonar.qualitygate.wait=true`, so a red Quality Gate fails the required `SonarQube` check — which `followup` already waits on before merging.)
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

- Applies to the initial PR and every follow-up commit (CodeRabbit fixes, re-review iterations, merges from main, etc.) — re-run `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"` each time you want to notify completion (notification is sent right before the merge).
- `pnpm josh notify` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications (no automated alternative exists for those).
- **Project version is surfaced at completion.** When `pnpm josh followup` finishes, it prints the consumer project's version as the final console line (`📦 project version: <v>`, read from the project's own `package.json` — the value `josh bump` increments, **not** the kit tool's version) and includes the same line in the `completion` Telegram body. The just-shipped version is therefore visible at the end of every completed `fullrun` / `queue`. Surface it as the closing line of your completion summary.
