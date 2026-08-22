# Cursor Agent Instructions

> For Claude Code: see `CLAUDE.md`. For Gemini: see `GEMINI.md`.

## Project

Stack: TypeScript · pnpm · SvelteKit · Vitest · Playwright · TailwindCSS · Drizzle · better-auth · Paraglide · MCP

## Communication

- **Answer opinion-seeking questions from a neutral standpoint.** When the user asks a leading or preference-shaped question — e.g. "how about X?" ("〜〜ではどうか？"), "wouldn't Y be better?" ("〜〜の方はどうか？"), "isn't Z the right call?" — do not reflexively agree or tailor the answer to the phrasing. Weigh the actual merits and respond impartially: state the trade-offs honestly, recommend the option you genuinely judge best (even when it differs from the one the user hinted at), and explain why. Agreement must be earned by the facts, not assumed from how the question is asked.
- **Fix root causes, not symptoms.** Do not use your own judgment to reach for ad-hoc workarounds, hacks, or clever tricks to force a goal through. Diagnose the underlying cause first, then recommend and apply the correct, fundamental fix — even when it is larger or slower than a quick patch. If the proper fix is out of scope or needs the user's decision, surface the root cause and the recommended fix rather than silently papering over the symptom.
- **Cross-package problems → file the upstream Issue, then always stop.** When a problem discovered mid-task originates in a different package — including a dependency or the distribution-source package (e.g. the `josh` / kit tooling this project consumes) — do **not** paper over it with a local workaround in the current repo. **The procedure is unconditional: it contains no "does this block the current task?" evaluation.** Every upstream defect goes through it, blocking or not, and the trigger is **discovery** — never "when it starts blocking". A blocking judgement is made under pressure to keep the run going, so it resolves toward "not blocking" exactly when a workaround is most tempting; the line also does not exist at discovery time, because a defect that looks harmless can turn into an accommodation at the completion gate. Removing the judgement is what makes the rule fire before a stopgap reaches the tree. Steps: (1) stash the current work-in-progress (`git stash`); (2) record in the active Issue that the work was stashed and **why** (which upstream package and problem caused the pause, plus a link to the new Issue) so the paused state is auditable; (3) create a new Issue in the **target package's** repository describing the root cause — **when the target is first-party (its owner equals this session's repository owner), filing is Tier A: never ask for confirmation, neither to file nor to choose the target repository; when the target is third-party, filing is Tier C and you stop for explicit instruction instead — see the next bullet**; (4) send a `confirmation` Telegram naming the upstream Issue and what is blocked, then **stop** — the Issue already exists, so the user decides waiting-vs-deferring with it in hand; (5) only after the upstream fix lands — or the user explicitly decides to defer — `git stash pop` and resume the original task. **Weakening a verification gate is a workaround too**: filtering, narrowing or reinterpreting `lint` / `tsc` / `cspell` / unit / E2E output to accommodate an upstream defect is the same violation as writing a local patch and triggers the same stop — reporting the filtered result honestly does not make it compliant. Mild redundancy is the accepted price: stopping for a finding the user would have waved through costs one round trip, while continuing past one that mattered ships a workaround to every consumer. **Both ends carry a backlink, under a fixed heading.** The upstream Issue's body gets an `## Origin` section naming the consumer Issue, and the consumer Issue records every Issue filed from it under `## Upstream issues` (in the body while you are still authoring it, otherwise as a comment) — the upstream Issue states the defect, the consumer Issue holds the evidence, and without the link neither is interpretable later. Always repo-qualify the reference (`owner/repo#N` or the full URL): a bare `#N` resolves inside the upstream repo and silently points at a different Issue. Write it as prose or a plain bullet, **never as a task-list row** (`- [ ] owner/repo#N`) — a checkbox row referencing another repository disables epic auto-close by design, which is correct for a real cross-repo child and a trap for a backreference. See `prompts/collaboration-workflow.md` → "別パッケージ起因の問題は割り込み Issue で対応する" and "起票元へのバックリンク（`## Origin` / `## Upstream issues`）".
- **Third-party repositories are Tier C — never write to a tracker we do not own without explicit instruction.** The unconditional filing rule above was written for the **first-party set** (kit / app-kit / game-kit / jgame), where the tracker is ours and a redundant Issue costs one line of backlog. **Decide which side a target is on mechanically, never by judgement**: the target is **first-party** when its owner equals the owner of the repository this session is running in (`gh repo view --json owner --jq .owner.login`); **everything else is third-party**, including forks and org repositories we merely contribute to. **First-party targets are unchanged** — Tier A, file without asking, backlink both ways, stop. **Third-party targets are Tier C for every kind of write** — Issue, comment, pull request, discussion, review — and each one needs the user's explicit instruction **in the current turn**. Publishing there is outward-facing and effectively irreversible: the Issue goes out under the user's GitHub identity, notifies watchers, and is indexed, and closing it later undoes none of that; it also spends maintainer attention that nobody agreed to give. When the target is third-party: (1) record the finding in **our own** consumer Issue with the full evidence under the heading `## Upstream candidate` — never `## Upstream issues`, which asserts that something was filed; (2) prepare the report as a draft inside that Issue, so approving it costs the user one message; (3) send a `confirmation` Telegram naming the third-party project and what would be reported, then **stop**. **Clear the evidence bar before offering the draft**: a **minimal reproduction outside our project** (a bare scaffold containing only the dependency under test), or an explicit statement in the draft that only a project-embedded reproduction exists; **every claim verified** — nothing inferred presented as fact; and **a search for an existing Issue** covering the same defect. **Withdrawal is outward-facing too** — closing, editing or commenting on a third-party Issue already filed needs the same explicit instruction. **A correct diagnosis is not authorization to publish.** See `prompts/collaboration-workflow.md` → "第三者リポジトリへの書き込みは Tier C（明示指示が必要）".
- **No clones — single-source, even across package boundaries.** Copying, porting, or re-implementing existing non-trivial logic to avoid changing its source is **prohibited by default**. The moment you are about to replicate logic that already lives somewhere — another file, another module, or another **package, including an upstream dependency** — STOP: that is the signal to **single-source** it (one shared module / export / package every consumer imports), not to copy it. (1) An existing duplication is **not** a license to duplicate again — if the code was already cloned once (e.g. jgame copied kit), the shared abstraction is overdue; surface it, do not add a third copy. (2) "Reference the upstream" means **reuse it**, never paste its code. (3) A "don't touch X" constraint never silently justifies a clone — surface the tradeoff first ("the clean fix needs a change in kit; the alternative is a clone — which do you want?"). (4) Duplicate **only** after presenting the single-source alternative and its cost **and** getting the user's explicit approval. See `prompts/collaboration-workflow.md` → "クローン禁止・単一ソース化（パッケージ境界を越えても）".
- **Distinguish consultation from execution — don't edit files during discussion.** When the user asks how to approach something, what we should do, why something happened, or expresses a goal/desire ("どうすべき？", "how should we…", "なぜ", "理由を知りたい", "〜したい", "〜の方が良い？"), respond with **analysis and a recommendation only** — do **not** edit files, create issues, or take other concrete actions. Act only on an explicit imperative ("do it", "書き換えて", "作成して", "implement") or a workflow keyword (`kickoff` / `halfrun` / `fullrun` / `queue`). When ambiguous, default to propose-and-wait (or ask "should I execute this?"). A goal statement is a request for a plan, not authorization to execute it. See `prompts/collaboration-workflow.md` → "相談と実行を区別する（議論中にファイルを編集しない）".
- **Route distributed-doc / config changes upstream to kit.** `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` and other kit-distributed docs/config are single-sourced from kit. In a consumer repo (app-kit / game-kit) never edit them locally — `josh sync` would overwrite the edit and the change belongs upstream; before editing any doc/config, check whether it is a distributed artifact and, if so, propose the change for kit (issue / PR) instead. In kit itself you **are** the source, so edit here — and keep the three paired docs in sync per "Doc Sync Rules". See `prompts/collaboration-workflow.md` → "配布ドキュメント・設定の変更は kit に上流化する".
- **Latest-first, fix forward — pin back only as a last resort.** Adopt the newest versions of dependencies and toolchain by default; never stay on, or revert to, an older version merely to avoid the work of adapting. When a bump breaks something (a lint crash, a newly-enabled rule, a type error), resolve it **forward**: fix consumer code where the new rule/error is legitimate; add or scope rule overrides at the **correct layer** (the shared kit / app-kit config), not as an ad-hoc one-off consumer disable; and when the breakage originates in a first-party package (kit / app-kit), file an issue there and fix it at the right altitude rather than only working around it in the consumer (this is the dependency-bump case of the "Cross-package problems → interrupt" rule above). Pinning back is a **last resort** — only when fixing forward is genuinely blocked (e.g. waiting on an unreleased upstream fix); when you must, record why and open a tracking issue to return to latest, and never present pin-back as the default recommendation. This does **not** override the overrides (`pnpm-workspace.yaml` / `package.json`) / `devEngines` approval gates: fix-forward means _prefer latest + fix the breakage_, never _silently mutate protected pins_ — those still require explicit user approval. See `prompts/collaboration-workflow.md` → "最新優先・fix-forward（pin-back は最終手段）".
- **Output language follows `JOSH_SESSION_LANG` (personal, optional).** Two kinds of output obey it: **session-facing output** — conversational explanations, questions, and **`AskUserQuestion` option labels and descriptions** — and **artifact prose** — Issue bodies, Issue/PR comments (plan comments and completion comments alike), and Telegram notification bodies. Both are written in the language set in the `JOSH_SESSION_LANG` environment variable (personal, non-committed, stored in `.env`; e.g. `ja`, `en`). **When it is unset the two fall back differently**: session dialogue matches the language the user is writing in, while artifact prose defaults to **`ja`** — an artifact is read long after the session ends and has no live conversation to infer a language from, so it needs a fixed default rather than an inferred one. **Three things stay English no matter what the variable says**: (1) **Issue and PR titles** — the title-normalization step in `kickoff` / `fullrun` / `halfrun` / `queue` is unchanged, which keeps the Issue list easy to scan and branch names ASCII-only; (2) **code comments, test titles, and commit messages** — repository code conventions on a different axis from a developer's language preference; (3) **fixed strings emitted by the scripts** — the Telegram header labels, the `Issue:` / `PR:` URL labels, and the default notify message, which you do not author. See `prompts/collaboration-workflow.md` → "出力の言語（`JOSH_SESSION_LANG`）".
- **Durable rules belong in prompts/docs, not local MEMORY.** When you identify a behavioral rule that should hold in future sessions, encode it as a change to kit's distributed prompts/docs (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `prompts/*`): version-controlled, reviewable, and shared across every machine, repository, and AI tool. A per-project auto-memory store (e.g. `~/.claude/projects/<repo-slug>/memory/`) is **local and non-portable** — scoped to one machine and one repo, uncommitted, and invisible to other PCs, other repos, and other AI tools — so **keep it minimal**. Reserve it for genuinely local, non-shareable context (machine-specific paths, personal environment quirks); never let it become the only home for a rule that should apply everywhere. If the rule is durable and shareable, upstream it to kit per "Route distributed-doc / config changes upstream to kit"; when the current turn does not authorize a doc change, **propose** the prompt/doc edit instead of silently saving it to MEMORY. See `prompts/collaboration-workflow.md` → "恒久ルールは MEMORY ではなくプロンプト／ドキュメントに書く".

