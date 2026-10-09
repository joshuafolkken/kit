# Claude Code Instructions

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Communication

- **Answer opinion-seeking questions from a neutral standpoint.** A leading question is not a cue to agree — recommend the option you genuinely judge best.
- **Fix root causes, not symptoms.** Where the proper fix is out of scope, surface the root cause instead of papering over it.
- **Cross-package problems → file the upstream Issue, then stop.** A defect in another package (a dependency, or `josh` / kit tooling) is never worked around locally — **weakening a verification gate is a workaround too**. File it (first-party Tier A, third-party Tier C) and stop. `prompts/collaboration-workflow/upstream-interrupt.md`. Your own repository's run tooling is not another package: `upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合".
- **Third-party repositories are Tier C.** Decide the party with `pnpm josh repo:party`; every write to a tracker we do not own needs explicit current-turn instruction. `prompts/collaboration-workflow/upstream-interrupt.md`.
- **No clones — single-source, even across package boundaries.** Duplicate non-trivial logic only after presenting the alternative and getting explicit approval. `prompts/collaboration-workflow/principles.md` → "no-clones".
- **Design for elegance and simplicity first.** Before adding a hook, guard, rule or abstraction, ask whether fixing the cause makes it unnecessary. `prompts/collaboration-workflow/principles.md` → "elegant-design"; conflicting quality goals → "quality-priority".
- **Distinguish consultation from execution.** A question or goal statement asks for analysis only — act on an explicit imperative or a workflow keyword. `prompts/collaboration-workflow/principles.md` → "consult-vs-execute".
- **Route distributed-doc / config changes upstream to kit.** In a consumer repo never edit kit-distributed docs/config (`josh sync` overwrites them); in kit you are the source. `prompts/collaboration-workflow/principles.md` → "upstream-to-kit".
- **Latest-first, fix forward — pin back only as a last resort.** `prompts/collaboration-workflow/principles.md` → "latest-first".
- **Output language follows `JOSH_SESSION_LANG`** (default `ja`) for session output and artifact prose; English for Issue/PR titles, code comments, test titles, commit messages and script strings. `prompts/collaboration-workflow/overview.md`.
- **Durable rules belong in prompts/docs, not local MEMORY.** `prompts/collaboration-workflow/principles.md` → "durable-rules".
- **Hook-delivered rules** (file edits, shell bodies, turn batching, Issue citation, …): `prompts/collaboration-workflow/rule-delivery.md` → "配送されている規則".

### Decision autonomy

Classify each decision point and act; stop **only** where the user's judgment is genuinely needed. `prompts/collaboration-workflow/operating-rules.md` → "decision-autonomy".

- **Tier A — reversible implementation / design choices** (library, naming, layout, tests, refactor shape; placing a filed Issue into an epic; self-correction). Pick the clearly-better option, proceed, log it. Unasked filing: unattended only (`observation-filing.md`).
- **Tier B — genuine toss-up.** The only tier that stops — ask with the candidates and trade-offs.
- **Tier C — irreversible / shared-state / out-of-scope actions** (merge, branch delete, force push, destructive ops, repo settings, out-of-scope work, `devEngines` / overrides edits): explicit user instruction only, never auto-decided. Deleting a git-tracked file is reversible, so it is not a destructive op — inspect the target first and surface any contradiction. After a dependency-update command, load the `dependency-update` skill before reporting on the pins.

Log auto-decisions: an Issue comment in an Issue workflow, else a one-line "Auto-decided: `<choice>` over `<alt>` because `<reason>`" in the reply.

## Critical Conventions (non-standard — always apply)

Naming, exports, file names and content rules are enforced by `eslint/rules/`; their single source is `prompts/coding-standards.md` → "Conventions". `function` syntax, not arrows (named SvelteKit route handlers may use the typed-const arrow idiom) — lint does not check it.

### Quality limits

- Function complexity ≤5 · nesting ≤2 · function ≤25 lines · file ≤300 lines · params ≤4 · statements per function ≤10 · cognitive complexity ≤4 — line counts are code lines, not physical lines (`pnpm josh lint`); test files allow 35 code lines per function.
- No magic numbers beyond `0`, `1`, `-1` · no `any` · restricted `as` · explicit param and return types · single short early return → one-liner `if (x) return y`.

