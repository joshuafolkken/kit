# Gemini Agent Instructions

> For Claude Code: see `CLAUDE.md`. For Cursor/other AI tools: see `AGENTS.md`.

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Communication

- **Answer opinion-seeking questions from a neutral standpoint.** When the user asks a leading or preference-shaped question — e.g. "how about X?" ("〜〜ではどうか？"), "wouldn't Y be better?" ("〜〜の方はどうか？"), "isn't Z the right call?" — do not reflexively agree or tailor the answer to the phrasing. Weigh the actual merits and respond impartially: state the trade-offs honestly, recommend the option you genuinely judge best (even when it differs from the one the user hinted at), and explain why. Agreement must be earned by the facts, not assumed from how the question is asked.
- **Fix root causes, not symptoms.** Do not use your own judgment to reach for ad-hoc workarounds, hacks, or clever tricks to force a goal through. Diagnose the underlying cause first, then recommend and apply the correct, fundamental fix — even when it is larger or slower than a quick patch. If the proper fix is out of scope or needs the user's decision, surface the root cause and the recommended fix rather than silently papering over the symptom.
- **Cross-package problems → interrupt with a new Issue, don't patch locally.** When a problem discovered mid-task actually originates in a different package — including a dependency or the distribution-source package (e.g. the `josh` / kit tooling this project consumes) — do **not** paper over it with a local workaround in the current repo. Instead: (1) stash the current work-in-progress (`git stash`); (2) record in the active Issue that the work was stashed and **why** (which upstream package and problem caused the pause, plus a link to the new Issue) so the paused state is auditable; (3) create a new Issue in the **target package's** repository describing the root cause; (4) handle that as an interrupt; (5) only after the upstream fix lands — or the user explicitly decides to defer — `git stash pop` and resume the original task. The recommended default when in doubt is the root-cause interrupt, not the local quick-fix. See `prompts/collaboration-workflow.md` → "別パッケージ起因の問題は割り込み Issue で対応する".
- **No clones — single-source, even across package boundaries.** Copying, porting, or re-implementing existing non-trivial logic to avoid changing its source is **prohibited by default**. The moment you are about to replicate logic that already lives somewhere — another file, another module, or another **package, including an upstream dependency** — STOP: that is the signal to **single-source** it (one shared module / export / package every consumer imports), not to copy it. (1) An existing duplication is **not** a license to duplicate again — if the code was already cloned once (e.g. jgame copied kit), the shared abstraction is overdue; surface it, do not add a third copy. (2) "Reference the upstream" means **reuse it**, never paste its code. (3) A "don't touch X" constraint never silently justifies a clone — surface the tradeoff first ("the clean fix needs a change in kit; the alternative is a clone — which do you want?"). (4) Duplicate **only** after presenting the single-source alternative and its cost **and** getting the user's explicit approval. See `prompts/collaboration-workflow.md` → "クローン禁止・単一ソース化（パッケージ境界を越えても）".
- **Distinguish consultation from execution — don't edit files during discussion.** When the user asks how to approach something, what we should do, why something happened, or expresses a goal/desire ("どうすべき？", "how should we…", "なぜ", "理由を知りたい", "〜したい", "〜の方が良い？"), respond with **analysis and a recommendation only** — do **not** edit files, create issues, or take other concrete actions. Act only on an explicit imperative ("do it", "書き換えて", "作成して", "implement") or a workflow keyword (`kickoff` / `halfrun` / `fullrun` / `queue`). When ambiguous, default to propose-and-wait (or ask "should I execute this?"). A goal statement is a request for a plan, not authorization to execute it. See `prompts/collaboration-workflow.md` → "相談と実行を区別する（議論中にファイルを編集しない）".
- **Route distributed-doc / config changes upstream to kit.** `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` and other kit-distributed docs/config are single-sourced from kit. In a consumer repo (app-kit / game-kit) never edit them locally — `josh sync` would overwrite the edit and the change belongs upstream; before editing any doc/config, check whether it is a distributed artifact and, if so, propose the change for kit (issue / PR) instead. In kit itself you **are** the source, so edit here — and keep the three paired docs in sync per "Doc Sync Rules". See `prompts/collaboration-workflow.md` → "配布ドキュメント・設定の変更は kit に上流化する".

### Decision autonomy (minimize confirmation stops)

