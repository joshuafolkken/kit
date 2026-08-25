# `/review` → `followup --merge` chain rule (MANDATORY)

Within `fullrun` / `fullrun new` / `queue`, the `/review` skill output is **not** a turn boundary. The skill returns a polished Markdown review with sections, severity-tagged findings, and a final recommendation — this is an intermediate step, not a finished deliverable.

**`fullrun` STOPPING CONDITIONS** (the chain ends only here):

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch** — normal end state, report the PR URL and stop.
2. **A genuine blocker requires user judgment** — exactly three count:
   - A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive.
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   When a blocker fires, send a `confirmation` Telegram **before** stopping.

**Everything else — including `/review` producing a polished "Approve for merge" recommendation — is NOT a stopping condition.** Continue straight through `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` in the same turn.

**Decision table** (map `/review` result → next action mechanically):

| `/review` result                        | Findings severity  | Next action (same turn, no user input)                                                                                                                                                |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None               | Immediately continue: `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                 |
| Low findings only                       | Low                | Immediately continue: `bump minor` → `git -y` → `followup --merge` (Low may be skipped with a one-line reason per Pre-commit Self-Review)                                             |
| One or more High / Medium findings      | High and/or Medium | Fix in place and re-run `/review` on `git diff main`, looping until clean. Nothing is committed yet, so a round costs no commit, push, or CI run. Do NOT report narratively and wait. |
| `/review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram (CI-level blocker)                                                                                                           |

The recommendation line at the bottom of `/review` ("Approve for merge", "Request changes", etc.) is informational, not authoritative. **Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text that resembles any of the following, you are violating the chain rule. Cancel the message; continue through `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` instead.

- "The `/review` is clean — ready to merge. Shall I proceed with `followup --merge`?"
- "`/review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup --merge` now?"
- Posting the `/review` Markdown output and then stopping the turn without a tool call.
- Listing low-severity findings narratively and asking whether they should block merge (Low findings are auto-skipped with a one-line reason).
- Treating CodeRabbit rate-limit warnings as findings (they are not — proceed).

All of these share one shape: presenting `/review` output to the user and waiting. **The user invoked `fullrun`; merging is part of that invocation. The chain ends at a stopping condition above, never at `/review` output.**

This rule applies regardless of model (Claude / Gemini / Cursor) or account; the workflow is portable and the chain must hold across environments.

**Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains `/review` output**

This check exists because the chain rule has been violated repeatedly even with the decision table and anti-pattern catalog above. The rule needs to be visible at the exact moment of violation — when the response is about to be sent. Run this check, in order, before sending:

1. **Mode check** — Is this `/review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) the implementation is finished and the verification gate has reached its review step. **A `halfrun` invocation never satisfies (a)** — halfrun runs this same review inside its gate, but it ends at the confirmation stop without committing: send the `confirmation` Telegram and stop with the work uncommitted. If either signal is false → you are NOT in fullrun mode; do NOT call `followup --merge`.
2. **Severity check** — Count high/medium findings. If ≥1 → fix in place and re-run `/review`. Nothing is committed yet, so the loop costs no commit or CI run. Do NOT call `followup --merge` yet. Loop until clean.
3. **Append check** — If you are in fullrun mode AND there are 0 high/medium findings (Low-only or fully clean), the same response that contains the `/review` markdown MUST also continue the pipeline in tool calls — `pnpm josh bump minor`, then `pnpm josh git -y`, then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **A response whose final assistant text is `/review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/review` skill's output as an intermediate tool result, not a deliverable.

See `prompts/collaboration-workflow.md` → "Chain rule: `/review` → `followup --merge` decision table" for the canonical extended reference.

