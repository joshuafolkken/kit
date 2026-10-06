# Claude Code Instructions

> The entry point for every agent rule — `AGENTS.md`, `GEMINI.md` and `.cursorrules` point here; each rule has a single source (`prompts/collaboration-workflow/residency.md`).

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Communication

- **Answer opinion-seeking questions from a neutral standpoint.** A leading question is not a cue to agree — recommend the option you genuinely judge best.
- **Fix root causes, not symptoms.** Where the proper fix is out of scope, surface the root cause instead of papering over it.
- **Cross-package problems → file the upstream Issue, then stop.** A defect in another package (a dependency, or `josh` / kit tooling) is never worked around locally — **weakening a verification gate is a workaround too**. File it (first-party Tier A, third-party Tier C) and stop. `prompts/collaboration-workflow/upstream-interrupt.md`. Your own repository's run tooling is not another package: `upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合".
- **Third-party repositories are Tier C.** Decide the party with `pnpm josh repo:party`; every write to a tracker we do not own needs explicit current-turn instruction. `prompts/collaboration-workflow/upstream-interrupt.md`.
- **No clones — single-source, even across package boundaries.** Duplicate non-trivial logic only after presenting the alternative and getting explicit approval. `prompts/collaboration-workflow/principles.md` → "no-clones".
- **Design for elegance and simplicity first.** Before adding a hook, guard, rule or abstraction, ask whether fixing the cause makes it unnecessary. `prompts/collaboration-workflow/principles.md` → "elegant-design".
- **Distinguish consultation from execution.** A question or goal statement asks for analysis only — act on an explicit imperative or a workflow keyword. `prompts/collaboration-workflow/principles.md` → "consult-vs-execute".
- **Route distributed-doc / config changes upstream to kit.** In a consumer repo never edit kit-distributed docs/config (`josh sync` overwrites them); in kit you are the source. `prompts/collaboration-workflow/principles.md` → "upstream-to-kit".
- **Latest-first, fix forward — pin back only as a last resort.** `prompts/collaboration-workflow/principles.md` → "latest-first".
- **Output language follows `JOSH_SESSION_LANG`** (default `ja`) for session output and artifact prose; English for Issue/PR titles, code comments, test titles, commit messages and script strings. `prompts/collaboration-workflow/overview.md`.
- **Cite an Issue with a number-link and a short title in the session language.** `prompts/collaboration-workflow/issue-citation.md`.
- **Durable rules belong in prompts/docs, not local MEMORY.** `prompts/collaboration-workflow/principles.md` → "durable-rules".
- **Never carry a file's new text inside a shell command.** Use the Edit tool, not a heredoc. `prompts/collaboration-workflow/file-edits.md`.
- **Never put a body in shell double quotes** — a backtick or `$` there is _executed_; pass the body by path. `prompts/collaboration-workflow/shell-body.md`.
- **Put every call that does not depend on another's result in the same turn.** **The criterion is whether this call's input needs another call's result, not what kind of call it is** — edits are covered exactly as reads are. `pnpm josh batch:guard` enforces it; `prompts/collaboration-workflow/rule-delivery.md`.

### Decision autonomy

Classify each decision point and act; stop **only** where the user's judgment is genuinely needed. `prompts/collaboration-workflow/operating-rules.md` → "decision-autonomy".

- **Tier A — reversible implementation / design choices** (library, naming, layout, tests, refactor shape; placing a filed Issue into an epic; self-correction). Pick the clearly-better option, proceed, log it.
- **Tier B — genuine toss-up.** The only tier that stops — ask with the candidates and trade-offs.
- **Tier C — irreversible / shared-state / out-of-scope actions** (merge, branch delete, force push, destructive ops, repo settings, out-of-scope work, `devEngines` / overrides edits): explicit user instruction only, never auto-decided. Deleting a git-tracked file is reversible, so it is not a destructive op — inspect the target first and surface any contradiction.

Log auto-decisions: an Issue comment in an Issue workflow, else a one-line "Auto-decided: `<choice>` over `<alt>` because `<reason>`" in the reply.

