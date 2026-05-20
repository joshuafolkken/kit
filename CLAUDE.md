# Claude Code Instructions

> For Cursor/other AI tools: see `AGENTS.md`. For Gemini: see `GEMINI.md`.

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Environment Variables

The following variables are required for `scripts-ai/` functionality. Store them in a `.env` file at the project root (loaded automatically by the AI scripts). See [docs/scripts-ai.md](./docs/scripts-ai.md) for setup instructions including how to obtain these values.

| Variable             | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token for Telegram notifications (from BotFather) |
| `TELEGRAM_CHAT_ID`   | Target chat or user ID for Telegram messages          |

GitHub operations use the `gh` CLI. Authenticate once with `gh auth login`; no additional env var is needed unless running in CI (set `GH_TOKEN` there).

## Critical Conventions (non-standard — always apply)

### Naming

- Variables / functions / params: `snake_case`
- Types / classes / interfaces / enums: `PascalCase`; enum members: `UPPER_CASE`
- Booleans: prefix `is_` / `has_` / `should_` / `can_` / `will_` / `did_`
- Constants: `UPPER_CASE` or `snake_case`

### Functions & exports

- Use `function` syntax, not arrow functions
- Multiple functions in a file: group into a namespace object `export { my_module }` (constants exempt)
- No `export default`

### Files

- Svelte: `PascalCase.svelte` / `PascalCase.svelte.ts` · TypeScript: `kebab-case.ts` · Route files: exception

### Quality limits

- Function complexity ≤5 · nesting ≤2 · function ≤25 lines · file ≤300 lines · params ≤4
- Magic numbers: extract all literals except `0`, `1`, `-1` to named `UPPER_CASE` constants
- No `any` · no unused vars · no floating promises · type assertions (`as`) are restricted
- All function params and return types must be explicitly typed
- Early return: single `return` under 100 chars → one-liner `if (x) return y`; otherwise block syntax

### Svelte

- `$state` reactive variables are reassignable
- Props interface name `Props` is allowed by ESLint
- DOM manipulation is restricted

### Content rules

- i18n: all user-visible strings (labels, buttons, toasts, validation errors, page titles) must use message keys — never hardcode. Add to all locale message files.
- Comments / test titles (`describe` / `it` / `test` / `expect` messages): English only. Exception: `eslint/rules/` files may use Japanese comments to explain rule rationale.
- No code duplication: extract to shared functions/modules immediately
- `/* @refactor-ignore */` at file top excludes a file from refactoring

### Dependency overrides (package.json)

- **NEVER** remove or modify entries in `pnpm.overrides` without explicit user approval.
- After running `pnpm update`, `josh latest`, or any dependency-update command, verify that `pnpm.overrides` is unchanged **and** that `devDependencies` versions still respect the overrides. If any entry was removed, modified, or bumped past an override, restore it immediately.
- **NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation. `devEngines` pins the required development toolchain (e.g. pnpm version); silently changing it can break CI or other contributors' environments. After any dependency-update command, verify `devEngines` is unchanged. If it was modified, restore it immediately and ask the user before making any change.

## Code Change Rules

For every code modification, follow this order exactly:

