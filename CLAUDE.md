# Claude Code Instructions

> For Cursor/other AI tools: see `AGENTS.md`. For Gemini: see `GEMINI.md`.

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

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

- Function complexity ≤4 · nesting ≤1 · function ≤25 lines · file ≤300 lines · params ≤3
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
- Comments / test titles (`describe` / `it` / `test` / `expect` messages): English only
- No code duplication: extract to shared functions/modules immediately
- `/* @refactor-ignore */` at file top excludes a file from refactoring

### Dependency overrides (package.json)

- **NEVER** remove or modify entries in `pnpm.overrides` without explicit user approval.
- After running `pnpm update`, `pnpm latest`, or any dependency-update command, verify that `pnpm.overrides` is unchanged **and** that `devDependencies` versions still respect the overrides. If any entry was removed, modified, or bumped past an override, restore it immediately.

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
3. **Lint**: run `pnpm run lint` then `pnpm run check:ci`; fix all errors before reporting done. `pnpm run check:ci` matches CI's strict type-check — a green local run implies a green CI type-check. Do not substitute `pnpm run check` (incremental / fast) at gate time.
4. **Spell check**: `pnpm cspell:dot`; add legitimate project terms to `cspell.config.yaml`
5. **IDE feedback**: check IDE lint output — often more current than terminal
6. Never say "it should pass" without running commands. Never finish while errors exist.
7. Do not modify `eslint.config.js` unless explicitly asked; fix issues in application/test code instead.

## Completion gate (before you tell the user work is done)

Run the full verification set **in order**. **Do not** skip or reorder steps. **Do not** report completion if any step failed or was skipped without the user agreeing.

**STOP — Refactor before lint.** For any code change, you MUST complete refactoring (`prompts/refactoring.md`) **before** running lint or check. Do not run step 2 or later until refactoring is done. For a **refactor-only** request, follow `refactoring.md`'s own **convergence** (high/medium items until none remain).

**E2E:** The user runs `pnpm test` and shares the full output. Do **not** claim completion until the user confirms E2E passed or explicitly scopes it out.

0. **Test gate** — Count (a) code changes made and (b) tests added/updated. If b = 0, allow the run to continue **only** when every change falls under the pre-approved non-runtime exception (see Code Change Rules Step 0) or the user has explicitly approved the infeasibility. Otherwise **stop** — go back to Code Change Rules Step 0 and add tests before continuing.
1. **Refactor** — read and execute `prompts/refactoring.md` on all changed files. Converge until no high/medium items remain. **Do not proceed to step 2 until complete.**
2. `pnpm run lint`
3. `pnpm run check:ci` — strict type-check matching CI (uses `svelte-check`, not the incremental fast variant). A green local run must imply a green CI type-check; do not substitute `pnpm run check`.
4. `pnpm cspell:dot`
5. `pnpm test:unit --run`
6. **Self-review** — follow `prompts/review.md` on the staged diff (and `git diff main...HEAD` before opening a PR). Produce the full categorized output, resolve all high/medium findings, and iterate until clean.
7. **IDE feedback**: zero **errors** on every file you changed (warnings only when documented as an allowed exception).
8. **E2E**: Ask the user to run `pnpm test` and share the output. Fix any failures, then ask again.

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

## Git Rules

- **No commits** unless explicitly requested by the user
- **No PR merges, branch deletions, force pushes, or other shared-state mutations** unless explicitly requested in the current turn. `pnpm josh git-followup` completing with the PR still OPEN is the expected end state — do not run `gh pr merge` on your own. See `prompts/collaboration-workflow.md` → "指示されていない行動は取らない" for the full rule.
- For git operations: use `scripts/git-workflow.ts` via `pnpm josh git`
- **Start-of-conversation git status is a stale snapshot.** The `gitStatus` block in the environment preamble is captured once at session start and never refreshes. Before acting on any assumption about working-tree / index / stash / branch state (including "there are uncommitted changes", "staged files remain", "branch is behind"), run `git status` (and `git stash list` if relevant) live first. Never report state, propose a stash/checkout/reset plan, or ask the user to confirm cleanup based on the snapshot alone.

## Collaboration Workflow

- For issue-driven proposal/plan/execution/notification flow, follow `prompts/collaboration-workflow.md`

### Shorthand Commands

#### `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: Read existing Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → analyze requirements → post the plan to the Issue (if body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`) → send Telegram notification → **stop** (do not implement). Plan comments MUST be in English. Telegram notification: `pnpm josh telegram-test --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>\n...'`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are auto-fetched from `gh` when not supplied. Include line breaks between bullets for readability. The Issue URL must be included.
- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Post the plan in English (same body/comment logic as `kickoff #<N>`). (4) Send Telegram notification (same format as `kickoff #<N>`). (5) **Stop** — do not implement.

#### `fullrun` — Full execution (plan → implement → PR → completion notify)

