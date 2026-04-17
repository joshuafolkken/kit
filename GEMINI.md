# Gemini Agent Instructions

> For Claude Code: see `CLAUDE.md`. For Cursor/other AI tools: see `AGENTS.md`.

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
   - **Tests are required for ALL code changes** — including bug fixes, timing/animation fixes, and refactors.
   - Bug fix → regression test that would have caught the bug
   - UI / animation / timing fix → E2E test for the observable behavior change
   - Logic / utility change → unit test
   - **Refactoring → write unit/E2E tests that verify existing behavior BEFORE making any structural changes** — see `prompts/refactoring.md`
   - If a test is genuinely infeasible, state the reason explicitly and obtain user approval before proceeding.

1. **Refactor first** _(mandatory before lint or tests)_: apply high/medium-priority refactoring to all new/modified code — see `prompts/refactoring.md`. Do not proceed until no high/medium items remain.
2. **Tests**: add/update unit tests (Vitest) + E2E tests (Playwright) for all behavior changes — see `prompts/testing-guide.md`
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

1. **Refactor** — read and execute `prompts/refactoring.md` on all changed files. Converge until no high/medium items remain. **Do not proceed to step 2 until complete.**
2. `pnpm run lint`
3. `pnpm run check:ci` — strict type-check matching CI (uses `svelte-check`, not the incremental fast variant). A green local run must imply a green CI type-check; do not substitute `pnpm run check`.
4. `pnpm cspell:dot`
5. `pnpm test:unit --run`
6. **IDE feedback**: zero **errors** on every file you changed (warnings only when documented as an allowed exception).
7. **E2E**: Ask the user to run `pnpm test` and share the output. Fix any failures, then ask again.

If you changed **only** docs or config that does not affect tests, still run lint + check + cspell; run unit tests when there is any chance of impact.

## Refactoring Rules

- When performing any refactoring, ALWAYS read and follow `prompts/refactoring.md` before starting.
- Write tests for existing behavior **before** making any structural changes — this is mandatory and not optional.

## Git Rules

- **No commits** unless explicitly requested by the user
- For git operations: use `scripts/git-workflow.ts` via `pnpm git`

## Collaboration Workflow

- For issue-driven proposal/plan/execution/notification flow, follow `prompts/collaboration-workflow.md`

### Shorthand Commands

#### `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: Read existing Issue #N → analyze requirements → post the plan to the Issue (if body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`) → send Telegram notification → **stop** (do not implement). Plan comments MUST be in English. Telegram notification: `pnpm telegram:test --task-type planning --issue-url "<issue-url>" --body "- <bullet1>\n- <bullet2>\n..."`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are auto-fetched from `gh` when not supplied. Include line breaks between bullets for readability.
- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue. (3) Post the plan in English. (4) Send Telegram notification. (5) **Stop**.

#### `fullrun` — Full execution (plan → implement → PR → completion notify)

- `fullrun #<N>`: Post the agreed plan to Issue #N (if the Issue body is blank, use `gh issue edit <N> --body "<plan>"` to fill the body; otherwise use `gh issue comment <N> --body "<plan>"`) → implement → `pnpm version:minor` → `pnpm git -y` → `pnpm git:followup` (full run from Step 3 onward in `prompts/collaboration-workflow.md`). Issue plan comments MUST be written in English. When running `pnpm git:followup`, compose an implementation summary in English and pass it via `--notify-message`. Format: `"<title>\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change — what was added, changed, or fixed).

#### AI reviewer comment scan (automatic in `pnpm git:followup`)

`pnpm git:followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**. This scan runs after CI is green and after the existing CodeRabbit line-comment check. The goal is to ensure substantive findings posted by AI reviewers _after_ CI goes green are not silently shipped.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices (`rate limited by coderabbit.ai` / `Rate limit exceeded`) and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm git:followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR (mirroring the CodeRabbit ignore-reason flow) and proceeds to completion.

#### Completion notifications: always via `pnpm git:followup`

Never send `completion` Telegram notifications manually with `pnpm telegram:test --task-type completion ...`. Always use `pnpm git:followup` — it fetches the PR URL via `gh pr view <branch> --json url` and always includes it, whereas the manual CLI does not auto-populate `--pr-url` and will produce a Telegram message missing the PR link.

- Applies to the initial PR and every follow-up commit (CodeRabbit fixes, re-review iterations, merges from main, etc.) — re-run `pnpm git:followup "<title> #<N>" --notify-message "<title>\n- <change1>\n- <change2>\n..."` each time you want to notify completion.
- `pnpm telegram:test` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications (no automated alternative exists for those).

#### Mid-workflow stop notification (`confirmation`)

Whenever the AI tool pauses a `kickoff`/`fullrun` mid-execution to wait for user confirmation (approval, clarification, scope decision, etc.), it MUST send a Telegram notification **before** stopping so the user is alerted off-screen:

```bash
pnpm telegram:test --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```

- Use `--body=...` (single token) when the body starts with `-`, otherwise `parseArgs` rejects it
- Send only once per stop — do not spam if you re-evaluate within the same pause
- Skip the notification when the stop was explicitly requested by the user in the same turn (they already know)

## MCP Tools (Svelte)

You have access to the Svelte MCP server with comprehensive Svelte 5 and SvelteKit documentation.

### list-sections

Use this FIRST for any Svelte/SvelteKit topic to discover relevant documentation sections.

### get-documentation

After `list-sections`, fetch ALL relevant sections (analyze `use_cases` field to determine relevance).

### svelte-autofixer

MUST use whenever writing Svelte code before sending to the user. Keep calling until no issues remain.

### playground-link

Generates a Svelte Playground link. Only call after user confirmation and NEVER if code was written to project files.