0. **Test declaration** _(mandatory before writing any implementation code)_: Declare every change and its test. Do not touch implementation files until this list exists.

   ```text
   Change 1: <what changes>
     → Test: <Unit|E2E> — <file path> — <what behavior it verifies>
   Change 2: ...
   ```

   - **Tests are required for ALL code changes** — including bug fixes, timing/animation fixes, and refactors. No exceptions without explicit user approval.
   - Bug fix → regression test that would have caught the bug
   - UI / animation / timing fix → E2E test for the observable behavior change
   - Logic / utility change → unit test
   - **Refactoring → write unit/E2E tests that verify existing behavior BEFORE making any structural changes** — see `prompts/refactoring.md`
   - **Non-runtime updates (pre-approved manual-only exception)**: Changes that do not add or modify any executable runtime code path may proceed with manual verification only — no automated test and no per-task approval required. Declare the change in Step 0, state why no runtime code is affected, and describe the manual verification plan. This covers:
     - `.vscode/`, `.editorconfig`, and other editor / IDE preference files
     - Documentation-only files (`*.md`, `prompts/*`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`)
     - Non-executable config (`cspell.config.yaml`, `.gitignore`, `.prettierignore`, etc.)
     - Purely cosmetic asset swaps with no code-side selector / path change
   - If a test is genuinely infeasible for a change that **does** affect runtime code, state the reason explicitly and obtain user approval before proceeding.

1. **Refactor first** _(mandatory before lint or tests)_: apply high/medium-priority refactoring to all new/modified code — see `prompts/refactoring.md`. Do not proceed until no high/medium items remain.
2. **Tests**: implement the tests declared in Step 0. See `prompts/testing-guide.md`.
   - **E2E cleanup / leaked data**: When fixing issues where E2E leaves database or UI artifacts, follow the **Regression fix workflow** in `prompts/testing-guide.md` (add a failing guard → fix → confirm green). Prefer stable selectors (`data-testid`) over locale-dependent strings for teardown.
3. **Lint**: run `pnpm josh lint` then `pnpm exec tsc --noEmit`; fix all errors before reporting done.
4. **Spell check**: `pnpm josh cspell:dot`; add legitimate project terms to `cspell.config.yaml`
5. **IDE feedback**: check IDE lint output — often more current than terminal
6. Never say "it should pass" without running commands. Never finish while errors exist.
7. Do not modify `eslint.config.js` unless explicitly asked; fix issues in application/test code instead.

## Completion gate (before you tell the user work is done)

Run the full verification set **in order**. **Do not** skip or reorder steps. **Do not** report completion if any step failed or was skipped without the user agreeing.

**STOP — Refactor before lint.** For any code change, you MUST complete refactoring (`prompts/refactoring.md`) **before** running lint or check. Do not run step 2 or later until refactoring is done. For a **refactor-only** request, follow `refactoring.md`'s own **convergence** (high/medium items until none remain).

**E2E:** The user runs `pnpm josh test` and shares the full output. Do **not** claim completion until the user confirms E2E passed or explicitly scopes it out.

0. **Test gate** — Count (a) code changes made and (b) tests added/updated. If b = 0, allow the run to continue **only** when every change falls under the pre-approved non-runtime exception (see Code Change Rules Step 0) or the user has explicitly approved the infeasibility. Otherwise **stop** — go back to Code Change Rules Step 0 and add tests before continuing.
1. **Refactor** — read and execute `prompts/refactoring.md` on all changed files. Converge until no high/medium items remain. **Do not proceed to step 2 until complete.**
2. `pnpm josh lint`
3. `pnpm exec tsc --noEmit`
4. `pnpm josh cspell:dot`
5. `pnpm josh test:unit`
6. **Self-review** — follow `prompts/review.md` on the staged diff (and `git diff main...HEAD` before opening a PR). Produce the full categorized output, resolve all high/medium findings, and iterate until clean.
7. **IDE feedback**: zero **errors** on every file you changed (warnings only when documented as an allowed exception).
8. **E2E**: Ask the user to run `pnpm josh test` and share the output. Fix any failures, then ask again.

If you changed **only** docs or config that does not affect tests, still run lint + check + cspell; run unit tests when there is any chance of impact.

## Refactoring Rules

- When performing any refactoring, ALWAYS read and follow `prompts/refactoring.md` before starting.

## Pre-commit Self-Review (mandatory)

Before every `git commit` — including follow-up commits on the same branch — perform a self-review against `prompts/review.md`.

- Scope: the staged diff (`git diff --staged`). Before opening or updating a PR, also review the cumulative branch diff (`git diff main...HEAD`).
- Produce the full categorized output defined in `prompts/review.md`. Every category must have an explicit verdict (findings or `No issues`).
- Resolve **all high and medium findings** before committing. Low findings may be skipped with a one-line reason.
- If a fix introduces new code, re-run the self-review on the updated diff. Iterate until no high/medium findings remain.
- CI no longer runs a Claude review — the pre-commit self-review is the authoritative pass, so do not rely on a CI safety net.

## Doc Sync Rules

**CLAUDE.md, GEMINI.md, and AGENTS.md are paired documents.** Whenever any one of them is updated, apply the equivalent change to all three in the same commit. This includes rule additions, spec changes, wording fixes, and section additions. Never update one without checking the others.

**docs/ must stay in sync with the package.** Whenever `josh bump` is run (i.e. the package version changes), review `docs/` and update any section that describes changed behavior before committing. This applies to behavior changes in `josh init`, `josh sync`, new or renamed commands, and any new config files managed by the package.

## Git Rules

- **No commits** unless explicitly requested by the user
- **No PR merges, branch deletions, force pushes, or other shared-state mutations** unless explicitly requested in the current turn. The default end state is PR still OPEN — do not run `gh pr merge` on your own. **Exception**: invoking `fullrun` or `fullrun new` is explicit authorization to merge; use `pnpm josh followup --merge` in that flow. See `prompts/collaboration-workflow.md` → "指示されていない行動は取らない" for the full rule.
- For git operations: use `pnpm josh git`
- **Recovery after failed push**: If `pnpm josh git -y` fails at the push step (e.g. pre-push hook blocked), fix the issue, push manually, then run `pnpm josh pr` (or `pnpm josh git -y --skip-commit --skip-push`) to create the PR. **Never** use `gh pr create` directly — it bypasses `closes #N` generation and the Issue will not auto-close.
- **Start-of-conversation git status is a stale snapshot.** The `gitStatus` block in the environment preamble is captured once at session start and never refreshes. Before acting on any assumption about working-tree / index / stash / branch state (including "there are uncommitted changes", "staged files remain", "branch is behind"), run `git status` (and `git stash list` if relevant) live first. Never report state, propose a stash/checkout/reset plan, or ask the user to confirm cleanup based on the snapshot alone.

## Collaboration Workflow

- For issue-driven proposal/plan/execution/notification flow, follow `prompts/collaboration-workflow.md`

### Shorthand Commands

#### `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: Read existing Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → analyze requirements → post the plan to the Issue (if body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`) → send Telegram notification → **stop** (do not implement). Plan comments MUST be in English. Telegram notification: `pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>\n...'`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are auto-fetched from `gh` when not supplied. Include line breaks between bullets for readability. The Issue URL must be included.
- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (0) **Scope assessment**: Analyze whether the request contains multiple independent deliverables that could each be merged separately. If multiple → follow the **multi-issue split path**; if single → follow the **single-issue path**. **Single-issue path**: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Post the plan in English (same body/comment logic as `kickoff #<N>`). (4) Send Telegram notification (same format as `kickoff #<N>`). (5) **Stop** — do not implement. **Multi-issue split path**: (1) For each independent deliverable, derive a focused English title and create a separate Issue: `gh issue create --title "<sub-title>" --body "<body>"`. Capture each Issue number `<N1>`, `<N2>`, etc. (2) Post a comment on the first Issue explaining the split rationale and listing all Issue numbers/titles. (3) Send Telegram notification listing all created issues (same format as `kickoff #<N>`). (4) Present the command `queue #N1 #N2 ...` to the user. (5) **Stop** — do not implement.

#### `fullrun` — Full execution (plan → implement → PR → completion notify)

- `fullrun #<N>`: Read Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank (use `gh issue edit <N> --body "<plan>"`); if the body already has content, skip the plan-posting step → implement → `pnpm josh bump minor` → `pnpm josh git -y` → run `/review` skill → `pnpm josh followup --merge` → `pnpm josh ms` (full run from Step 3 onward in `prompts/collaboration-workflow.md`). Issue plan comments MUST be written in English. Before implementing, run `git switch main && git pull`, then `josh latest` (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `josh latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding (do NOT remove intentional overrides without user approval). Also verify `devEngines` is unchanged — restore it and ask the user before making any change if it was modified.** After committing, run the `/review` skill on the completed PR diff; fix all high/medium-priority findings and re-run until clean before proceeding to `followup`. When running `pnpm josh followup --merge`, compose an implementation summary in English and pass it via `--notify-message`. Format: `"Implemented <title>:\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change — what was added, changed, or fixed). **`pnpm josh followup --merge` waits for CI, verifies AI review findings, sends the completion notification, then merges — all in one step. If AI review blockers are found, followup exits non-zero; fix the findings and re-run `pnpm josh followup --merge`.** **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun` always ends on the default branch.** — see `auto-merge` behavior below.
- `fullrun new` or `fullrun new "<title>"`: Shortcut that combines `kickoff new` + `fullrun #<N>` into a single run. When no Issue exists yet (full run from Step 1 onward in `prompts/collaboration-workflow.md`). Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Add `in-progress` label: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`. (4) Post the agreed plan in English: if the Issue body is blank, use `gh issue edit <N> --body "<plan>"` to fill the body; otherwise use `gh issue comment <N> --body "<plan>"`. (5) If the working tree already has staged or modified files (e.g., user pre-staged kit/config changes), stash them first: `git stash`. (6) Run `git switch main && git pull`. (7) Run `josh latest` — **mandatory, never skip even if the working tree had modifications** (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `josh latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding. Also verify `devEngines` is unchanged — restore it and ask the user before making any change if it was modified. If you stashed changes in step 5, restore them now: `git stash pop`.** (8) Implement. (9) `pnpm josh bump minor`. (10) `pnpm josh git -y "<title> #<N>"`. (11) Run `/review` skill on the completed PR diff; fix all high/medium-priority findings and re-run until clean. (12) `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change). **`pnpm josh followup --merge` waits for CI, verifies AI review findings (CodeRabbit, Claude Review, SonarQube, etc.), sends the completion notification, then merges. If blockers are found, followup exits non-zero; fix and re-run `pnpm josh followup --merge`.** (13) **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun new` always ends on the default branch.** — see `auto-merge` behavior below.

#### `halfrun` — Implement + verify, stop before commit (for manual verification)

`halfrun` sits between `kickoff` (plan only, no implementation) and `fullrun` (full execution with auto-merge). It runs the full implementation + verification pipeline but **stops before commit** so the user can manually verify the change (typically by exercising the UI in a browser) before committing and merging. Use `halfrun` when the change has UI/UX implications or anything else that requires human eyes before shipping.

- `halfrun #<N>`: Read Issue #N → **normalize the title** (same as `fullrun`: derive a clearer English title if needed and run `gh issue edit <N> --title "<title>"`) → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank (use `gh issue edit <N> --body "<plan>"`); if the body already has content, skip the plan-posting step → run `git switch main && git pull`, then `josh latest` (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `josh latest`: verify `pnpm.overrides` was not modified — restore it if changed. Also verify `devEngines` is unchanged — restore it and ask the user before making any change if it was modified.** → implement → run the **full verification gate** (refactor per `prompts/refactoring.md` → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain) → send a `confirmation` Telegram with the resume commands in the body → **stop**. Plan comments MUST be in English. The `confirmation` Telegram body MUST include the exact resume commands the user runs to finish the workflow: `pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'halfrun ready for manual verification\nNext: pnpm josh bump minor && pnpm josh git -y "<title> #<N>" && pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\\n- <change1>\\n- ..."'`. **Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup` yourself. The user verifies locally and runs those commands manually. If the user comes back with fixes after the confirmation Telegram, treat each fix as a new round: implement the fix on the working tree, re-run the verification gate, send another `confirmation` Telegram, stop again.
- `halfrun new` or `halfrun new "<title>"`: Shortcut that combines `kickoff new` + `halfrun #<N>` (no Issue exists yet). Steps mirror `fullrun new` (1)–(8) exactly: (1) Derive an English title from the conversation, or use the provided title. (2) `gh issue create --title "<title>" --body "<body>"` using the minimum template in `prompts/collaboration-workflow.md`. Capture `<N>`. (3) Add `in-progress` label (`gh label create ... 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`). (4) Post the agreed plan in English (if the Issue body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`). (5) If the working tree has staged/modified files, `git stash`. (6) `git switch main && git pull`. (7) `josh latest` — **mandatory, never skip**. Verify `pnpm.overrides` / `devEngines` are unchanged; if you stashed in step 5, `git stash pop`. (8) Implement. (9) Run the verification gate: refactor → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain. (10) Send the `confirmation` Telegram (same body as `halfrun #<N>`) and **stop**. Do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup` — the user resumes manually after verifying.

#### `queue` — Sequential multi-issue fullrun

`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `josh latest` once (before the first issue) — **mandatory, never skip**. Verify `pnpm.overrides` and `devEngines` are unchanged after `josh latest`. If you stashed changes, restore them: `git stash pop`.
2. For each issue `#<N>` in the supplied order:
   a. From the 2nd issue onward: run `pnpm josh ms` to incorporate the previous PR's merge (a `fullrun` always ends on the default branch, so this is defensive — it also handles the case where the previous iteration was interrupted before `pnpm josh ms` ran).
   b. Execute the full `fullrun #<N>` flow: normalize title → add `in-progress` label → post plan if body is blank → implement → `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → run `/review` skill → `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- ..."` (sends per-issue completion notification and merges, exactly as `fullrun` does) → `pnpm josh ms` (return to the default branch).
   c. On failure: send a `failure` Telegram notification via `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body="<reason>"` and **stop immediately** (do not proceed to the next issue).
3. No extra batch summary notification — each issue's `pnpm josh followup --merge` already sends the per-issue completion notification as usual. The final iteration's `pnpm josh ms` leaves the working tree on the default branch, so `queue` always ends on the default branch.

**Key rules:**

- Invoking `queue` is explicit authorization to merge each PR (same as `fullrun`).
- `josh latest` runs only once, before the first issue. If files were pre-staged when `queue` was invoked, they must be stashed before `josh latest` and restored after.
- All `kickoff`/`fullrun` mid-workflow stop rules (confirmation notification, AI review blocker handling, etc.) apply within each issue's execution.

#### AI reviewer comment scan (automatic in `pnpm josh followup`)

`pnpm josh followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**. This scan runs after CI is green and after the existing CodeRabbit line-comment check. The goal is to ensure substantive findings posted by AI reviewers _after_ CI goes green are not silently shipped.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices (`rate limited by coderabbit.ai` / `Rate limit exceeded`) and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm josh followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR (mirroring the CodeRabbit ignore-reason flow) and proceeds to completion.
- Acknowledgment-only Claude comments (`All issues resolved ✓`, `Everything else looks good`) do not match the blocker heuristics, so rounds where the AI reviewer explicitly signs off do not trigger a false positive.

#### Config file update check (during `pnpm josh followup`)

After CI status checks complete during `pnpm josh followup`, inspect `git diff main...HEAD` to determine whether the PR contains changes to files managed and distributed by `josh sync` (e.g., `playwright.config.ts`, `.github/workflows/ci.yml`). If any managed config file was updated, stop before making any subsequent commit and send a `confirmation` Telegram notification:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'CI status check indicates a managed config file was updated\nPlease review the changes before proceeding'
```

- Do not make any follow-up commit, fix, or proceed to merge until the user explicitly confirms
- This check runs independently of AI reviewer comment scanning — both may trigger in the same workflow run

#### `/review` → `followup --merge` chain rule (MANDATORY)

Within `fullrun` / `fullrun new` / `queue`, the `/review` skill output is **not** a turn boundary. The skill returns a polished Markdown review with sections, severity-tagged findings, and a final recommendation — this is an intermediate step, not a finished deliverable.

**`fullrun` STOPPING CONDITIONS** (the chain ends only here):

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch** — normal end state, report the PR URL and stop.
2. **A genuine blocker requires user judgment** — exactly three count:
   - A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive.
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   When a blocker fires, send a `confirmation` Telegram **before** stopping.

**Everything else — including `/review` producing a polished "Approve for merge" recommendation — is NOT a stopping condition.** Continue straight to `pnpm josh followup --merge` in the same turn.

**Decision table** (map `/review` result → next action mechanically):

| `/review` result                        | Findings severity  | Next action (same turn, no user input)                                                                              |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None               | Immediately run `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                  |
| Low findings only                       | Low                | Immediately run `pnpm josh followup --merge` (Low may be skipped with a one-line reason per Pre-commit Self-Review) |
| One or more High / Medium findings      | High and/or Medium | Fix in place, re-stage, commit, push, re-run `/review`, loop. Do NOT report narratively and wait. Do NOT merge yet. |
| `/review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram (CI-level blocker)                                         |

The recommendation line at the bottom of `/review` ("Approve for merge", "Request changes", etc.) is informational, not authoritative. **Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text that resembles any of the following, you are violating the chain rule. Cancel the message; run `pnpm josh followup --merge` instead.

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

1. **Mode check** — Is this `/review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) `pnpm josh git -y` has already been run in this session and a PR exists for the current branch. If either is false → you are in **standalone mode**; stop after the review markdown, do NOT call `followup --merge`.
2. **Severity check** — Count high/medium findings. If ≥1 → fix in place, re-stage, commit, push, re-run `/review`. Do NOT call `followup --merge` yet. Loop until clean.
3. **Append check** — If you are in fullrun mode AND there are 0 high/medium findings (Low-only or fully clean), the same response that contains the `/review` markdown MUST also contain a `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` tool call. **A response whose final assistant text is `/review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call.

The check fires at the moment your response would end with review markdown and no follow-on tool call. That is the violation point. Treat the `/review` skill's output as an intermediate tool result, not a deliverable.

See `prompts/collaboration-workflow.md` → "Chain rule: `/review` → `followup --merge` decision table" for the canonical extended reference.

#### `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup --merge`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. The user does **not** need to add a keyword. Invoking `fullrun` is itself the explicit authorization to merge.

```bash
pnpm josh followup "<title> #<N>" --merge --notify-message "..."
pnpm josh ms
```

- **Always run `pnpm josh ms` after a successful merge.** `pnpm josh followup --merge` leaves the working tree on the merged feature branch; running `pnpm josh ms` (= checkout default branch + `git pull`) returns it to the default branch with the merge commit pulled. `fullrun` / `fullrun new` / `queue` always end on the default branch. Skip this step only if the merge itself failed (the workflow already stopped).
- **AI review findings are checked automatically.** `pnpm josh followup --merge` scans for CodeRabbit / Claude Review / SonarQube findings before merging. If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run `pnpm josh followup --merge`. **Green CI is not authorization to merge while AI review findings are open.**
- **CodeRabbit rate-limit is not a finding.** If the only CodeRabbit comment is a rate-limit warning (body contains `rate limited by coderabbit.ai` or `Rate limit exceeded`) and there is no substantive review, treat it as "no findings" and proceed. The same applies if CodeRabbit produced no comment at all on the latest commit.
- **Verify CodeRabbit findings before bypassing.** When CodeRabbit posts a substantive finding, do not pass `--coderabbit-ignore-reason` reflexively — first verify whether the finding is correct. Concrete example: CodeRabbit may flag a GitHub Actions SHA pin like `pnpm/action-setup@<sha> # v6.0.8` as "not matching the tag", because it queried `gh api repos/<owner>/<repo>/git/ref/tags/v6.0.8` which returns the **annotated-tag-object SHA**, not the **commit SHA** that the tag points to. GitHub Actions pins use the commit SHA. Confirm with `gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` — if that matches the pinned SHA, the finding is a false positive. Only then bypass with `--coderabbit-ignore-reason "<verification-based-reason>"`, citing the verification command and its output.
- Merge uses `gh pr merge <branch> --merge` internally (direct merge, not GitHub's `--auto` flag). All required checks are already green by this point.
- Use the merge strategy the repo allows (`--merge` / `--squash` / `--rebase`). Default to `--merge`. Inspect with `gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` when unsure.
- Do **not** pass `--delete-branch` unless the user asks. Branch cleanup is a separate explicit instruction.
- If the merge fails (e.g. branch protections not met, conflicts), report the reason and stop — do not retry with different flags or bypass protections.
- **If the user wants to skip the merge step**, use `kickoff` (plan-only) or explicitly say "do not merge" / "do not auto-merge" in the same turn. In that case, pass `--no-merge` to `pnpm josh followup`. Outside a `fullrun` invocation, never run `gh pr merge` on your own.

See `prompts/collaboration-workflow.md` → "Auto-merge（default for `fullrun`）" for the portable, cross-AI version of this rule.

#### Completion notifications: always via `pnpm josh followup`

Never send `completion` Telegram notifications manually with `pnpm josh notify --task-type completion ...`. Always use `pnpm josh followup` — it fetches the PR URL via `gh pr view <branch> --json url` and always includes it, whereas the manual CLI does not auto-populate `--pr-url` and will produce a Telegram message missing the PR link.

**Always run `pnpm josh followup` in the foreground** (no `&` suffix, no shell backgrounding). It waits for CI and can take several minutes; use the Bash tool with `timeout: 300000` (5 min). Background processes started with `&` inside a Bash tool call do not survive when the tool call returns — the command will silently disappear and the PR will remain unmerged.

- Applies to the initial PR and every follow-up commit (CodeRabbit fixes, re-review iterations, merges from main, etc.) — re-run `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."` each time you want to notify completion (notification is sent right before the merge).
- `pnpm josh notify` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications (no automated alternative exists for those).

#### Mid-workflow stop notification (`confirmation`)

Whenever Claude pauses a `kickoff` / `halfrun` / `fullrun` mid-execution to wait for user confirmation (approval, clarification, scope decision, etc.), it MUST send a Telegram notification **before** stopping so the user is alerted off-screen. `halfrun`'s built-in stop before commit is a confirmation pause and follows this same rule — the resume-command body required by the `halfrun` section above is the specific form for that case:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```

- Use `--body=...` (single token) when the body starts with `-`, otherwise `parseArgs` rejects it
- Send only once per stop — do not spam if you re-evaluate within the same pause
- Skip the notification when the stop was explicitly requested by the user in the same turn (they already know)
