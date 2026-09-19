# Claude Code Instructions

> **This file is the single source for every agent rule.** `AGENTS.md` and `GEMINI.md` are pointers to it and carry no rules of their own.
>
> Each rule is written as a **trigger plus a pointer** — enough to act safely with nothing else loaded, with the steps and rationale at the pointer.

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Communication

Each rule is a trigger and a pointer; the procedure and rationale are at the cited file.

- **Answer opinion-seeking questions from a neutral standpoint.** A leading question ("how about X?" / "〜〜ではどうか？") is not a cue to agree — weigh the merits and recommend the option you genuinely judge best, even when it differs from the one hinted at.
- **Fix root causes, not symptoms.** Diagnose the underlying cause and apply the correct fix rather than an ad-hoc workaround; where the proper fix is out of scope, surface the root cause instead of papering over the symptom.
- **Cross-package problems → file the upstream Issue, then stop.** A defect originating in another package (a dependency, or `josh` / kit tooling) is never worked around locally — **weakening a verification gate is a workaround too**, and the trigger is discovery. File it (first-party Tier A, third-party Tier C) and stop. `prompts/collaboration-workflow/upstream-interrupt.md`.
- **Third-party repositories are Tier C.** Decide first-party vs third-party mechanically with `pnpm josh repo:party` (owner equality, computed). Every write to a tracker we do not own needs explicit current-turn instruction — a correct diagnosis is not authorization to publish. `prompts/collaboration-workflow/upstream-interrupt.md`.
- **No clones — single-source, even across package boundaries.** About to replicate non-trivial logic that already lives somewhere? Stop and single-source it; duplicate only after presenting the alternative and its cost and getting explicit approval. `prompts/collaboration-workflow/no-clones.md`.
- **Distinguish consultation from execution.** A question about approach or a goal statement ("どうすべき？", "〜したい") is a request for analysis only — act only on an explicit imperative or a workflow keyword. `prompts/collaboration-workflow/consultation-vs-execution.md`.
- **Route distributed-doc / config changes upstream to kit.** In a consumer repo never edit kit-distributed docs/config locally (`josh sync` overwrites them); propose the change for kit. In kit itself you are the source. `prompts/collaboration-workflow/distributed-docs.md`.
- **Latest-first, fix forward — pin back only as a last resort.** Adopt newest versions by default and resolve a breaking bump forward, recording why on the rare pin-back. This never authorizes a silent edit to a protected pin. `prompts/collaboration-workflow/latest-first.md`.
- **Output language follows `JOSH_SESSION_LANG`** (default `ja`; a hook injects it). It governs session-facing output and artifact prose (Issue bodies, comments, Telegram). English stays for Issue/PR titles, code comments/test titles/commit messages, and script-emitted strings. `prompts/collaboration-workflow/overview.md`.
- **Cite an Issue with a number-link and a short Japanese title in session-facing output** — `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <短い要約>`. `prompts/collaboration-workflow/issue-citation.md`.
- **Durable rules belong in prompts/docs, not local MEMORY.** Encode a rule that should hold in future sessions as a change to kit's distributed prompts/docs; keep local auto-memory minimal, and propose the edit when the turn does not authorize a doc change. `prompts/collaboration-workflow/durable-rules.md`.
- **Never carry a file's new text inside a shell command.** Edit a region with the Edit tool, never a heredoc — unless the change is so scattered the partial edit would carry more text than the file. The criterion is whether the command carries the replacement wholesale, not the tool's name. `prompts/collaboration-workflow/file-edits.md`.
- **Never put a body in shell double quotes** — a backtick or `$` there is _executed_; pass the body by path. `prompts/collaboration-workflow/shell-body.md`.
- **Put every call that does not depend on another's result in the same turn.** **The criterion is whether this call's input needs another call's result, not what kind of call it is** — edits are covered exactly as reads are. `pnpm josh batch:guard` states it at the call that breaks it; enumeration in `prompts/collaboration-workflow/rule-delivery.md`, cost in `prompts/collaboration-workflow/turn-batching.md`.