## Environment Variables

`.env`: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` required; `JOSH_SESSION_LANG`, `PORT_SEED`, `JOSH_REPO_PATHS` optional — [environment-variables.md](https://github.com/joshuafolkken/kit/blob/main/docs/environment-variables.md). **GitHub operations are `gh api` (REST)** — `prompts/collaboration-workflow/gh-rest.md`.

## Critical Conventions (non-standard — always apply)

Most are lint-enforced; `function` syntax and the early-return one-liner are not. Craft guidance: `prompts/coding-standards.md`.

### Naming

`snake_case` variables / functions / params · `PascalCase` types / classes / interfaces / enums · `UPPER_CASE` enum members · booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_` · constants `UPPER_CASE` or `snake_case`.

### Functions & exports

`function` syntax, not arrows (named SvelteKit route handlers may use the typed-const arrow idiom) · multiple functions → a namespace object `export { my_module }` (constants exempt) · no `export default`.

### Files

Svelte `PascalCase.svelte(.ts)` · TypeScript `kebab-case.ts` · tests `*.test.ts` / `*.svelte.test.ts`, colocated, never `*.spec.ts` (`prompts/testing-guide.md`) · in `scripts/`, no `../` imports — use `#scripts/*`.

### Quality limits

- Function complexity ≤5 · nesting ≤2 · function ≤25 lines · file ≤300 lines · params ≤4 · statements per function ≤10 · cognitive complexity ≤4 — line counts are code lines, not physical lines (`pnpm josh lint`); test files allow 35 code lines per function.
- No magic numbers beyond `0`, `1`, `-1` · no `any` · restricted `as` · explicit param and return types · single short early return → one-liner `if (x) return y`.

### Content rules

- i18n: user-visible strings use message keys in every locale.
- Comments / test titles: English only (`eslint/rules/` may explain rationale in Japanese).
- No duplication; `/* @refactor-ignore */` at file top excludes a file from refactoring.

### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)

- Effective overrides live in `pnpm-workspace.yaml`; check both files.
- **NEVER** remove or modify entries in **either** location without explicit user approval.
- **NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation — except the `josh latest` lockstep pnpm bump, kept per the `dependency-update` skill.
- After any dependency-update command, load the `dependency-update` skill before reporting anything about the pins.

## Package-First Development

Before building a feature, check for a well-maintained package — measure with `pnpm josh pkg:scout <keywords>`: `clear` → select it (Tier A), `close` → ask (Tier B).

## Code Change Rules

0. **Work summary + test declaration** — before writing any implementation code, once per Issue (required in fullrun/halfrun/prrun/backlogrun; `kickoff` exempt), never wrapped in a code fence, never a confirmation stop. `prompts/collaboration-workflow/report-format.md`; `pnpm josh report:lint`.
   - **Overview** — **Now / Change / Check**, one sentence each in the session language that a non-programmer can follow; name the concrete subject in each line — subject-less prose is not acceptable. Use no file paths, function or type names, or CLI option flags — only internal identifiers are banned.
   - **Details** — every change with its test: `<what changes> — Test: <Unit|E2E> — <file path> — <what it verifies>`. Completion reports lead with **Cause / Fix / Result**.
   - **Tests are required for ALL changes** — zero tests without explicit approval is a violation. Exceptions (non-runtime and basic-profile manual checks): `prompts/testing-guide.md`. `pnpm josh test:declared` answers from the changed paths; a runtime change with no test is refused at `pnpm josh git -y` on `required`.
   - Read a target's headroom first: `pnpm josh lines <path>`.
1. **Refactor first** — `prompts/refactoring.md`; no high/medium refactoring left on new/modified code.
2. **Tests** — those declared in Step 0 (`prompts/testing-guide.md`).
3. **Verification gate** — `pnpm josh gate`; while implementing re-run one check (`pnpm josh lint:related` / `pnpm josh cspell:dot` / `pnpm josh test:related`). Add legitimate flagged terms to `cspell.config.yaml`.
4. **IDE feedback** — zero errors on changed files; never say "it should pass" without running it. Do not modify `eslint.config.js` unless asked.

