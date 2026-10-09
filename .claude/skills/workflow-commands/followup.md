# Finishing a run — `pnpm josh followup`

Everything between a green CI and a merged PR: the command, the merge it authorizes, the notifications,
the reviewer scan, the config report and the release ask. `fullrun` and `backlogrun` end here;
`halfrun` never reaches this file, because it stops before the commit. This file is the single source
of the rule. Where each rule came from: `docs/maintainers/followup-rationale.md` → "Where each rule
came from".

## Run `pnpm josh followup`

Run it in the foreground after `pnpm josh git` and after every required review disposition:

```bash
pnpm josh followup "<title> #<N>" --notify-message-file <report-file>
```

The report uses the session language: plain `Cause:`, `Fix:` and `Result:` lines, then `Details:`
bullets. Use the file option whenever it contains a command or path.

It waits for required CI, checks CodeRabbit and top-level AI review comments, sends the completion
Telegram, merges by default, posts the Issue report, closes completed epics, removes `in-progress`,
and releases the hold. Only `--no-merge` stops the merge; `--merge` is a deprecated no-op. **A pull
request already merged by hand** (a `prrun` stop) skips the CI wait, the AI review scan and the merge
and runs only the post-merge tail; a completion report already on the Issue is not posted or notified
twice, so re-running is safe. Keep the default Issue target. Ignore a finding only after verifying it
is inapplicable; rate-limit text is not a finding.

**A red rate-limited CodeRabbit check is cleared by a retrigger, not a bypass.** Wait out the window
the rate-limit comment states, post `@coderabbitai review` on the pull request, and rerun `followup`.
Bypassing the check is Tier C — only on explicit user instruction, and only when the stated window is
impractically long or the retrigger is rate-limited again.

A pre-merge failure stops the run; an unverifiable AI finding or CI failure needing input receives a
`confirmation` Telegram. Post-merge cleanup failures are named and do not undo the merge; run the
named recovery without rerunning it. Because notification precedes merge, the printed result is
authoritative.

After success, run `pnpm josh ms`; in a lane its refusal is expected and the parent uses
`pnpm josh lane:close <N>`. Never delete the branch unless requested. The sections below are read
after execution, when its output needs reading.

## The options

| Option | What it is |
| --- | --- |
| `--no-merge` | **The only flag that stops the merge** — leave it out and the command merges |
| `--notify-target` | `pr` \| `issue` \| `both`, defaulting to `issue`. **Keep the default** — the workflow puts no completion report on the pull request |
| `--notify-message` / `--notify-message-file` | The completion comment body in the two-layer report shape — `Cause: / Fix: / Result:`, then `Details:` bullets, never a bare `Added … / Changed …` list. **Use the file form whenever the report names a command or a path** (`prompts/collaboration-workflow/shell-body.md`); `-` reads stdin |
| `--coderabbit-ignore-reason` | The reason comment for leaving CodeRabbit line comments unresolved |
| `--ai-review-ignore-reason` | The reason comment for leaving an AI-review blocker (Claude Review / a CodeRabbit summary) unresolved |
| `--issue-number` | The Issue number — or give it positionally as `"<title> #<number>"`; with neither, the PR body's `closes #N` supplies it |

## `auto-merge` — Default `fullrun` behavior

Invoking `fullrun` is itself the explicit authorization to merge; the user adds no keyword.

- **Always run `pnpm josh ms` after a successful merge** — it returns the tree to the default branch
  with the merge commit pulled. **In a lane, `pnpm josh lane:close <N>` is the terminal step instead**:
  `josh ms` refuses there, and the refresh is the parent's.
- **Green CI is not authorization to merge while AI review findings are open.** On a blocker
  `followup` sends a `confirmation` Telegram and exits non-zero — fix and re-run. SonarCloud is not
  scanned here; the required `SonarQube` check carries it.
- **Verify a CodeRabbit finding before bypassing it.** Never pass `--coderabbit-ignore-reason`
  reflexively: a SHA pin flagged "not matching the tag" is checked with `gh api
  repos/<owner>/<repo>/commits/<tag> --jq '.sha'`, and the bypass cites that command.
- **The merge is `followup`'s, not yours** — it calls the REST merge endpoint from inside a node
  script, and `.claude/settings.json` refuses `gh pr merge` and its `gh api` spellings (`CLAUDE.md` →
  "Git Rules"). Do **not** pass `--delete-branch` unless the user asks.
- **A failed merge** (branch protection, a conflict) is reported and stops the run — never retried with
  other flags or past a protection. To skip the merge, use `kickoff` or say "do not merge" in the same
  turn and pass `--no-merge`.

## Completion notifications: always via `pnpm josh followup`