### Decision autonomy (minimize confirmation stops)

When you reach a decision point, classify it into one of three tiers and act accordingly. The goal is to stop and ask **only** when the choice genuinely needs the user's judgment — not at every fork.

- **Tier A — reversible implementation / design choices** (a library pick where one option is clearly superior, naming, file layout, test approach, refactor shape). If one option is clearly better on the merits, **select it and proceed without asking.** When the point is one you would normally surface for confirmation, log the decision so the user can audit or override it later (see "Logging auto-decisions" below).
- **Tier B — genuine toss-up.** The top two options are both sound and the margin is narrow. **This is the only tier that stops** — ask the user (use `AskUserQuestion` where available), presenting the close candidates and their trade-offs.
- **Tier C — irreversible / shared-state / out-of-scope actions** (merge, branch delete, force push, destructive ops, repo-settings changes, anything outside the stated task scope, `devEngines` / overrides edits in either `pnpm-workspace.yaml` or `package.json`). **Out of scope for this policy.** Always require explicit user instruction — never auto-decide, even when one option looks clearly better. The existing safety rules (`prompts/collaboration-workflow.md` → "指示されていない行動は取らない", the `devEngines` / `pnpm.overrides` protections above) take precedence.

**Criterion for A vs B:** ask only when the margin is narrow **and** the decision is hard to reverse or has lasting architectural impact. "I'm in doubt" alone is not a reason to stop — a clearly-superior option is selected automatically even if some uncertainty remains, and a narrow-margin but cheaply-reversible choice is also made automatically (pick one, log it, move on).