- `fullrun #<N>`: Read Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → post the agreed plan (if the Issue body is blank, use `gh issue edit <N> --body "<plan>"` to fill the body; otherwise use `gh issue comment <N> --body "<plan>"`) → implement → `pnpm josh bump-version minor` → `pnpm josh git -y` → `pnpm josh git-followup --merge` (full run from Step 3 onward in `prompts/collaboration-workflow.md`). Issue plan comments MUST be written in English. Before implementing, run `git switch main && git pull`, then `pnpm latest` (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `pnpm latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding (do NOT remove intentional overrides without user approval).** When running `pnpm josh git-followup --merge`, compose an implementation summary in English and pass it via `--notify-message`. Format: `"Implemented <title>:\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change — what was added, changed, or fixed). **`pnpm josh git-followup --merge` waits for CI, verifies AI review findings, sends the completion notification, then merges — all in one step. If AI review blockers are found, followup exits non-zero; fix the findings and re-run `pnpm josh git-followup --merge`.** — see `auto-merge` behavior below.
- `fullrun new` or `fullrun new "<title>"`: Shortcut that combines `kickoff new` + `fullrun #<N>` into a single run. When no Issue exists yet (full run from Step 1 onward in `prompts/collaboration-workflow.md`). Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Post the agreed plan in English: if the Issue body is blank, use `gh issue edit <N> --body "<plan>"` to fill the body; otherwise use `gh issue comment <N> --body "<plan>"`. (4) Run `git switch main && git pull`. (5) Run `pnpm latest` (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `pnpm latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding.** (6) Implement. (7) `pnpm josh bump-version minor`. (8) `pnpm josh git -y "<title> #<N>"`. (9) `pnpm josh git-followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change). **`pnpm josh git-followup --merge` waits for CI, verifies AI review findings (CodeRabbit, Claude Review, SonarQube, etc.), sends the completion notification, then merges. If blockers are found, followup exits non-zero; fix and re-run `pnpm josh git-followup --merge`.** — see `auto-merge` behavior below.

#### AI reviewer comment scan (automatic in `pnpm josh git-followup`)

`pnpm josh git-followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**. This scan runs after CI is green and after the existing CodeRabbit line-comment check. The goal is to ensure substantive findings posted by AI reviewers _after_ CI goes green are not silently shipped.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices (`rate limited by coderabbit.ai` / `Rate limit exceeded`) and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm josh git-followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR (mirroring the CodeRabbit ignore-reason flow) and proceeds to completion.
- Acknowledgment-only Claude comments (`All issues resolved ✓`, `Everything else looks good`) do not match the blocker heuristics, so rounds where the AI reviewer explicitly signs off do not trigger a false positive.

#### `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh git-followup --merge`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. The user does **not** need to add a keyword. Invoking `fullrun` is itself the explicit authorization to merge.

```bash
pnpm josh git-followup "<title> #<N>" --merge --notify-message "..."
```

- **AI review findings are checked automatically.** `pnpm josh git-followup --merge` scans for CodeRabbit / Claude Review / SonarQube findings before merging. If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run `pnpm josh git-followup --merge`. **Green CI is not authorization to merge while AI review findings are open.**
- **CodeRabbit rate-limit is not a finding.** If the only CodeRabbit comment is a rate-limit warning (body contains `rate limited by coderabbit.ai` or `Rate limit exceeded`) and there is no substantive review, treat it as "no findings" and proceed. The same applies if CodeRabbit produced no comment at all on the latest commit.
- Merge uses `gh pr merge <branch> --merge` internally (direct merge, not GitHub's `--auto` flag). All required checks are already green by this point.
- Use the merge strategy the repo allows (`--merge` / `--squash` / `--rebase`). Default to `--merge`. Inspect with `gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` when unsure.
- Do **not** pass `--delete-branch` unless the user asks. Branch cleanup is a separate explicit instruction.
- If the merge fails (e.g. branch protections not met, conflicts), report the reason and stop — do not retry with different flags or bypass protections.
- **If the user wants to skip the merge step**, use `kickoff` (plan-only) or explicitly say "do not merge" / "do not auto-merge" in the same turn. In that case, omit `--merge` from `pnpm josh git-followup`. Outside a `fullrun` invocation, never run `gh pr merge` on your own.

See `prompts/collaboration-workflow.md` → "Auto-merge（default for `fullrun`）" for the portable, cross-AI version of this rule.

#### Completion notifications: always via `pnpm josh git-followup`

Never send `completion` Telegram notifications manually with `pnpm josh telegram-test --task-type completion ...`. Always use `pnpm josh git-followup` — it fetches the PR URL via `gh pr view <branch> --json url` and always includes it, whereas the manual CLI does not auto-populate `--pr-url` and will produce a Telegram message missing the PR link.

**Always run `pnpm josh git-followup` in the foreground** (no `&` suffix, no shell backgrounding). It waits for CI and can take several minutes; use the Bash tool with `timeout: 300000` (5 min). Background processes started with `&` inside a Bash tool call do not survive when the tool call returns — the command will silently disappear and the PR will remain unmerged.

- Applies to the initial PR and every follow-up commit (CodeRabbit fixes, re-review iterations, merges from main, etc.) — re-run `pnpm josh git-followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."` each time you want to notify completion (notification is sent right before the merge).
- `pnpm josh telegram-test` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications (no automated alternative exists for those).

#### Mid-workflow stop notification (`confirmation`)

Whenever Claude pauses a `kickoff`/`fullrun` mid-execution to wait for user confirmation (approval, clarification, scope decision, etc.), it MUST send a Telegram notification **before** stopping so the user is alerted off-screen:

```bash
pnpm josh telegram-test --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```

- Use `--body=...` (single token) when the body starts with `-`, otherwise `parseArgs` rejects it
- Send only once per stop — do not spam if you re-evaluate within the same pause
- Skip the notification when the stop was explicitly requested by the user in the same turn (they already know)