### Decision autonomy (minimize confirmation stops)

Classify each decision point into one tier and act; stop **only** when the choice genuinely needs the user's judgment.

- **Tier A — reversible implementation / design choices** (library pick, naming, file layout, test approach, refactor shape). Select the clearly-better option and proceed; log it when you would normally surface it. **Placing a filed Issue into an epic is Tier A**, as is **self-correction** (fixing a factual error you published, or closing a gap in your own work this session).
- **Tier B — genuine toss-up.** Both top options sound, margin narrow. **The only tier that stops** — ask the user (`AskUserQuestion` where available) with the candidates and trade-offs.
- **Tier C — irreversible / shared-state / out-of-scope actions** (merge, branch delete, force push, destructive ops, repo-settings changes, anything outside the task scope, `devEngines` / overrides edits). Always require explicit user instruction — never auto-decide, even when one looks clearly better or when you caused the problem. Full boundaries: `prompts/collaboration-workflow/operating-rules.md` → 「意思決定の自律ポリシー（確認停止を減らす）」.

**Logging auto-decisions:** inside an Issue workflow, post an Issue comment with the chosen option, the rejected alternatives and why; outside one, add a one-line "Auto-decided: `<choice>` over `<alt>` because `<reason>`" to your reply.

## Environment Variables