**Tier A also covers self-correction.** Two kinds of cleanup are housekeeping rather than design choices, and both **proceed without asking**:

- **Fixing a factual error in an artifact you yourself published** — an Issue or PR comment, or an Issue body (e.g. a defect attributed to the wrong package).
- **Closing a gap in your own work that you identified in the same session** — e.g. adding the sibling cross-links you already flagged as missing.

Both are reversible, both have exactly one sensible outcome, and leaving them undone is not something a user would choose. **This half carries no workaround risk** — it repairs work already done rather than routing around a problem. **Boundary against "Distinguish consultation from execution":** Tier A here covers _completing or repairing work already authorized and performed_, never acting on a goal statement ("I'd like X") or a question about approach ("how should we…"). **Boundary against Tier C (restated):** correcting your own comment is Tier A; merges, branch deletions, force pushes and out-of-scope actions stay Tier C **even when you caused the problem**. Log it per "Logging auto-decisions" below — removing the confirmation does not remove the audit trail.

**Logging auto-decisions:** when you auto-decide a Tier A point that would normally warrant confirmation, record the candidates and rationale:

- Inside an Issue-driven workflow (`kickoff` / `halfrun` / `fullrun` / `queue`): post an Issue comment — `gh issue comment <N> --body "..."` — listing the chosen option, the rejected alternatives, and why the chosen option is clearly superior.
- Outside any Issue (a plain conversational task): surface the same as a one-line "Auto-decided: `<choice>` over `<alt>` because `<reason>`" note in your reply.

## Environment Variables

The following variables configure `scripts-ai/`, personal AI-workflow behavior, and this project's own ports. Store them in a `.env` file at the project root (loaded automatically by the AI scripts, by `josh port` and by `playwright.config.ts`). See [docs/scripts-ai.md](https://github.com/joshuafolkken/kit/blob/main/docs/scripts-ai.md) for setup instructions including how to obtain these values. `TELEGRAM_*` are required for notifications; `JOSH_SESSION_LANG` and `PORT_SEED` are optional.