**Never send a `completion` Telegram with `pnpm josh notify`** — `followup` sends it with the PR URL,
which the manual CLI does not fill in. `pnpm josh notify` stays the tool for `planning`,
`confirmation`, `kickoff_retry` and `failure`. **It fires before the merge**, so a received ✅ is not
proof the PR merged — read what the command printed; a silent run is a failed run.

**Always run it in the foreground** — the deliberate exception to `background-commands.md`, because
nearly every later step reads its result. The CI wait defaults to 32 minutes, so give the call the
largest timeout it accepts (`timeout: 600000` in Claude Code). Where the harness detaches an
over-running command, wait for its report; where it kills the call, set `JOSH_CI_TIMEOUT_SECONDS` to fit
and re-run once CI has settled. Re-run it after every follow-up commit.

**The count of unreleased merges is surfaced at completion — not a version.** It prints `🚚 unreleased
merges on main: <n>` and puts the count in the Telegram. **Do not report a shipped version**: a child
no longer bumps, so `package.json` names the previous release. What the run does about it is "When
`pnpm josh release` runs" below.

## Reading the stage-timing block

The command closes with one `followup stage: <name> <seconds>` row per stage and a
`followup stages total:` line, so where it spent its time is read, not guessed.

- **A failed run prints it too**, up to the stage that threw, named `interrupted` — a short block is
  the run stopping early, not the printer breaking. The `merge` row appears only on a run that merged.
- **A row named `<a>-and-<b>` is a batch of requests sent together**; `checks-wait` is never
  overlapped, because it is the merge gate.
- **The total is the sum of the stages**, not the wall clock — the post-merge tail (record clears, the
  hold release, the next-issue listing) sits outside it.

A `failure` Telegram is sent **by hand, exactly once**, and only when recovery is given up:

```bash
pnpm josh notify --task-type failure --issue-url "<issue-url>" --body-file <reason-file>
```

## AI reviewer comment scan

`followup` scans top-level PR comments from AI reviewers **independently of CI status**, so a finding
posted after CI goes green is not silently shipped.

- **Blockers are structural, not NLP**: a Claude Review body with `### Issues`, `### Problem`,
  `#### Logic bug` or a numbered `### 1. …` heading; a CodeRabbit `Actionable comments posted: N` with
  N > 0. Rate-limit notices and sign-offs (`All issues resolved ✓`) match nothing.
- **A standing blocker without `--ai-review-ignore-reason`** sends a `confirmation` Telegram and exits
  non-zero; with it, the reason is posted to the PR and the run proceeds.
- **A comment listing that could not be read is a standing blocker** — never an empty listing that
  passes.
- **Temporary**: CodeRabbit is non-blocking end to end — out of the default required checks
  (restore via `JOSH_REQUIRED_CHECKS`), its actionable count and unreadable line-comment listing are
  audit notes rather than blockers. When it is reverted:
  `docs/maintainers/followup-rationale.md` → "The temporary CodeRabbit exemption".

## Config file reporting

`followup` matches every changed path against what `josh sync` distributes (`AI_COPY_FILES`,
`AI_COPY_FILE_MAPPINGS`, `AI_COPY_DIRECTORIES`, `SYNCED_PATHS`) and **reports** the claimed paths in the
completion notification and the Issue report. **It stops nothing**
(`docs/maintainers/followup-rationale.md` → "Why config claims are reported, not stopped").
`pnpm josh sync:scope` gives the same answer on demand; there is no flag to pass.

## When `pnpm josh release` runs

**The release point is a position plus a command's answer, never a judgement.**

**The position: once per invocation, after the last merge** — a lone `fullrun`'s only one, a
`backlogrun`'s **last** child, never once per child. In a lane the parent asks it, in the primary
checkout, after the last lane is closed.

```bash
pnpm josh release:scope          # → required | skip | unknown
```

| It answers | What it means                                                    | What the run does                                                                 |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed | Close the completion report with the release request, naming `pnpm josh release` |
| `skip`     | the count is zero — nothing is waiting to ship                   | Say so in one line and finish                                                     |
| `unknown`  | the count could not be read                                      | **Report it as `unknown`** — it is never read as `skip`                           |

**The run never types `pnpm josh release` itself.** It opens and merges a PR of its own and starts
the tag → publish → `production` chain — outward-facing and effectively irreversible, so Tier C.
Typing `fullrun` authorizes this Issue's merge and nothing past it; a person types the release in the
primary checkout, on the default branch, with a clean tree. `release:scope` counts nothing of its own —
it reads the same fetch-then-count `followup` uses for the Telegram line, so the two cannot disagree.

**On `required`, the release request cites the open release Issue** — the one `issue:file --release` / `issue:release <N>` links blockers to — with a number-link
(`prompts/collaboration-workflow/issue-citation.md`). List it with
`gh api 'repos/{owner}/{repo}/issues?labels=release&state=open' --jq '.[].number'`; when none is
open, the request names `pnpm josh release` alone.
