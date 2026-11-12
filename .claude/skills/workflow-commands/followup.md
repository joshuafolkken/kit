# Finishing a run — `pnpm josh followup`

Everything between a green CI and a merged PR: the command, the merge it authorizes, the notifications,
the reviewer scan, the config report and the release ask. `fullrun` and `backlogrun` end here; `halfrun`
stops before the commit.

## Run `pnpm josh followup`

After `pnpm josh git` and required review dispositions, run:

```bash
pnpm josh followup "<title> #<N>" --notify-message-file .josh/tmp/report.md
```

Write the report in the session language; use the shape and file option in "The options" below.

It waits for required CI, checks CodeRabbit and top-level AI review comments, sends the completion
Telegram, merges by default, posts the Issue report, closes completed epics, removes `in-progress`,
and releases the hold. `--no-merge` stops the merge; `--merge` is a deprecated no-op. **A pull
request already merged by hand** (a `prrun` stop) runs only the post-merge tail; a report already on the
Issue is not posted twice, so re-running is safe. Keep the default Issue target. Ignore a finding only
after verifying it is inapplicable; rate-limit text is not a finding.

**A PR changing `.github/workflows/**` (adds, deletes, either side of a rename) waits for a human
merge.** Once CI is green, `followup` leaves it open, labels its Issue `needs-human-merge`, prints the
PR URL and exits 0 with no completion report; red CI fails as usual. Read the diff on GitHub and merge
there; `--merge` cannot bypass this stop. Re-run `followup` after merging to finish the tail.

**A rate-limited CodeRabbit check is cleared by a retrigger, never a bypass** (Tier C). `followup`
waits out each window (≤30 min), posts `@coderabbitai review` ≤3 times per PR, then asks for
`run:stalled`. On its no-retrigger note, do so and rerun it.

A pre-merge failure stops the run; an unverifiable AI finding or CI failure needing input sends a
`confirmation` Telegram. A post-merge cleanup failure is named and does not undo the merge; run the
named recovery without rerunning `followup`. The printed result is authoritative.

A CI job red only on tests outside the change → `followup` reruns it once, after ship's main merge
when main moved a failed test (`scripts/followup/followup-main-move.ts`).

After the merge `run:tail` returns to the default branch — `ship` runs it; after a bare `followup`, run
`pnpm josh run:tail <N>`. In a lane the parent uses `pnpm josh lane:close <N>`. Never delete the branch unless requested.

## The options

| Option | What it is |
| --- | --- |
| `--no-merge` | **The only flag that stops the merge** |
| `--notify-target` | `pr` \| `issue` \| `both`, default `issue`. **Keep the default** |
| `--notify-message` / `--notify-message-file` | The completion comment in the two-layer shape — `Cause: / Fix: / Result:`, then `Details:` bullets, never a bare `Added … / Changed …` list. **Use the file form whenever the report names a command or a path** (`prompts/collaboration-workflow/shell-body.md`); `-` reads stdin |
| `--coderabbit-ignore-reason` | Why CodeRabbit line comments stay unresolved |
| `--ai-review-ignore-reason` | Why an AI-review blocker (Claude Review / a CodeRabbit summary) stays unresolved |
| `--issue-number` | The Issue number — or positionally as `"<title> #<number>"`; with neither, the PR body's `closes #N` |

## `auto-merge` — Default `fullrun` behavior

Invoking `fullrun` is itself the explicit authorization to merge.

- **Green CI is not authorization to merge while AI review findings are open.** A blocker sends a
  `confirmation` Telegram and exits non-zero — fix and re-run. SonarCloud is carried by the required
  `SonarQube` check.
- **Verify a CodeRabbit finding before bypassing it.** Never pass `--coderabbit-ignore-reason`
  reflexively: a SHA pin flagged "not matching the tag" is checked with `pnpm josh pin:verify
  <owner/repo> <tag> <sha>`; bypass only on `match`, citing its printed line.
- **The merge is `followup`'s, not yours** — `.claude/settings.json` refuses `gh pr merge` and its
  `gh api` spellings (`operating-rules.md` → "git-rules"). Do **not** pass `--delete-branch` unless asked.
- **A failed merge** (branch protection, a conflict) is reported and stops the run — never retried with
  other flags. To skip the merge, use `kickoff` or say "do not merge" in the same turn and pass
  `--no-merge`.

## Completion notifications: always via `pnpm josh followup`

**Never send a `completion` Telegram with `pnpm josh notify`** — `followup` fills in the PR URL.
`pnpm josh notify` stays the tool for `planning`, `confirmation`, `kickoff_retry` and `failure`. **It
fires before the merge**, so a ✅ is not proof the PR merged — read what the command printed.

**Always run it in the foreground** — the exception to `background-commands.md`. The CI wait defaults
to 32 minutes; give the call the largest timeout it accepts (`timeout: 600000` in Claude Code). Where the
harness detaches the call, wait for its report; where it kills it, set `JOSH_CI_TIMEOUT_SECONDS` and
re-run once CI has settled. Re-run after every follow-up commit.

In a lane, the detached ship supervisor runs it, not the child — its merge wait holds no lane
place: `scripts/backlog/backlog-occupied.ts`.

**The count of unreleased merges is surfaced at completion — not a version.** It prints `🚚 unreleased
merges on main: <n>`. **Do not report a shipped version** — a child no longer bumps. See "When `pnpm
josh release` runs" below.

A `failure` Telegram is sent **by hand, exactly once**, and only when recovery is given up:

```bash
pnpm josh notify --task-type failure --issue-url "<issue-url>" --body-file .josh/tmp/failure.md
```

## What the output means

**A standing AI-review blocker** is fixed, or passed with `--ai-review-ignore-reason` once verified
inapplicable. The stage-timing block, the blocker shapes and the config-claim report:
`docs/josh-commands-automation.md` → "`josh followup`" and its detail document.

## When `pnpm josh release` runs

**The release point is a position plus a command's answer, never a judgement.** **The position: once
per invocation, after the last merge** — a lone `fullrun`'s only one, a `backlogrun`'s **last** child.
With lanes the parent asks it, in the primary checkout, after the last lane is closed.

```bash
pnpm josh release:scope          # → required | skip | unknown
```

| It answers | What it means                                                    | What the run does                                                                 |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed | Close the completion report with the `request:` line it prints                   |
| `skip`     | the count is zero — nothing is waiting to ship                   | Say so in one line and finish                                                     |
| `unknown`  | the count could not be read                                      | **Report it as `unknown`** — it is never read as `skip`                           |

**The run never types `pnpm josh release` itself** — it starts the tag → publish → `production` chain,
outward-facing and effectively irreversible, so Tier C. A person types it in the primary checkout, on
the default branch, with a clean tree.

**On `required`, it prints `release_issue: [#N](url)|none|unknown` and the `request:` line** — citing the
open release Issue `issue:release <N>` links blockers to, or naming `pnpm josh release` alone.