| Variable             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token for Telegram notifications (from BotFather)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `TELEGRAM_CHAT_ID`   | Target chat or user ID for Telegram messages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `JOSH_SESSION_LANG`  | Optional. Personal, non-committed language for session dialogue, `AskUserQuestion` options, and artifact prose — Issue bodies, Issue/PR comments, Telegram notification bodies (e.g. `ja`, `en`). When unset, dialogue matches the conversation and artifact prose defaults to `ja`. Issue/PR titles, code comments, test titles, and commit messages stay English.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PORT_SEED`          | Optional. Personal, non-committed integer offsetting this project's dev and preview ports together (`PORT_SEED=1` → dev `5174`, preview `4174`), so several kit projects on one machine can run their servers at once. Unset — or left blank, the shape `.env.example` ships — means `0`, the historical `5173` / `4173`, which is what keeps CI and un-migrated projects unaffected. An invalid value is a hard error, never a silent fall back to the shared default, and a busy port still fails loudly with no retry on another port. `josh port` and `playwright.config.ts` both read the seed from `.env`, so the E2E suite waits on the same port a `preview` script wired through `josh port preview` starts. See [docs/josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md#josh-port). |

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

### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)

- **Overrides live in two files, and one of them alone is not the project's answer.** pnpm 11 reads them from the `overrides:` block in **`pnpm-workspace.yaml`** — where kit's and app-kit's overrides actually live — while `pnpm.overrides` in **`package.json`** is the legacy location. **An absent or empty `pnpm.overrides` is not evidence that the project has no overrides**: app-kit's `package.json` has no `pnpm` field at all, yet a real override sits in its `pnpm-workspace.yaml`. Never conclude "there is nothing to protect" from one file — a verdict that names only `package.json` has not checked anything, and it reports success in exactly the state the rule exists to detect.
- **NEVER** remove or modify entries in **either** location without explicit user approval.
- **The check is a command you run, not a conclusion you reach.** After `pnpm update`, `josh latest`, or any dependency-update command, run `git diff -- pnpm-workspace.yaml package.json` and confirm the `overrides:` block and `pnpm.overrides` are both untouched, **and** that `devDependencies` versions still respect the overrides. If any entry was removed, modified, or bumped past an override, restore it immediately. `josh latest` prints its own verdict as its last overrides line (`✔ overrides unchanged (<n> from <file>)`, or a `⚠ overrides changed` warning), and `pnpm josh overrides` compares both files against a saved snapshot — quote what one of them printed rather than a verdict you inferred.
- **NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation. `devEngines` pins the required development toolchain (e.g. pnpm version); silently changing it can break CI or other contributors' environments. After any dependency-update command, verify `devEngines` was not changed **outside the legitimate `josh latest` pnpm bump** (defined next). If it was changed in any other way, restore it immediately and ask the user before making any change.
  - **Exception — the `josh latest` lockstep pnpm bump is expected, NOT a violation.** `josh latest` deliberately bumps `devEngines.packageManager.version` in lockstep with the top-level `packageManager` pin (see `scripts/version/latest-corepack.ts` → `sync_development_engines`); the two MUST stay exactly equal — **byte-identical, `+sha512…` Corepack integrity suffix included**. pnpm compares them as raw strings, so a bare `11.18.0` paired with `pnpm@11.18.0+sha512…` is a mismatch and the dual-declaration warning fires; only a character-for-character match suppresses it. So after `josh latest`, **KEEP** a `devEngines.packageManager.version` change **if and only if** it now equals everything after `pnpm@` in the new `packageManager` pin (same version string **and** same integrity suffix; only the `version` field moved). Reverting it would both undo a valid toolchain update **and** re-introduce a `packageManager`/`devEngines` mismatch — the opposite of the rule's intent. **Restore + ask only** when devEngines changed in some OTHER way: its version no longer matches `packageManager` (a dropped, stale, or truncated integrity suffix counts as a mismatch), its structure changed (`name` / `onFail` / fields added or removed), or it was touched by something other than `josh latest`.

## Package-First Development

- Before building any system or feature, do NOT write original code first — check whether a well-maintained existing package already solves the problem.
- Prefer modern, actively-maintained packages. Evaluate candidates on maintenance/activity, popularity, bundle size, TypeScript support, license, and fit. **If one package is clearly the best fit, select it and proceed** (Tier A — log the choice and rationale per "Decision autonomy"). **Only when two or more candidates are genuinely close**, present about three options ranked in a comparison table and let the user choose.
- For existing code as well, proactively propose replacing hand-rolled implementations with a suitable package when it improves maintainability.

## Code Change Rules

For every code modification, follow this order exactly:

0. **Work summary + test declaration** _(mandatory before writing any implementation code)_: Present a two-layer work summary — a plain-language overview first, technical detail demoted below it — then declare every change and its test. Do not touch implementation files until both exist.

   ```md
   **■ Overview**

   - **Now**: <one sentence — what is happening, as the reader experiences it>
   - **Change**: <one sentence — what will be different afterwards, not how>
   - **Check**: <one sentence — how it will be confirmed>

   **Details**

   - Target: <files / modules>
   - Approach: <approach and why>
   - Side effects / out of scope: <omit when none>

   **Changes and tests**

   1. <what changes> — Test: <Unit|E2E> — `<file path>` — <what behavior it verifies>
   2. ...
   ```

   - **Translate every label into the session language; never append an annotation to one.** These are two separate rules, and merging them into one reads as "keep the English label". (1) **Labels are translated, not copied.** In a Japanese session write `**■ 概要**`, `**技術詳細**`, `**変更とテスト**`, the `Now / Change / Check` labels as `今こうなっている / こう直す / 確かめ方`, and a completion report's `Cause / Fix / Result` as `原因 / 対応 / 結果`; leaving any of them in English is wrong. Artifact prose follows the same language, and the `Cause` / `Fix` / `Result` labels inside a completion comment are translated by this same mapping; the only English-pinned outputs are the three named above (Issue/PR titles, code conventions, script-emitted strings). (2) **A label carries no annotation.** The explanations in this document — "plain language", "always first" — are instructions to you, never part of the printed label, so `■ 概要（平易な説明）` and `■ Overview (plain language)` are both wrong. Canonical reference: `prompts/collaboration-workflow.md` → 「ラベルはセッション言語に訳し、注釈は付けない（必須）」.
   - **Never wrap the summary in a code fence.** Write only the contents of the template above, as ordinary markdown. The fence here delimits the template inside this document; in a session it paints the whole block with a background color and a monospace font, which defeats the purpose of the plain-language layer and is especially unreadable for Japanese prose. The template is written to survive unfenced: labels are bold rather than aligned with runs of spaces (markdown collapses consecutive spaces), and there is no bare `---` separator line (it would render as a horizontal rule).
   - **The plain-language overview comes first and is mandatory.** Write it in the session language (`JOSH_SESSION_LANG`; match the user's language when unset), translating the `Now / Change / Check` labels into that language. Three lines, one sentence each (80–100 characters in Japanese, 20–25 words in English). **Never put file paths, function or type names, or CLI option flags in the overview** — those internal identifiers belong in Details. Names the reader actually sees on screen — package names, what a printed command is for, screen names, the kind of message — are allowed, and usually required (next bullet). Avoid jargon or gloss it inline. Write cause → fix → effect as a causal chain, not a list of changes. **Before sending, re-read the three lines**: if a non-programmer could not follow them, move the offending symbol or abbreviation down into Details and rewrite. Re-read the block as a whole too: if it is wrapped in a code fence, unwrap it before sending. Then ask one more question: could a reader who has not seen the code tell **which** thing each line is about? If not, add one concrete noun.
   - **Name the concrete subject — the counter-requirement to the prohibition above.** Following the prohibition alone produces subject-less prose: "it stays stale", "the suggested command", "nothing changes" — grammatical, but the reader cannot tell which package is stale or what will appear instead. Whenever a line says something is stale, broken, or unchanged, name the affected package, screen, or kind of output; never settle for "the situation", "the suggestion", "the problem", or "that process". Before: `Now: Even though it is stale a warning appears, but running the suggested command sometimes changes nothing.` After: `Now: The version check warns that the globally installed app-kit is stale, but the update command printed next to it points at a version that is already installed, so nothing changes and the same warning returns.` The rewrite adds no internal identifier — only nouns the reader sees on screen. Canonical reference: `prompts/collaboration-workflow.md` → 「具体的な主語を必ず書く（禁止と対になる要求）」.
   - **Details come second and stay technical.** They cover the files/modules to be touched, the approach and a one-line rationale, any side effects or deliberately out-of-scope points, and the per-change test declarations. In `fullrun` / `halfrun` / `queue` present the whole block once per Issue, immediately before implementation starts — including when the Issue body was already filled and no plan comment was posted. `kickoff` is exempt (it already posts a plan to the Issue).
   - **Completion reports use the same two layers.** When you report a finished run, lead with `Cause: / Fix: / Result:` — one plain sentence each, `Result` naming what is different for the user plus the shipped version — and keep changed files, test results, and leftovers below. This shape applies to the session-facing summary and to the `--notify-message` body alike; both are written in the session language (`JOSH_SESSION_LANG`, default `ja`).
   - **The summary is presentation, not a confirmation stop.** Continue straight into implementation in the same turn; it never becomes a stopping condition and does not affect the `fullrun` chain rule. Keep it session-facing only — do not post it as an Issue comment. Canonical format reference: `prompts/collaboration-workflow.md` → 「報告フォーマット（平易な概要 ＋ 技術詳細）」.
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

## Doc Sync Rules

**CLAUDE.md, GEMINI.md, and AGENTS.md are paired documents.** Whenever any one of them is updated, apply the equivalent change to all three in the same commit. This includes rule additions, spec changes, wording fixes, and section additions. Never update one without checking the others.

**docs/ must stay in sync with the package.** Whenever `josh bump` is run (i.e. the package version changes), review `docs/` and update any section that describes changed behavior before committing. This applies to behavior changes in `josh init`, `josh sync`, new or renamed commands, and any new config files managed by the package.

## Git Rules

- **No commits** unless explicitly requested by the user
- **No PR merges, branch deletions, force pushes, or other shared-state mutations** unless explicitly requested in the current turn. The default end state is PR still OPEN — do not run `gh pr merge` on your own. **Exception**: invoking `fullrun` or `fullrun new` is explicit authorization to merge; use `pnpm josh followup --merge` in that flow.
- **Never stage or mutate the git index on your own.** The index belongs to the user — they may have deliberately staged a snapshot to diff later changes against. `git add` / `git add -A` / `git rm --cached` / `git restore --staged` overwrite that snapshot, and the index keeps no history, so the previous staged state cannot be restored. **Never run a staging command merely to inspect something** (computing a diff stat, seeing an untracked file's content, etc.) — inspection is always read-only: `git status --short`, `git diff`, `git diff --stat`, `git diff HEAD`, and `git diff --no-index /dev/null <new-file>` for an untracked file. Staging is allowed only when the user explicitly asks for it in the current turn, or as part of an authorized commit flow (`pnpm josh git`, or a `fullrun` / `queue` invocation). When you believe staging is needed outside those cases, ask first.
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

- `kickoff #<N>`: Read existing Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → analyze requirements → post the plan to the Issue (if body is blank, use `gh issue edit <N> --body "<plan>"`; otherwise `gh issue comment <N> --body "<plan>"`) → send Telegram notification → **stop** (do not implement). Plan comments are written in the session language (`JOSH_SESSION_LANG`, default `ja`). Telegram notification: `pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'- <bullet1>\n- <bullet2>\n...'`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅ / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are auto-fetched from `gh` when not supplied. Include line breaks between bullets for readability. The Issue URL must be included.
- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (0) **Scope assessment**: Analyze whether the request contains multiple independent deliverables that could each be merged separately. If multiple → follow the **multi-issue split path**; if single → follow the **single-issue path**. **Single-issue path**: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"` — body follows the minimum template in `prompts/collaboration-workflow.md`, filled from conversation context. Capture the new Issue number `<N>`. (3) Post the plan in the session language (`JOSH_SESSION_LANG`, default `ja`), using the same body/comment logic as `kickoff #<N>`. (4) Send Telegram notification (same format as `kickoff #<N>`). (5) **Stop** — do not implement. **Multi-issue split path**: (1) For each independent deliverable, derive a focused English title and create a separate Issue: `gh issue create --title "<sub-title>" --body "<body>"`. Capture each Issue number `<N1>`, `<N2>`, etc. **When the split is filed into a repository other than the one this session is running in**, every child body gets the `## Origin` backlink described in the cross-package rule above, the epic body carries the same link as prose or a plain bullet right after `Split rationale` — never as a checkbox row, which would disable its auto-close — and the originating Issue lists the children and the epic under `## Upstream issues`. (2) **Epic — always, for every split into two or more Issues.** There is no count or ordering condition to evaluate. **Create it with `pnpm josh epic "<epic-title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]`**, capturing its number `<E>` from the printed URL. The command satisfies the epic's four mechanical requirements by construction — it ensures the `epic` label and applies it, renders the children as task-list rows (`- [ ] #N`), writes `Dependencies` in the machine-readable form, and prints a children-only `queue` line — so none of them is a thing to remember. Check an epic you wrote or edited by hand with `pnpm josh epic:check <E>`: it reports each requirement as pass or fail and exits non-zero when any fails, using the same parser the auto-close runs on. Only where `josh` is unavailable, fall back to the manual procedure: ensure the label exists (`gh label create "epic" --color "#5319e7" --description "Tracks a batch of child issues from one split" 2>/dev/null || true`), then create the epic with `gh issue create --title "<epic-title>" --label epic --body "<body>"` (this fails loudly if the label is missing). Its body follows the epic format in `prompts/collaboration-workflow.md` — split rationale, dependencies, `queue` command, and a child task list written in task-list syntax (`- [ ] #N`), which replaces the first-Issue comment. The epic exists as the **non-closing home for the split rationale**: a comment on the first Issue is buried the moment `queue` merges and closes that Issue, which happens on every multi-Issue split whether or not the children are ordered. Ordering is one thing the epic can carry, not the reason it exists. The management cost the old gate guarded against no longer exists — `scripts/git/git-epic-close.ts`, driven by `pnpm josh followup`, closes a completed epic automatically. When the children have no required order, write `None — the children are independent; any execution order works.` under `Dependencies` rather than omitting the section. **The epic is NEVER passed to `queue`** — `queue` receives child Issues only; the epic has no deliverable and no implementation run. `pnpm josh followup` closes it automatically once every child in its task list is closed (it stays open, for manual closing, if the `epic` label or the task-list syntax is missing, or if the task list tracks a child in another repository). **Only when the execution order matters**, record it natively. `pnpm josh epic --ordered` treats the argument order as the dependency order and applies the whole chain itself, so the declaration and the relations come from one input and cannot disagree; on the manual fallback path, do it after the child Issues exist, as a separate step: `gh issue edit <N2> --add-blocked-by <N1>` for each dependent pair (requires `gh` >= 2.94.0; a failure here is non-fatal — only the relation is lost); skip this step entirely for an unordered split — epic creation is unconditional, dependency recording is not. Never pass `--blocked-by` to `gh issue create`: an older `gh` rejects the unknown flag with exit 1 and the Issue is never created. (3) Send Telegram notification listing all created issues (same format as `kickoff #<N>`). (4) Present the command `queue #N1 #N2 ...` to the user — child Issues only, never the epic. (5) **Stop** — do not implement.