## Completion gate (before you tell the user work is done)

In order, none skipped: tests (Step 0) → refactor → `pnpm josh gate` → Pre-commit Self-Review → IDE feedback → E2E (`prompts/testing-guide.md` → "Closing the E2E gate without a human run") → live-execution evidence (`prompts/collaboration-workflow/report-format.md`). **UI verification:** a rendered-UI change is not done until you have looked at it with `/verify-ui`, or asked the user to.

## Pre-commit Self-Review (mandatory)

Before every `git commit`, a subagent runs `/code-review` per `prompts/review.md` — level from `pnpm josh review:brief --level-only`, no further than the round cap (`prompts/review.md` → "Review round cap"). Each remaining non-High finding: fix it, file it as a follow-up Issue only when it is a confirmed defect that reaches a runtime path (`pnpm josh disposition <path>`), or drop it with a PR note.

## Doc Sync Rules

When `josh bump` changes the version, update `docs/` for any changed behavior before committing.

## Git Rules

- **No commits** unless explicitly requested. **No merges, branch deletions, force pushes or other shared-state mutations** unless requested in the current turn — except invoking `fullrun` or `backlogrun` authorizes the merge via `pnpm josh followup`; `prrun` does not. `.claude/settings.json` denies these, but the deny is narrower than the rule — never read "the tool let me" as permission.
- **Never stage or mutate the git index on your own** — only on explicit instruction or via `pnpm josh git`. `prompts/collaboration-workflow/operating-rules.md` → "no-self-staging".
- **Use `pnpm josh git`; open a PR with `pnpm josh pr`** — `pnpm josh rule:guard` refuses a direct `gh pr create`.
- **Run `git status` (and `git stash list`) live** before acting on any tree assumption.

## Collaboration Workflow

- The issue-driven flow: `prompts/collaboration-workflow.md`; where a new rule goes: `prompts/collaboration-workflow/residency.md` (computable answers → `pnpm josh oracle:list`, ordering → `pnpm josh run:step`).
- **File through `pnpm josh issue:file`, never a hand count; above the WIP cap, close one first.** Exempt: a filing the run is blocked by, and an **interrupt** — a verification answers wrongly, a documented workflow cannot complete, or data is lost or written outside the repository; both proceed, stating the overage, and anything else stays discretionary. `pnpm josh rule:guard` states the rest at the call that files. `prompts/collaboration-workflow/wip-cap.md`.

### Shorthand Commands

`kickoff`, `fullrun`, `prrun`, `halfrun`, `backlogrun` (with `#N` / `new`) are procedures in the `workflow-commands` skill — read it before any part of a command, including the first `gh` call.

**`queue` and `epicrun` were removed** — point `queue` to `backlogrun #N1 #N2 …` and `epicrun` to `backlogrun #E --only`.

Read the `epic-commands` skill before any `josh epic:*` command, before writing an epic that tracks a child in another repository, and when `epic:bundle` places a filed issue. Three rules bind outside it:

- Recording a decision removes that child's `needs-decision` label (Tier A).
- **Fixing what the audit finds is Tier A**; park only when the contradiction is a design choice nobody has made.
- **An epic in another repository is referenced as `owner/repo#N`** — a bare `#N` resolves to this repository's issue.

#### Explicit invocation required (MANDATORY)

Never start a `kickoff` / `halfrun` / `prrun` / `fullrun` / `backlogrun` workflow (`#N` / `new` included) unless the user typed the keyword in the **current turn's prompt** — a conversational request ("implement X") is not one, and an earlier turn's authorization does not carry over. Never ask "Shall I run `fullrun`?"; say "Please run \`<command>\` to start this task." A resumed `backlogrun` inside its declared budget continues (`backlogrun-steps.md` → "The session cut is inside the invocation").

#### Mid-workflow stop notification (`confirmation`)

Before pausing **any** run for the user — a command's stop, an upstream-Issue interrupt, a Tier C confirmation — send once per stop (skip when the user asked for the stop this turn):

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```