When you reach a decision point, classify it into one of three tiers and act accordingly. The goal is to stop and ask **only** when the choice genuinely needs the user's judgment — not at every fork.

- **Tier A — reversible implementation / design choices** (a library pick where one option is clearly superior, naming, file layout, test approach, refactor shape). If one option is clearly better on the merits, **select it and proceed without asking.** When the point is one you would normally surface for confirmation, log the decision so the user can audit or override it later (see "Logging auto-decisions" below).
- **Tier B — genuine toss-up.** The top two options are both sound and the margin is narrow. **This is the only tier that stops** — ask the user (use `AskUserQuestion` where available), presenting the close candidates and their trade-offs.
- **Tier C — irreversible / shared-state / out-of-scope actions** (merge, branch delete, force push, destructive ops, repo-settings changes, anything outside the stated task scope, `devEngines` / `pnpm.overrides` edits). **Out of scope for this policy.** Always require explicit user instruction — never auto-decide, even when one option looks clearly better. The existing safety rules (`prompts/collaboration-workflow.md` → "指示されていない行動は取らない", the `devEngines` / `pnpm.overrides` protections above) take precedence.

**Criterion for A vs B:** ask only when the margin is narrow **and** the decision is hard to reverse or has lasting architectural impact. "I'm in doubt" alone is not a reason to stop — a clearly-superior option is selected automatically even if some uncertainty remains, and a narrow-margin but cheaply-reversible choice is also made automatically (pick one, log it, move on).

**Logging auto-decisions:** when you auto-decide a Tier A point that would normally warrant confirmation, record the candidates and rationale:

- Inside an Issue-driven workflow (`kickoff` / `halfrun` / `fullrun` / `queue`): post an Issue comment — `gh issue comment <N> --body "..."` — listing the chosen option, the rejected alternatives, and why the chosen option is clearly superior.
- Outside any Issue (a plain conversational task): surface the same as a one-line "Auto-decided: `<choice>` over `<alt>` because `<reason>`" note in your reply.

## Environment Variables