#### `fullrun` — Full execution (plan → implement → PR → completion notify)

- `fullrun #<N>`: Read Issue #N → **normalize the title**: if the title is not in English or can be phrased more clearly/conventionally, derive a better English title and run `gh issue edit <N> --title "<title>"` → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank (use `gh issue edit <N> --body "<plan>"`); if the body already has content, skip the plan-posting step → implement → run the **verification gate** (refactor per `prompts/refactoring.md` → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain) → `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` → `pnpm josh ms`. Issue plan comments are written in the session language (`JOSH_SESSION_LANG`, default `ja`). Before implementing, run `git switch main && git pull`, then `josh latest` (includes `pnpm audit`; fix with an `overrides` entry in `pnpm-workspace.yaml` if vulnerabilities found). **After `josh latest`: verify the overrides were not modified in **both** locations — `pnpm-workspace.yaml` `overrides:` and `package.json` `pnpm.overrides` (`git diff -- pnpm-workspace.yaml package.json`; an empty `pnpm.overrides` is not evidence of absence) — if any override was auto-removed or changed, investigate why it existed and restore it before proceeding (do NOT remove intentional overrides without user approval). Also verify `devEngines` was not changed except for the legitimate `josh latest` pnpm bump (its `version` now matching the new `packageManager` pin is expected — **keep it**); restore + ask only if it changed in any other way (see the `devEngines` protection rule above).** Run the `/review` skill inline **before committing**, on `git diff main`; fix all high/medium-priority findings and re-run until clean, so the first commit already carries reviewed code. When running `pnpm josh followup --merge`, compose an implementation summary in the session language (`JOSH_SESSION_LANG`, default `ja`) and pass it via `--notify-message`. Format: `"Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"`. **`pnpm josh followup --merge` waits for CI, verifies AI review findings, sends the completion notification, then merges — all in one step. If AI review blockers are found, followup exits non-zero; fix the findings and re-run `pnpm josh followup --merge`.** **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun` always ends on the default branch.**
- `fullrun new` or `fullrun new "<title>"`: Shortcut that combines `kickoff new` + `fullrun #<N>` into a single run. Steps: (1) Derive an English title from the conversation, or use the provided title. (2) Create Issue: `gh issue create --title "<title>" --body "<body>"`. Capture the new Issue number `<N>`. (3) Add `in-progress` label: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`. (4) Post the agreed plan in the session language (`JOSH_SESSION_LANG`, default `ja`). (5) If the working tree already has staged or modified files (e.g., user pre-staged kit/config changes), stash them first: `git stash`. (6) Run `git switch main && git pull`. (7) Run `josh latest` — **mandatory, never skip even if the working tree had modifications**. **After `josh latest`: verify the overrides were not modified in **both** locations — `pnpm-workspace.yaml` `overrides:` and `package.json` `pnpm.overrides` (`git diff -- pnpm-workspace.yaml package.json`; an empty `pnpm.overrides` is not evidence of absence) — if any override was auto-removed or changed, restore it before proceeding. Also verify `devEngines` was not changed except for the legitimate `josh latest` pnpm bump (its `version` now matching the new `packageManager` pin is expected — **keep it**); restore + ask only if it changed in any other way (see the `devEngines` protection rule above). If you stashed changes in step 5, restore them now: `git stash pop`.** (8) Implement. (9) run the verification gate (refactor → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain). (10) `pnpm josh bump minor`. (11) `pnpm josh git -y "<title> #<N>"`. (12) `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"`. (13) **After the merge succeeds, run `pnpm josh ms` to return to the default branch and pull the merge commit — `fullrun new` always ends on the default branch.**

