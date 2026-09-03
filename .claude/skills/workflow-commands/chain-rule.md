# `/code-review` → `followup --merge` chain rule (MANDATORY)

Within `fullrun` / `fullrun new` / `queue`, the `/code-review` skill output is **not** a turn boundary. The skill returns a polished Markdown review with sections, severity-tagged findings, and a final recommendation — this is an intermediate step, not a finished deliverable.

**`fullrun` STOPPING CONDITIONS** (the chain ends only here):

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch** — normal end state, report the PR URL and stop.
2. **A genuine blocker requires user judgment** — exactly three count:
   - A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive.
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   When a blocker fires, send a `confirmation` Telegram **before** stopping.

**Everything else — including `/code-review` producing a polished "Approve for merge" recommendation — is NOT a stopping condition.** Continue straight through `pnpm josh bump minor` → `pnpm josh git -y` → the follow-up filing and `pnpm josh epic:bundle` → `pnpm josh followup --merge` in the same turn. **The filing sits after the pull request is open on purpose**, so it runs inside the CI wait rather than in front of it (`prompts/review.md` → "Review round cap").

**Join the gate before `pnpm josh bump minor` — every row of the table below runs after that, not instead of it.** `pnpm josh gate` is started alongside the review rather than in front of it (`SKILL.md` → the verification gate, joshuafolkken/kit#1242), so when the review settles the checks may still be running: read what the gate printed before continuing. **A red gate is fixed and re-run whatever the review concluded** — a clean review is not a result about lint, the type check, the spell check or the unit tests, and the brief says as much while the checks are in flight. The fix is uncommitted like every other, so it lands in the round-2 fix delta and is reviewed with the rest. **There is no row here that reaches a commit on a gate nobody read.**

**Decision table** (map `/code-review` result → next action mechanically):

| `/code-review` result                        | Findings severity  | Next action (same turn, no user input)                                                                                                                                                |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None               | Immediately continue: `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                 |
| Low findings only                       | Low                | Immediately continue: `bump minor` → `git -y` → the follow-up filing and `epic:bundle` for any Low routed to branch 2 → `followup --merge` (a Low that does not reach the user may be skipped with a one-line reason per Pre-commit Self-Review; one that does goes to a fix-in-place or an Issue, and a filed one goes here so it runs inside the CI wait) |
| One or more High / Medium findings      | High and/or Medium | Fix in place, then run the **second-round verification pass** — `/code-review` with the brief `pnpm josh review:brief --round 2` prints, which hands over the **fix delta** as the target and asking whether each first-round finding closed, **not** a second adversarial read of `git diff main` (`prompts/review.md` → "The second round is a verification pass, not a second full review") — **at most two reviews in total** (`prompts/review.md` → "Review round cap"). Nothing is committed yet, so a round costs no commit, push, or CI run. Do NOT report narratively and wait. |
| `/code-review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram (CI-level blocker)                                                                                                           |

The recommendation line at the bottom of `/code-review` ("Approve for merge", "Request changes", etc.) is informational, not authoritative. **Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text that resembles any of the following, you are violating the chain rule. Cancel the message; continue through `pnpm josh bump minor` → `pnpm josh git -y` → the follow-up filing and `pnpm josh epic:bundle` → `pnpm josh followup --merge` instead.

- "The `/code-review` is clean — ready to merge. Shall I proceed with `followup --merge`?"
- "`/code-review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup --merge` now?"
- Posting the `/code-review` Markdown output and then stopping the turn without a tool call.
- Listing low-severity findings narratively and asking whether they should block merge (Low findings are auto-skipped with a one-line reason; do not escalate).
- Treating CodeRabbit rate-limit warnings as findings (they are not — proceed).

All of these share one shape: presenting `/code-review` output to the user and waiting. **The user invoked `fullrun`; merging is part of that invocation. The chain ends at a stopping condition above, never at `/code-review` output.**

This rule applies regardless of model (Claude / Gemini / Cursor) or account; the workflow is portable and the chain must hold across environments.

**Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains `/code-review` output**

This check exists because the chain rule has been violated repeatedly even with the decision table and anti-pattern catalog above (PR #387 on 2026-05-15, PR #398 on 2026-05-20). The rule needs to be visible at the exact moment of violation — when the response is about to be sent. Run this check, in order, before sending:

1. **Mode check** — Is this `/code-review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) the implementation is finished and the verification gate has reached its review step. **A `halfrun` invocation never satisfies (a)** — halfrun runs this same review inside its gate, but it ends at the confirmation stop without committing: send the `confirmation` Telegram and stop with the work uncommitted. If either signal is false → you are in **standalone mode**, not fullrun mode: stop after the review markdown and do NOT call `followup --merge`. **The conditional is why this step is first**: `/code-review <PR>` typed on its own is a review and nothing else, and a check that skipped it would auto-merge on a review the user asked for by itself.
2. **Severity check** — Count high/medium findings, **using the two tests in `prompts/review.md` → "Severity"** rather than your own reading: a finding is `medium` or higher only when it reaches a runtime code path, a distributed artifact a consumer reads, or the verification that guards either **and** you can write its concrete failure scenario; failing either, it is `low`. **A `low` is not automatically droppable** — only one that fails the reach test is, so a `low` rated for want of a scenario still goes to a fix-in-place or an Issue. If ≥1 → fix in place, then run the **second-round verification pass**: `/code-review` with the brief `pnpm josh review:brief --round 2` prints, which hands over the **fix delta** as the target and asking whether each first-round finding closed and whether the fix itself introduced a defect — **not** the whole diff read adversarially again (`prompts/review.md` → "The second round is a verification pass, not a second full review"). The question narrows; the standard does not — an unresolved finding keeps its original severity. Nothing is committed yet, so the loop costs no commit or CI run. Do NOT call `followup --merge` yet. **Stop at two rounds:** after the second, route each remaining non-High finding through the three-way disposition — fix it in place without starting a new review round, file it referencing this one, or drop it with a one-line PR note; **for a filed finding, run `pnpm josh epic:bundle <new>` on it before this Issue closes and act on its answer** — `add_to_epic` / `create_epic` are Tier A, executed with the matching `pnpm josh epic --add` / `pnpm josh epic` write command and never a hand edit of the epic body; `ask` stops (or parks the child inside an `epicrun`); `none` is a no-op. **Do the filing and the bundle after `pnpm josh git -y` and before `pnpm josh followup --merge`, inside the CI wait** — neither changes a line of code, so the CI already running stays valid (`prompts/review.md` → "Review round cap"). Then continue the pipeline. Filing without the bundle step leaves an Issue `epic:next` never offers, so the finding is not dropped, it is parked forever (`prompts/review.md` → "Review round cap"). A confirmed High is the only thing that blocks past the cap, and one still standing after the second round means the change is not ready — send a `confirmation` Telegram and put the scope back to the user instead of starting a third round.
3. **Append check** — If you are in fullrun mode AND there are 0 high/medium findings (Low-only or fully clean), the same response that contains the `/code-review` markdown MUST also continue the pipeline in tool calls — `pnpm josh bump minor`, then `pnpm josh git -y`, then the follow-up filing and `pnpm josh epic:bundle` if the cap routed anything to branch 2, then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **A response whose final assistant text is `/code-review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/code-review` skill's output as an intermediate tool result, not a deliverable.

**The self-check is mirrored at the end of the `/code-review` skill prompt (`prompts/review.md`)**, so it is visible inside the skill's own execution context rather than only in the always-loaded documents. The violation happens at the moment that skill finishes producing markdown, which is where the reminder has to be.

**Tooling enforcement (investigated, not implemented).** A `pnpm josh review --auto-followup` style CLI wrapper was investigated as part of this rule and **is not feasible at the tooling layer**: `/code-review` is an interactive AI skill that returns Markdown for the agent to interpret, so a shell command cannot host the skill, parse its severity verdicts, or decide "no high/medium" on the agent's behalf. The strongest available enforcement is the decision table, the anti-pattern catalog and the turn-end self-check above, sitting in this skill plus the skill prompt (`prompts/review.md`). Recorded so the next reader proposes something else rather than re-deriving the same dead end.

This file is the single source of the rule; `prompts/collaboration-workflow/chain-rule.md` is a pointer to it (joshuafolkken/kit#1186 rollout of the joshuafolkken/kit#1174 pattern). The canonical section it replaced lived inside `prompts/collaboration-workflow/plan-comment.md`, which keeps Step 3 and is still cited for it.