## Package-First Development

Before building a feature, check for a well-maintained package — measure with `pnpm josh pkg:scout <keywords>`: `clear` → select it (Tier A), `close` → ask (Tier B).

## Code Change Rules

0. **Work summary + test declaration** — before writing any implementation code, once per Issue: Now / Change / Check, then every change with its test (`prompts/collaboration-workflow/report-format.md` → "作業前サマリはいつ・どう出すか"). **Tests are required for ALL changes** — zero tests without explicit approval is a violation; a runtime change with no test is refused at `pnpm josh git -y` on `required` (`pnpm josh test:declared`).
1. **Refactor first** — `prompts/refactoring.md`; no high/medium refactoring left on new/modified code.
2. **Tests** — those declared in Step 0 (`prompts/testing-guide.md`).
3. **Verification gate** — `pnpm josh gate`; while implementing re-run one check (`pnpm josh lint:related` / `pnpm josh cspell:dot` / `pnpm josh test:related`). Add legitimate flagged terms to `cspell.config.yaml`.
4. **IDE feedback** — zero errors on changed files; never say "it should pass" without running it. Do not modify `eslint.config.js` unless asked.

## Completion gate (before you tell the user work is done)

In order, none skipped: tests (Step 0) → refactor → `pnpm josh gate` → Pre-commit Self-Review → IDE feedback → E2E (`prompts/testing-guide.md` → "Closing the E2E gate without a human run") → live-execution evidence (`prompts/collaboration-workflow/report-format.md`). **UI verification:** a rendered-UI change is not done until you have looked at it with `/verify-ui`, or asked the user to.

## Pre-commit Self-Review (mandatory)

Before every `git commit`, a subagent runs `/code-review` per `prompts/review.md` — level from `pnpm josh review:brief --level-only`, no further than the round cap, then the three-way disposition (`prompts/review.md` → "Review round cap").

## Git Rules

- **No commits** unless explicitly requested. **No merges, branch deletions, force pushes or other shared-state mutations** unless requested in the current turn — except invoking `fullrun` or `backlogrun` authorizes the merge via `pnpm josh followup`; `prrun` does not. `.claude/settings.json` denies these, but the deny is narrower than the rule — never read "the tool let me" as permission.
- **Never stage or mutate the git index on your own** — only on explicit instruction or via `pnpm josh git`. `prompts/collaboration-workflow/operating-rules.md` → "no-self-staging".
- **Use `pnpm josh git`; open a PR with `pnpm josh pr`** — `pnpm josh rule:guard` refuses a direct `gh pr create`. GitHub operations are `gh api` (REST) — `prompts/collaboration-workflow/gh-rest.md`.
- **Run `git status` (and `git stash list`) live** before acting on any tree assumption.

## Collaboration Workflow

The issue-driven flow: `prompts/collaboration-workflow.md`.

### Shorthand Commands

`kickoff`, `fullrun`, `prrun`, `halfrun`, `backlogrun` (with `#N` / `new`) are procedures in the `workflow-commands` skill — read it before any part of a command, including the first `gh` call. Read the `epic-commands` skill before any `josh epic:*` command, before writing an epic that tracks a child in another repository, when `epic:bundle` places a filed issue, and when recording a decision on a `needs-decision` child.

#### Explicit invocation required (MANDATORY)

Never start a `kickoff` / `halfrun` / `prrun` / `fullrun` / `backlogrun` workflow (`#N` / `new` included) unless the user typed the keyword in the **current turn's prompt** — a conversational request ("implement X") is not one, and an earlier turn's authorization does not carry over. Never ask "Shall I run `fullrun`?"; say "Please run \`<command>\` to start this task." A resumed `backlogrun` inside its declared budget continues (`backlogrun-steps.md` → "The session cut is inside the invocation").

#### Mid-workflow stop notification (`confirmation`)

Before pausing **any** run for the user — a command's stop, an upstream-Issue interrupt, a Tier C confirmation — send once per stop (skip when the user asked for the stop this turn):

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```