#### `halfrun` — Implement + verify, stop before commit (for manual verification)

`halfrun` sits between `kickoff` (plan only) and `fullrun` (full execution with auto-merge). It implements the change and runs the full verification gate, then **stops before commit** — nothing is committed, nothing is pushed, and no PR is created — so the user manually verifies the change (typically by exercising the UI in a browser) against the working tree. Use `halfrun` when the change needs human eyes before shipping.

- `halfrun #<N>`: Read Issue #N → **normalize the title** (same as `fullrun`) → **add `in-progress` label** (create if missing: `gh label create "in-progress" --color "#0075ca" --description "Work is actively in progress" 2>/dev/null || true`, then `gh issue edit <N> --add-label "in-progress"`) → post the agreed plan only if the Issue body is blank → run `git switch main && git pull`, then `josh latest` (verify the overrides are unchanged in **both** locations — `pnpm-workspace.yaml` `overrides:` and `package.json` `pnpm.overrides` (`git diff -- pnpm-workspace.yaml package.json`; an empty `pnpm.overrides` is not evidence of absence) — and `devEngines` changed only by the expected `josh latest` pnpm bump; restore if otherwise modified) → implement → run the **full verification gate** (refactor → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain) → send a `confirmation` Telegram with the resume commands in the body → **stop**. Plan comments are written in the session language (`JOSH_SESSION_LANG`, default `ja`). The `confirmation` Telegram body MUST include the exact resume commands: `pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'halfrun ready for manual verification\nNext: pnpm josh bump minor && pnpm josh git -y "<title> #<N>" && pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\\nCause: ...\\nFix: ...\\nResult: ...\\n\\nDetails:\\n- <change1>"'`. **Invoking `halfrun` is _not_ authorization to commit, push, or merge** — do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup` yourself; the user runs those manually after verifying. If the user comes back with fixes, treat each round as: implement → re-run the verification gate → send another `confirmation` Telegram → stop.
- `halfrun new` or `halfrun new "<title>"`: Shortcut that combines `kickoff new` + `halfrun #<N>`. Steps mirror `fullrun new` (1)–(8): (1) Derive an English title or use the provided title. (2) `gh issue create --title "<title>" --body "<body>"`. Capture `<N>`. (3) Add `in-progress` label. (4) Post the agreed plan in the session language (`JOSH_SESSION_LANG`, default `ja`). (5) `git stash` if the working tree has changes. (6) `git switch main && git pull`. (7) `josh latest` — **mandatory**. Verify the overrides are unchanged in **both** locations — `pnpm-workspace.yaml` `overrides:` and `package.json` `pnpm.overrides` (`git diff -- pnpm-workspace.yaml package.json`; an empty `pnpm.overrides` is not evidence of absence) — and `devEngines` changed only by the expected `josh latest` pnpm bump; `git stash pop` if stashed. (8) Implement. (9) Run the verification gate (refactor / lint / tsc / cspell / test:unit / `/review` on `git diff main`). (10) Send the `confirmation` Telegram (same body as `halfrun #<N>`) and **stop**. Do not run `pnpm josh bump minor`, `pnpm josh git -y`, or `pnpm josh followup`.

