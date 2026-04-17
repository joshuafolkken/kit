# Upstream Sync — joshuafolkken/tasks

<!-- cspell:words coderabbit -->

This document tracks which files in this repo are synchronized from
[`joshuafolkken/tasks`](https://github.com/joshuafolkken/tasks), the pinned upstream SHA,
and which divergences are intentional.

## Pinned upstream SHA

The authoritative SHA lives in `scripts/check-upstream-drift.ts` as `TASKS_UPSTREAM_SHA`.
Update that constant when intentionally syncing to a newer revision of `tasks`.

Run `pnpm check:upstream` to diff every file listed in `SYNCED_FILES` against the pinned SHA.

## Synced files

Files in `scripts/check-upstream-drift.ts`'s `SYNCED_FILES` array are expected to match
upstream exactly. See the script for the full list — it covers:

- All `prompts/*.md` that describe shared workflow
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `.claude/settings.json`, `.claude/remote-setup.sh`, `.mcp.json`, `pnpm-workspace.yaml`
- The entire `scripts/git/` toolkit
- Top-level scripts that implement the shared git / issue / overrides / telegram workflow
- Sub-folders `scripts/issue/`, `scripts/overrides/`

## Intentional divergences (NOT synced)

The following files differ from upstream on purpose; `check:upstream` excludes them.

| Path                                                                         | Reason                                                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `vite.config.ts`                                                             | Uses `vite-imagetools` / `vite-plugin-devtools-json`; no Paraglide                                   |
| `cspell.config.yaml`                                                         | Project-specific glossary                                                                            |
| `.gitignore`                                                                 | Upstream `.server` entry is not relevant here                                                        |
| `eslint.config.js`                                                           | Stack-specific rules                                                                                 |
| `package.json`                                                               | Different dependency set; overrides adapted to this project                                          |
| `.github/workflows/production.yml`                                           | Cloudflare-only pipeline, no D1 migration step                                                       |
| `.github/workflows/deploy-vps.yml`                                           | Project-only workflow                                                                                |
| `.coderabbit.yaml`                                                           | Drift tolerated (checked at review time)                                                             |
| `playwright.config.ts`                                                       | Kept project-local; tasks version depends on `e2e/e2e-constants.ts` and other tasks-only e2e helpers |
| `scripts/e2e-config/`                                                        | Removed; tested tasks-specific `playwright.config.ts` structure                                      |
| `lefthook.yml`, `.prettierignore`, `.vscode/extensions.json`, `.cursorrules` | Currently match upstream but may diverge; not tracked                                                |
| `messages/`                                                                  | Project-local i18n placeholder (Paraglide not in use)                                                |
| `scripts/caddy-logs.sh`, `scripts/svg-to-png.ts`                             | Project-only utilities                                                                               |
| `.cursor/rules/`                                                             | Project-specific Cursor rules                                                                        |
| `sonar-project.properties`                                                   | Project-local; excludes `.claude/**` and `scripts/**` from SonarCloud scan (upstream-synced infra)   |
| `prompts/sonar-hotspot-handling.md`                                          | Project-local extension doc for SonarCloud hotspot handling (not in upstream)                        |

## Resync workflow

1. Inspect the upstream commit: `gh api repos/joshuafolkken/tasks/commits/main --jq .sha`
2. Update `TASKS_UPSTREAM_SHA` in `scripts/check-upstream-drift.ts`
3. Run `pnpm check:upstream`
4. For each drifted file, either copy upstream verbatim (`gh api ...` or manual copy) or
   add it to the intentional-divergence table above with rationale
5. Re-run `pnpm check:upstream` until it reports no drift
6. Run the completion gate (`pnpm lint`, `pnpm check`, `pnpm cspell:dot`, `pnpm test:unit --run`)