Read from a `.env` file at the project root by the AI scripts, `josh port` and `playwright.config.ts`. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are required for notifications; `JOSH_SESSION_LANG`, `PORT_SEED` and `JOSH_REPO_PATHS` are optional and personal. Setup and full semantics: [docs/scripts-ai.md](https://github.com/joshuafolkken/kit/blob/main/docs/scripts-ai.md) and [docs/josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md).

**GitHub operations are `gh api` (REST) — instructing prose included — and need `gh` installed; some environments lack it.** Auth: `gh auth login`; `GH_TOKEN` in CI/cloud. `prompts/collaboration-workflow/gh-rest.md`.

## Critical Conventions (non-standard — always apply)

### Naming

- Variables / functions / params: `snake_case`
- Types / classes / interfaces / enums: `PascalCase`; enum members: `UPPER_CASE`
- Booleans: prefix `is_` / `has_` / `should_` / `can_` / `will_` / `did_`
- Constants: `UPPER_CASE` or `snake_case`

### Functions & exports

- Use `function` syntax, not arrow functions. Exception: named SvelteKit route handlers (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`OPTIONS`/`HEAD`/`load`/`actions`/`fallback`) may use the typed-const arrow idiom (`export const load: PageLoad = async () => {}`) for type inference; any other exported arrow const in a route file is still flagged.
- Multiple functions in a file: group into a namespace object `export { my_module }` (constants exempt)
- No `export default`

### Files

- Svelte: `PascalCase.svelte` / `PascalCase.svelte.ts` · TypeScript: `kebab-case.ts` · Route files: exception
- Test files: `*.test.ts` (node/unit) / `*.svelte.test.ts` (component/browser) — never `*.spec.ts`; colocate beside the code under test (no top-level `tests/`). Lint-enforced by `eslint/rules/test-filename.js`.
- `scripts/` is grouped into subdirectories; relative parent-directory imports (`../`) are banned by ESLint — use the `#scripts/*` subpath import for cross-directory imports (e.g. `import { schema } from '#scripts/lib/schemas'`), and keep same-directory/into-subdirectory imports relative.

### Quality limits

- Function complexity ≤5 · nesting ≤2 · function ≤25 lines · file ≤300 lines · params ≤4 · statements per function ≤10 · cognitive complexity ≤4
- **Those line counts are code lines, not physical lines** (`max-lines` / `max-lines-per-function` run with `skipBlankLines` + `skipComments`) — judge by what `pnpm josh lint` reports, never `wc -l`. Test files (`*.test.ts` / `*.e2e.ts`) allow 35 code lines per function.
- Magic numbers: extract all literals except `0`, `1`, `-1` to named `UPPER_CASE` constants
- No `any` · no unused vars · no floating promises · type assertions (`as`) are restricted
- All function params and return types must be explicitly typed
- Early return: single `return` under 100 chars → one-liner `if (x) return y`; otherwise block syntax

### Svelte

- `$state` reactive variables are reassignable
- Props interface name `Props` is allowed by ESLint
- DOM manipulation is restricted

### Content rules

- i18n: all user-visible strings must use message keys — never hardcode; add to all locale message files.
- Comments / test titles (`describe` / `it` / `test` / `expect` messages): English only. Exception: `eslint/rules/` files may use Japanese comments to explain rule rationale.
- No code duplication: extract to shared functions/modules immediately
- `/* @refactor-ignore */` at file top excludes a file from refactoring

### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)

- **Overrides live in two files, and one of them alone is not the project's answer.** pnpm 11 reads them from the `overrides:` block in **`pnpm-workspace.yaml`**; `pnpm.overrides` in **`package.json`** is the legacy location. **An absent or empty `pnpm.overrides` is not evidence that the project has no overrides.**
- **NEVER** remove or modify entries in **either** location without explicit user approval.
- **NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation. It pins the development toolchain (e.g. pnpm version); silently changing it can break CI or other contributors' environments.
- **The check is a command you run, not a conclusion you reach.** After `pnpm update`, `josh latest`, or any dependency-update command, **load the `dependency-update` skill** and follow its procedure before reporting anything about the pins.

## Package-First Development

- Before building a feature, check whether a well-maintained package already solves the problem rather than writing original code first, and propose replacing hand-rolled implementations with a suitable package when it improves maintainability.
- Prefer modern, actively-maintained packages (maintenance, popularity, bundle size, TypeScript support, license, fit). **If one is clearly the best fit, select it** (Tier A — log it); **only when two or more are genuinely close**, present about three ranked options and let the user choose.

## Code Change Rules

For every code modification, in order:

0. **Work summary + test declaration** _(before any implementation code)_: a two-layer summary — a plain-language overview (three lines, **Now / Change / Check**, one sentence each, in the session language, naming the concrete subject, no file paths / function names / CLI flags), **Details**, then **every change with its test** (`<what changes> — Test: <Unit|E2E> — <file path> — <what it verifies>`). Ordinary markdown, **never in a code fence**, once per Issue before implementation (`kickoff` is exempt); completion reports lead with **Cause / Fix / Result**. `prompts/collaboration-workflow/report-format.md` (summarized in the `UserPromptSubmit` hook). Presentation, not a confirmation stop.

   - **Tests are required for ALL code changes** (bug fixes, timing/animation fixes and refactors included): bug fix → regression test; UI/animation/timing → E2E for the observable change; logic/utility → unit; refactor → tests pinning existing behavior BEFORE the change (`prompts/refactoring.md`).
   - **Non-runtime updates (pre-approved manual-only exception)**: a change touching no executable runtime code path may proceed with manual verification — declare it in Step 0 and state why. It covers docs, non-executable config, editor/IDE files, and cosmetic asset swaps with no selector/path change; the mechanically exempt (`*.md`, `.editorconfig`, `.idea/**`, `.vscode/**`, `prompts/**`) are recognized by the command below, and the rest stay the exemption a person declares. A test infeasible for a runtime change needs its reason stated and user approval.
   - **The commit stage answers this mechanically**: `pnpm josh test:declared` prints `required` / `exempt` / `satisfied` from the changed paths, and a runtime change with no test is refused at `pnpm josh git -y` on `required` — add the declared test or declare the non-runtime exception, then reissue (`prompts/collaboration-workflow/rule-delivery.md`).
   - **Read a target's line headroom before editing: `pnpm josh lines <path>`** — near the limit, `Target` carries the splitting plan.

1. **Refactor first** — apply high/medium refactoring to all new/modified code (`prompts/refactoring.md`); do not proceed until none remain.
2. **Tests** — implement those declared in Step 0 (`prompts/testing-guide.md`); prefer stable `data-testid` selectors over locale strings.
3. **Verification gate** — `pnpm josh gate` (lint, type check, spell check, unit tests **concurrently**); fix all before reporting done. Add legitimate flagged terms to `cspell.config.yaml`. Each `Edit` / `Write` triggers a `pnpm josh format:edited` hook, so a file may differ from what you wrote.
4. **IDE feedback** — check IDE lint output; never say "it should pass" without running commands, never finish while errors exist. Do not modify `eslint.config.js` unless explicitly asked.

## Completion gate (before you tell the user work is done)

Run the full verification set **in order**; do not skip, reorder, or report completion on a failed or skipped step without the user agreeing. Inside a `fullrun` / `backlogrun` the gate runs beside the review and the merge chain (`workflow-commands` skill → §2, `prompts/review.md`).

0. **Test gate** — no tests added? Continue only under the non-runtime exception (Step 0) or explicit approval; otherwise stop and add tests.
1. **Refactor** — `prompts/refactoring.md`, until no high/medium items remain.
2. **`pnpm josh gate`** — lint, type check, spell check and unit tests concurrently. One gate per run; while implementing re-run a single check by name (`pnpm josh lint:related` / `pnpm josh cspell:dot` / `pnpm josh test:related`).
3. **Self-review** — a subagent runs `/code-review` per `prompts/review.md` (never a main-line `Skill` load); level from the changed paths, at most two rounds, high/medium findings resolved. `prompts/review.md` → "Review round cap".
4. **IDE feedback**: zero errors on every changed file.
5. **E2E** — the CI E2E job when a PR is open (`pnpm josh followup` blocks the merge on it), `pnpm josh test:e2e` run by you when there is none; a printed skip is the answer for a project with no suite. `prompts/testing-guide.md` → "Closing the E2E gate without a human run".

**UI verification (screenshot):** any change to the rendered UI is **not** done until you have looked at the result — capture the affected screen with the `/verify-ui` skill and confirm it matches the intent. If none can be produced, ask the user to verify visually.

Docs- or config-only changes still run `pnpm josh gate`.

## Refactoring Rules

- When performing any refactoring, ALWAYS read and follow `prompts/refactoring.md` before starting.

## Pre-commit Self-Review (mandatory)

Before every `git commit` (follow-up commits included), self-review against `prompts/review.md`: the staged diff, and `git diff main...HEAD` before opening or updating a PR. Level from `pnpm josh review:brief --level-only`; resolve all high/medium findings; iterate — **at most two reviews in total**, the second a verification pass over the fix delta. Then route each remaining non-High finding through the three-way disposition: fix in place, file it as a follow-up Issue only when it is a confirmed defect that reaches a runtime path, or drop it with a one-line PR note (the default). **A filed finding is run through `pnpm josh epic:bundle <new>` before the current Issue closes.** A confirmed High blocks rather than buying a third round; CI runs no Claude review, so this pass is authoritative. `prompts/review.md` → "Review round cap".

## Doc Sync Rules

**`CLAUDE.md` is the single source for every agent rule.** `AGENTS.md` and `GEMINI.md` carry no rules — a rule addition, spec change or wording fix is written **once**, here (joshuafolkken/kit#963). The structural test [scripts/document/ai-document-pointers.test.ts](https://github.com/joshuafolkken/kit/blob/main/scripts/document/ai-document-pointers.test.ts) fails if a rule body reappears in either, or if a pointer loses the sentence that sends an agent here.

**docs/ must stay in sync with the package.** When `josh bump` changes the version, review `docs/` and update any section describing changed behavior (new/renamed commands, `josh init` / `josh sync` behavior, new config files) before committing.

## Git Rules

- **No commits** unless explicitly requested. **No PR merges, branch deletions, force pushes or other shared-state mutations** unless explicitly requested in the current turn — the default end state is PR still OPEN. **Exception**: invoking `fullrun` authorizes the merge, via `pnpm josh followup`. `.claude/settings.json` denies these, but the deny is narrower than the rule — never read "the tool let me" as permission. `prompts/collaboration-workflow/operating-rules.md` → "指示されていない行動は取らない".
- **Never stage or mutate the git index on your own.** `git add` / `git rm --cached` / `git restore --staged` / `git commit` overwrite the user's snapshot and are denied by settings; inspection is read-only. Staging is allowed only on an explicit current-turn instruction or an authorized commit flow (`pnpm josh git`). `prompts/collaboration-workflow/operating-rules.md` → "git index を勝手に変更しない".
- **For git operations use `pnpm josh git`.** After a failed push, fix, push manually, then `pnpm josh pr` — **never** `gh pr create` directly, which bypasses `closes #N` generation so the Issue will not auto-close.
- **Start-of-conversation git status is a stale snapshot.** Before acting on any working-tree / index / stash / branch assumption, run `git status` (and `git stash list`) live first.

## Collaboration Workflow

- For the issue-driven proposal/plan/execution/notification flow, follow `prompts/collaboration-workflow/` (indexed by `prompts/collaboration-workflow.md`; each topic is its own file).
- **Before writing a rule as prose, ask whether its answer can be computed from mechanically readable inputs alone.** If yes, the rule is a decision oracle — add it to `pnpm josh oracle:list` (`scripts/rules/decision-oracle.ts`) rather than writing it in `CLAUDE.md` or a prompt file. `prompts/collaboration-workflow/residency.md` → question 0 is the criterion.
- **Count the target repository's open Issues before filing; with more than 30 open, close one first.** Nothing honestly closable means do not file. A filing the run is blocked by is exempt, and so is an **interrupt** — three tests decide that, never judgement: a verification answers wrongly, a documented workflow cannot complete, or data is lost or written outside the repository; both exemptions proceed, stating the overage. Meeting none of the three, a finding stays discretionary. `pnpm josh rule:guard` states it again at the call that files. The count command and both procedures: `prompts/collaboration-workflow/wip-cap.md`.

### Shorthand Commands

`kickoff`, `fullrun`, `halfrun` and `backlogrun` are the Issue-driven shorthand commands. **Their procedures are not resident** — they live in the `workflow-commands` skill. **What stays here is decided by one question: must the rule fire on a turn where no skill was loaded?** Explicit invocation, the mid-workflow stop notification, the `overrides` / `devEngines` prohibitions, the UI-verification gate and the three `epic:*` rules below all do; everything a run reaches only after reading the skill is routed to, never restated (`SKILL.md` → "What stays resident, and what is read from here").

**Read the skill before running any part of a command — including the first `gh` call.** Acting from the table below alone is not enough: the table says which command was typed, not how to run it.

| Typed keyword            | What it does                                                                                                                                                          | Read first                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `kickoff [#N \| new]`    | Plan only — normalize title, post the plan, notify, **stop**                                                                                                          | `workflow-commands` skill + `kickoff.md` + `split-assessment.md` |
| `fullrun [#N \| new]`    | Plan → implement → gate → PR → **merge** → notify                                                                                                                     | + `fullrun.md` + `split-assessment.md` + `chain-rule.md`         |
| `halfrun [#N \| new]`    | Implement + gate, then **stop before commit** for manual verification                                                                                                 | + `halfrun.md` + `split-assessment.md`                           |
| `backlogrun [#N1 #N2 …]` | Run named Issues and epics in order (an epic runs its children first), then drain the opted-in backlog — dependency order, lanes. `--only` stops after the named list | + `backlogrun.md` + `split-assessment.md` + the `fullrun` set    |

**`queue` was removed (joshuafolkken/kit#1984); its job folded into `backlogrun`.** A user who types `queue` should run `backlogrun #N1 #N2 …` instead — named Issues run in order, then the opted-in backlog drains.

**`epicrun` was removed (joshuafolkken/kit#1985); its job folded into `backlogrun` too.** A named item may now be an epic, whose children all run before the next item; **`backlogrun #E --only` runs one epic's children and stops**. If a user types `epicrun`, tell them to run `backlogrun #E --only` (drop `--only` to also drain the backlog).

**Three rules decide what a run does when the work turns out not to be one Issue** — the split assessment every entry point applies identically (**its default is not to split**: separability **and** a scope clearly exceeding one verification gate — about 10 changed files, about 400 changed lines (test files excluded) — must both hold), a prerequisite discovered mid-run (a dependency, not parked), and a named `backlogrun` item that is not an epic. All bind only after a command has started, so all are read from the `workflow-commands` skill: `split-assessment.md`, `SKILL.md` → §2d, `backlogrun-child.md` → "When `#N` is not an epic", and `fullrun.md` / `halfrun.md` / `backlogrun.md` for the branch each entry takes.

**The `josh epic:*` commands have their own skill** — `epic:audit`, `epic:next`, `epic:bundle`, and how an epic spans repositories. **Read the `epic-commands` skill before running any of them, before writing an epic that tracks a child in another repository, and right after filing an issue.** Three rules stay here because they bind outside those commands: **recording a decision removes that child's `needs-decision` label** (Tier A); **fixing what the audit finds is Tier A**, park only when the contradiction is a design choice nobody has made; and **an epic in another repository is referenced as `owner/repo#N`** (a bare `#N` resolves to this repository's issue). Canonical reference: `prompts/collaboration-workflow/epic-bundle.md`.

#### Explicit invocation required (MANDATORY)

Never start a `kickoff` / `halfrun` / `fullrun` / `backlogrun` workflow (including their `#N` and `new` variants) unless the user has typed the keyword in the **current turn's prompt**.

- Conversational requests like "implement X", "fix Y", "open a PR for Z" are **NOT** implicit invocations — do not infer authorization from the request shape.
- Do **NOT** ask confirmation questions like "Shall I run `fullrun`?". A confirmation prompt is not a substitute for explicit invocation.
- Instead, **prompt the user to type the command themselves**, with the exact phrasing: "Please run \`<command>\` to start this task." (e.g. "Please run \`halfrun new\` to start this task.").
- This applies even when the user authorized a related workflow in an earlier turn — each invocation must be re-typed in the current turn.

**A session cut inside a declared budget is not a new invocation** — a `backlogrun` cut and resumed is the one invocation a person typed, and it continues rather than waiting to be retyped; **`backlogrun` alone**, though — a `fullrun` cut still waits for the keyword. Single source: `backlogrun.md` → "The session cut is inside the invocation".

**A `backlogrun` parks a child instead of stopping the run**, and its procedure is read from `backlogrun-park.md` → "park and continue", which is that rule's single source.

#### Mid-workflow stop notification (`confirmation`)

Whenever you pause **any** run mid-execution to wait for the user — a `kickoff` / `halfrun` / `fullrun` stop, an upstream-Issue interrupt, a Tier C confirmation — you MUST send a Telegram notification **before** stopping, so the user is alerted off-screen. `halfrun`'s built-in stop before commit is a confirmation pause and follows this same rule.

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'<one-line reason>\n<what is needed from the user>'
```

- Use `--body=...` (single token) when the body starts with `-`, otherwise `parseArgs` rejects it
- Send only once per stop — do not spam if you re-evaluate within the same pause
- Skip the notification when the stop was explicitly requested by the user in the same turn (they already know)