#### `queue` — Sequential multi-issue fullrun

`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `josh latest` once (before the first issue) — **mandatory, never skip**. Verify the overrides are unchanged in **both** locations — `pnpm-workspace.yaml` `overrides:` and `package.json` `pnpm.overrides` (`git diff -- pnpm-workspace.yaml package.json`; an empty `pnpm.overrides` is not evidence of absence) — and `devEngines` changed only by the expected `josh latest` pnpm bump. If you stashed changes, restore them: `git stash pop`.
2. For each issue `#<N>` in the supplied order:
   a. From the 2nd issue onward: run `pnpm josh ms` to incorporate the previous PR's merge (a `fullrun` always ends on the default branch, so this is defensive — it also handles the case where the previous iteration was interrupted before `pnpm josh ms` ran).
   b. Execute the full `fullrun #<N>` flow: normalize title → add `in-progress` label → post plan if body is blank → implement → run the verification gate (refactor → `pnpm josh lint` → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/review` skill on `git diff main`, iterating until no high/medium findings remain) → `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- ..."` (sends per-issue completion notification and merges, exactly as `fullrun` does) → `pnpm josh ms` (return to the default branch).
   c. On failure: send a `failure` Telegram notification via `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body="<reason>"` and **stop immediately** (do not proceed to the next issue).
3. No extra batch summary notification — each issue's `pnpm josh followup --merge` already sends the per-issue completion notification as usual. The final iteration's `pnpm josh ms` leaves the working tree on the default branch, so `queue` always ends on the default branch.

**Key rules:**

- Invoking `queue` is explicit authorization to merge each PR (same as `fullrun`).
- `josh latest` runs only once, before the first issue. If files were pre-staged when `queue` was invoked, they must be stashed before `josh latest` and restored after.
- All `kickoff`/`fullrun` mid-workflow stop rules (confirmation notification, AI review blocker handling, etc.) apply within each issue's execution.

#### AI reviewer comment scan (automatic in `pnpm josh followup`)

`pnpm josh followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**.

**Temporary (kit#753)**: while CodeRabbit reviews are slow, CodeRabbit is non-blocking end to end — it is excluded from the default required checks (restore via `JOSH_REQUIRED_CHECKS`), `Actionable comments posted: N` is downgraded to an informational log, and unresolved CodeRabbit line comments no longer require an ignore reason. Every skip is printed to the console and appended to the completion Telegram body. Claude Review blockers are unchanged. Revert together with kit#752.

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

**Everything else — including `/review` producing a polished "Approve for merge" recommendation — is NOT a stopping condition.** Continue straight through `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` in the same turn.

**Decision table** (map `/review` result → next action mechanically):

| `/review` result                        | Findings severity  | Next action (same turn, no user input)                                                                                                                                                |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean — every category says `No issues` | None               | Immediately continue: `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`                                 |
| Low findings only                       | Low                | Immediately continue: `bump minor` → `git -y` → `followup --merge` (Low may be skipped with a one-line reason)                                                                        |
| One or more High / Medium findings      | High and/or Medium | Fix in place and re-run `/review` on `git diff main`, looping until clean. Nothing is committed yet, so a round costs no commit, push, or CI run. Do NOT report narratively and wait. |
| `/review` itself errors / can't run     | n/a                | Report the error and stop with a `confirmation` Telegram                                                                                                                              |

The recommendation line at the bottom of `/review` ("Approve for merge", etc.) is informational, not authoritative. **Severity of findings drives the decision, not the recommendation sentence.**

**Anti-pattern catalog** — if you are about to emit text resembling any of the following, you are violating the chain rule. Cancel the message; continue through `pnpm josh bump minor` → `pnpm josh git -y` → `pnpm josh followup --merge` instead.

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

1. **Mode check** — Is this `/review` part of a `fullrun` / `fullrun new` / `queue` invocation? Decide by both signals: (a) the user's recent prompt contained one of those commands, AND (b) the implementation is finished and the verification gate has reached its review step. **A `halfrun` invocation never satisfies (a)** — halfrun runs this same review inside its gate, but it ends at the confirmation stop without committing: send the `confirmation` Telegram and stop with the work uncommitted. If either signal is false → NOT fullrun mode; do NOT call `followup --merge`.
2. **Severity check** — Count high/medium findings. If ≥1 → fix in place and re-run `/review`; nothing is committed yet. Do NOT call `followup --merge` yet.
3. **Append check** — In fullrun mode AND 0 high/medium findings: the same response that contains the `/review` markdown MUST also continue the pipeline in tool calls — `pnpm josh bump minor`, then `pnpm josh git -y`, then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **A response whose final assistant text is `/review` Markdown with no follow-on tool call is a violation.** Cancel and append the tool call.

Treat the `/review` skill's output as an intermediate tool result, not a deliverable.

See `prompts/collaboration-workflow.md` → "Chain rule: `/review` → `followup --merge` decision table" for the canonical extended reference.

#### `auto-merge` — Default `fullrun` behavior

Every `fullrun` / `fullrun new` invocation uses `pnpm josh followup --merge`, which handles the full sequence internally: wait for CI → verify AI review findings → send completion notification → merge. Invoking `fullrun` is itself the explicit authorization to merge. **After the merge succeeds, always run `pnpm josh ms` (= checkout default branch + `git pull`) to return the working tree to the default branch with the merge commit pulled. `fullrun` / `fullrun new` / `queue` always end on the default branch.**

- **AI review findings are checked automatically.** `followup` scans CodeRabbit / Claude Review findings only. If blockers are found, it sends a `confirmation` Telegram and exits non-zero — fix the findings and re-run. (SonarCloud findings are **not** scanned by `followup`; the `sonar-qube.yml` CI workflow runs the scan with `sonar.qualitygate.wait=true` so a red Quality Gate fails the required `SonarQube` check, which `followup` waits on before merging.)
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