The following variables are required for `scripts-ai/` functionality. Store them in a `.env` file at the project root (loaded automatically by the AI scripts). See [docs/scripts-ai.md](https://github.com/joshuafolkken/kit/blob/main/docs/scripts-ai.md) for setup instructions including how to obtain these values.

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

- Use `function` syntax, not arrow functions. Exception: in SvelteKit route files, the named route handlers (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`OPTIONS`/`HEAD`/`load`/`actions`/`fallback`) may use the typed-const arrow idiom (`export const load: PageLoad = async () => {}`) — it preserves generated `PageData` / `LayoutData` type inference. Any other exported arrow const in a route file is still flagged.
- Multiple functions in a file: group into a namespace object `export { my_module }` (constants exempt)
- No `export default`

### Files

- Svelte: `PascalCase.svelte` / `PascalCase.svelte.ts` · TypeScript: `kebab-case.ts` · Route files: exception
- Test files: `*.test.ts` (node/unit) / `*.svelte.test.ts` (component/browser) — never `*.spec.ts`; colocate beside the code under test (no top-level `tests/`). Lint-enforced by `eslint/rules/test-filename.js`.
- `scripts/` is grouped into subdirectories (`init/`, `josh/`, `version/`, `sync/`, `git/`, `issue/`, `overrides/`). Relative parent-directory imports (`../`) are banned by ESLint (`no-restricted-imports`). For cross-directory imports inside `scripts/`, use the `#scripts/*` subpath import (mapped via `package.json` `imports`), e.g. `import { schema } from '#scripts/schemas'`. Same-directory and into-subdirectory imports stay relative (`./sibling`, `./group/file`).

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
- **NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation. `devEngines` pins the required development toolchain (e.g. pnpm version); silently changing it can break CI or other contributors' environments. After any dependency-update command, verify `devEngines` was not changed **outside the legitimate `josh latest` pnpm bump** (defined next). If it was changed in any other way, restore it immediately and ask the user before making any change.
  - **Exception — the `josh latest` lockstep pnpm bump is expected, NOT a violation.** `josh latest` deliberately bumps `devEngines.packageManager.version` in lockstep with the top-level `packageManager` pin (see `scripts/version/latest-corepack.ts` → `sync_development_engines_after_bump`); the two MUST stay exactly equal (pnpm only suppresses the dual-declaration warning on an exact match). So after `josh latest`, **KEEP** a `devEngines.packageManager.version` change **if and only if** it now equals the new `packageManager` version (same pnpm version string; only the `version` field moved). Reverting it would both undo a valid toolchain update **and** re-introduce a `packageManager`/`devEngines` mismatch — the opposite of the rule's intent. **Restore + ask only** when devEngines changed in some OTHER way: its version no longer matches `packageManager`, its structure changed (`name` / `onFail` / fields added or removed), or it was touched by something other than `josh latest`.

## Package-First Development

- Before building any system or feature, do NOT write original code first — check whether a well-maintained existing package already solves the problem.
- Prefer modern, actively-maintained packages. Evaluate candidates on maintenance/activity, popularity, bundle size, TypeScript support, license, and fit. **If one package is clearly the best fit, select it and proceed** (Tier A — log the choice and rationale per "Decision autonomy"). **Only when two or more candidates are genuinely close**, present about three options ranked in a comparison table and let the user choose.
- For existing code as well, proactively propose replacing hand-rolled implementations with a suitable package when it improves maintainability.

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

**UI verification (screenshot):** Any change that affects the rendered UI — new or modified components, layout, styling, user-visible copy, visible state, or interactions — is **not** done until you have actually looked at the rendered result. Capture a screenshot of the affected screen (in this project: the `/verify` or `/run` skill launches the app, or add a Playwright `page.screenshot()` to the relevant `*.e2e.ts`) and confirm it matches the intent before reporting completion. **Passing unit/E2E tests are not proof the UI looks correct** — tests routinely stay green while layout, spacing, or styling is visibly broken. If your environment cannot produce a screenshot, say so explicitly and ask the user to verify visually; never report a UI change as done on tests alone.

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
- Write tests for existing behavior **before** making any structural changes — this is mandatory and not optional.

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
- **No PR merges, branch deletions, force pushes, or other shared-state mutations** unless explicitly requested in the current turn. The default end state is PR still OPEN — do not run `gh pr merge` on your own. **Exception**: invoking `fullrun` or `fullrun new` is explicit authorization to merge; use `pnpm josh followup --merge` in that flow.
- For git operations: use `pnpm josh git`
- **Recovery after failed push**: If `pnpm josh git -y` fails at the push step (e.g. pre-push hook blocked), fix the issue, push manually, then run `pnpm josh pr` (or `pnpm josh git -y --skip-commit --skip-push`) to create the PR. **Never** use `gh pr create` directly — it bypasses `closes #N` generation and the Issue will not auto-close.
- **Start-of-conversation git status is a stale snapshot.** The `gitStatus` block in the environment preamble is captured once at session start and never refreshes. Before acting on any assumption about working-tree / index / stash / branch state, run `git status` live first. Never report state or propose a plan based on the snapshot alone.

## Collaboration Workflow

- For issue-driven proposal/plan/execution/notification flow, follow `prompts/collaboration-workflow.md`

### Shorthand Commands

#### Explicit invocation required (MANDATORY)

Never start a `kickoff` / `halfrun` / `fullrun` / `queue` workflow (including their `#N` and `new` variants) unless the user has typed the keyword in the **current turn's prompt**.

- Conversational requests like "implement X", "fix Y", "open a PR for Z" are **NOT** implicit invocations. Even if the task clearly fits one of these workflows, do not infer authorization from the request shape.
- Do **NOT** ask confirmation questions like "May I proceed with `halfrun new`?" or "Shall I run `fullrun`?". A confirmation prompt is not an acceptable substitute for explicit invocation.
- Instead, **prompt the user to type the command themselves**. Use the exact phrasing: "Please run \`<command>\` to start this task." For example: "Please run \`halfrun new\` to start this task." or "Please run \`fullrun #412\` to execute this Issue." The user must type the command on the next turn.
- This rule applies even when the user has previously authorized a related workflow in an earlier turn. Each invocation must be re-typed by the user in the current turn.

#### `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: Read existing Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → analyze requirements → post the plan to the Issue (if body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`) → send Telegram notification → **stop** (do not implement). Plan comments MUST be in English. Telegram notification: `pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>\n...'`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are auto-fetched from `gh` when not supplied. Include line breaks between bullets for readability. The Issue URL must be included.
- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (0) **Scope assessment**: Analyze whether the request contains multiple independent deliverables that could each be merged separately. If multiple → follow the **multi-issue split path**; if single → follow the **single-issue path**. **Single-issue path**: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Post the plan in English (same body/comment logic as `kickoff #<N>`). (4) Send Telegram notification (same format as `kickoff #<N>`). (5) **Stop** — do not implement. **Multi-issue split path**: (1) For each independent deliverable, derive a focused English title and create a separate Issue: `gh issue create --title "<sub-title>" --body "<body>"`. Capture each Issue number `<N1>`, `<N2>`, etc. (2) Post a comment on the first Issue explaining the split rationale and listing all Issue numbers/titles. (3) Send Telegram notification listing all created issues (same format as `kickoff #<N>`). (4) Present the command `queue #N1 #N2 ...` to the user. (5) **Stop** — do not implement.

#### `fullrun` — Full execution (plan → implement → PR → completion notify)

- `fullrun #<N>`: Read Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank (use `gh issue edit <N> --body "<plan>"`); if the body already has content, skip the plan-posting step → implement → `pnpm josh bump minor` → `pnpm josh git -y` → run `/review` skill → `pnpm josh followup --merge` → `pnpm josh ms` (full run from Step 3 onward in `prompts/collaboration-workflow.md`). Issue plan comments MUST be written in English. Before implementing, run `git switch main && git pull`, then `josh latest` (includes `pnpm audit`; fix with `overrides` in `package.json` if vulnerabilities found). **After `josh latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding (do NOT remove intentional overrides without user approval). Also verify `devEngines` was not changed except for the legitimate `josh latest` pnpm bump (its `version` now matching the new `packageManager` pin is expected — **keep it**); restore + ask only if it changed in any other way (see the `devEngines` protection rule above).** After committing, run the `/review` skill on the completed PR diff; fix all high/medium-priority findings and re-run until clean before proceeding to `followup`. When running `pnpm josh followup --merge`, compose an implementation summary in English and pass it via `--notify-message`. Format: `"Implemented <title>:\n- <change1>\n- <change2>\n..."` (one bullet per meaningful change — what was added, changed, or fixed). **`pnpm josh followup --merge` waits for CI, verifies AI review findings, sends the completion notification, then merges — all in one step. If AI review blockers are found, followup exits non-zero; fix the findings and re-run `pnpm josh followup --merge`.** **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun` always ends on the default branch.**
- `fullrun new` or `fullrun new "<title>"`: Shortcut that combines `kickoff new` + `fullrun #<N>` into a single run. Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"`. Capture the new Issue number `<N>`. (3) Add `in-progress` label: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`. (4) Post the agreed plan in English. (5) If the working tree already has staged or modified files (e.g., user pre-staged kit/config changes), stash them first: `git stash`. (6) Run `git switch main && git pull`. (7) Run `josh latest` — **mandatory, never skip even if the working tree had modifications**. **After `josh latest`: verify `pnpm.overrides` was not modified — if any override was auto-removed or changed, restore it before proceeding. Also verify `devEngines` was not changed except for the legitimate `josh latest` pnpm bump (its `version` now matching the new `packageManager` pin is expected — **keep it**); restore + ask only if it changed in any other way (see the `devEngines` protection rule above). If you stashed changes in step 5, restore them now: `git stash pop`.** (8) Implement. (9) `pnpm josh bump minor`. (10) `pnpm josh git -y "<title> #<N>"`. (11) Run `/review` skill on the completed PR diff; fix all high/medium-priority findings and re-run until clean. (12) `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\n- <change1>\n- <change2>\n..."`. (13) **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun new` always ends on the default branch.**

#### `halfrun` — Implement + verify, stop before commit (for manual verification)

`halfrun` sits between `kickoff` (plan only) and `fullrun` (full execution with auto-merge). It runs the full implementation + verification pipeline but **stops before commit** so the user can manually verify the change (typically by exercising the UI in a browser) before committing and merging. Use `halfrun` when the change needs human eyes before shipping.

- `halfrun #<N>`: Read Issue #N → **normalize the title** (same as `fullrun`) → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank → run `git switch main && git pull`, then `josh latest` (verify `pnpm.overrides` is unchanged and `devEngines` changed only by the expected `josh latest` pnpm bump; restore if otherwise modified) → implement → run the **full verification gate** (refactor → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain) → send a `confirmation` Telegram with the resume commands in the body → **stop**. Plan comments MUST be in English. The `confirmation` Telegram body MUST include the exact resume commands: `pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'halfrun ready for manual verification\nNext: pnpm josh bump minor && pnpm josh git -y "<title> #<N>" && pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>:\\n- <change1>\\n- ..."'`. **Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup` yourself; the user runs those manually after verifying. If the user comes back with fixes, treat each round as: implement → re-run the verification gate → send another `confirmation` Telegram → stop.
- `halfrun new` or `halfrun new "<title>"`: Shortcut that combines `kickoff new` + `halfrun #<N>`. Steps mirror `fullrun new` (1)–(8): (1) Derive an English title or use the provided title. (2) `gh issue create --title "<title>" --body "<body>"`. Capture `<N>`. (3) Add `in-progress` label. (4) Post the agreed plan in English. (5) `git stash` if the working tree has changes. (6) `git switch main && git pull`. (7) `josh latest` — **mandatory**. Verify `pnpm.overrides` is unchanged and `devEngines` changed only by the expected `josh latest` pnpm bump; `git stash pop` if stashed. (8) Implement. (9) Run the verification gate (refactor / lint / tsc / cspell / test:unit / `/review` on `git diff main`). (10) Send the `confirmation` Telegram (same body as `halfrun #<N>`) and **stop**. Do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup`.

#### `queue` — Sequential multi-issue fullrun

`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `josh latest` once (before the first issue) — **mandatory, never skip**. Verify `pnpm.overrides` is unchanged and `devEngines` changed only by the expected `josh latest` pnpm bump. If you stashed changes, restore them: `git stash pop`.
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

`pnpm josh followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm josh followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR and proceeds to completion.

#### Config file update check (during `pnpm josh followup`)

After CI status checks complete during `pnpm josh followup`, inspect `git diff main...HEAD` to determine whether the PR contains changes to files managed and distributed by `josh sync` (e.g., `playwright.config.ts`, `.github/workflows/ci.yml`). If any managed config file was updated, stop before making any subsequent commit and send a `confirmation` Telegram notification:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'CI status check indicates a managed config file was updated\nPlease review the changes before proceeding'
```

- Do not make any follow-up commit, fix, or proceed to merge until the user explicitly confirms
- This check runs independently of AI reviewer comment scanning — both may trigger in the same workflow run

#### `/review` → `followup --merge` chain rule (MANDATORY)

Within `fullrun` / `fullrun new` / `queue`, the `/review` skill output is **not** a turn boundary — it is an intermediate step, not a finished deliverable.

**`fullrun` STOPPING CONDITIONS** (the chain ends only here):

1. **PR is merged, the `completion` Telegram notification has been sent, AND `pnpm josh ms` has returned the working tree to the default branch** — normal end state.
2. **A genuine blocker requires user judgment** — exactly three count:
   - A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive.
   - The managed config-file confirmation gate (`josh sync`-distributed files in the diff).
   - A CI failure that requires user input to resolve.

   Send a `confirmation` Telegram **before** stopping.

**Everything else — including `/review` producing a polished "Approve for merge" recommendation — is NOT a stopping condition.** Continue straight to `pnpm josh followup --merge` in the same turn.

**Decision table** (map `/review` result → next action mechanically):

| `/review` result                        | Findings severity  | Next action (same turn, no user input)                                                                              |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None               | Immediately run `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                  |
| Low findings only                       | Low                | Immediately run `pnpm josh followup --merge` (Low may be skipped with a one-line reason)                            |
| One or more High / Medium findings      | High and/or Medium | Fix in place, re-stage, commit, push, re-run `/review`, loop. Do NOT report narratively and wait. Do NOT merge yet. |
| `/review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram                                                            |

The recommendation line at the bottom of `/review` ("Approve for merge", etc.) is informational, not authoritative. **Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text resembling any of the following, you are violating the chain rule. Cancel the message; run `pnpm josh followup --merge` instead.

- "The `/review` is clean — ready to merge. Shall I proceed with `followup --merge`?"
- "`/review` found no high/medium findings. Approve for merge after you confirm."
- "Recommendation: Approve for merge. Let me know if you'd like me to continue."
- "All green. Awaiting your go-ahead to merge."
- "The review is complete. Should I run `pnpm josh followup --merge` now?"
- Posting the `/review` Markdown output and then stopping the turn without a tool call.
- Listing low-severity findings narratively and asking whether they should block merge.
- Treating CodeRabbit rate-limit warnings as findings.

All share one shape: presenting `/review` output to the user and waiting. **The user invoked `fullrun`; merging is part of that invocation. The chain ends at a stopping condition above, never at `/review` output.**

This rule applies regardless of model (Claude / Gemini / Cursor) or account; the workflow is portable and the chain must hold across environments.

**Turn-end self-check (fullrun-conditional) — run BEFORE sending any response that contains `/review` output**

The chain rule above has been violated repeatedly even with the decision table and anti-pattern catalog. Run this check, in order, before sending any response that contains `/review` output:

1. **Mode check** — Is this `/review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) `pnpm josh git -y` has already been run in this session and a PR exists. If either is false → **standalone mode**; stop after the review, do NOT call `followup --merge`.
2. **Severity check** — Count high/medium findings. If ≥1 → fix, re-stage, commit, push, re-run `/review`. Do NOT call `followup --merge` yet.
3. **Append check** — In fullrun mode AND 0 high/medium findings: the same response that contains the `/review` markdown MUST also contain a `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` tool call. **A response whose final assistant text is `/review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call.

Treat the `/review` skill's output as an intermediate tool result, not a deliverable.

See `prompts/collaboration-workflow.md` → "Chain rule: `/review` → `followup --merge` decision table" for the canonical extended reference.

#### `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup --merge`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. Invoking `fullrun` is itself the explicit authorization to merge. **After the merge succeeds, always run `pnpm josh ms` (= checkout default branch + `git pull`) to return the working tree to the default branch with the merge commit pulled. `fullrun` / `fullrun new` / `queue` always end on the default branch.**

- **AI review findings are checked automatically.** If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run.
- **CodeRabbit rate-limit is not a finding.** Treat it as "no findings" and proceed.
- **Verify CodeRabbit findings before bypassing.** When CodeRabbit posts a substantive finding, do not pass `--coderabbit-ignore-reason` reflexively — first verify whether the finding is correct. Concrete example: CodeRabbit may flag a GitHub Actions SHA pin like `pnpm/action-setup@<sha> # v6.0.8` as "not matching the tag", because it queried `gh api repos/<owner>/<repo>/git/ref/tags/v6.0.8` which returns the **annotated-tag-object SHA**, not the **commit SHA** that the tag points to. GitHub Actions pins use the commit SHA. Confirm with `gh api repos/<owner>/<repo>/commits/<tag> --jq '.sha'` — if that matches the pinned SHA, the finding is a false positive. Only then bypass with `--coderabbit-ignore-reason "<verification-based-reason>"`, citing the verification command and its output.
- Do **not** pass `--delete-branch` unless the user asks.
- If the merge fails, report the reason and stop — do not retry with different flags or bypass protections.
- **If the user wants to skip the merge step**, use `kickoff` (plan-only) or say "do not merge" in the same turn. In that case, pass `--no-merge` to `pnpm josh followup`. Outside a `fullrun` invocation, never run `gh pr merge` on your own.

#### Completion notifications: always via `pnpm josh followup`

Never send `completion` Telegram notifications manually with `pnpm josh notify --task-type completion ...`. Always use `pnpm josh followup`.

**Always run `pnpm josh followup` in the foreground** (no `&` suffix, no shell backgrounding). It waits for CI and can take several minutes. Background processes started with `&` do not survive when the tool call returns — the command will silently disappear and the PR will remain unmerged.

- Applies to the initial PR and every follow-up commit — re-run `pnpm josh followup "<title> #<N>" --merge --notify-message "..."` each time.
- `pnpm josh notify` remains the right tool for `planning`, `confirmation`, `kickoff_retry`, and `failure` notifications.
- **Project version is surfaced at completion.** When `pnpm josh followup` finishes, it prints the consumer project's version as the final console line (`📦 project version: <v>`, read from the project's own `package.json` — the value `josh bump` increments, **not** the kit tool's version) and includes the same line in the `completion` Telegram body. The just-shipped version is therefore visible at the end of every completed `fullrun` / `queue`. Surface it as the closing line of your completion summary.

#### Mid-workflow stop notification (`confirmation`)

Whenever the AI tool pauses a `kickoff` / `halfrun` / `fullrun` mid-execution to wait for user confirmation, it MUST send a Telegram notification **before** stopping. `halfrun`'s built-in stop before commit is a confirmation pause and follows this same rule — the resume-command body required by the `halfrun` section above is the specific form for that case:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
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
