#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codex_hooks } from '#scripts/agent/codex-hooks'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLAUDE_SETTINGS = path.join(REPO_ROOT, '.claude', 'settings.json')
const CODEX_HOOKS = path.join(REPO_ROOT, '.codex', 'hooks.json')

// Regenerate `.codex/hooks.json` from `.claude/settings.json`. The output is
// committed rather than gitignored: Codex reads it straight from a fresh clone of kit, before any
// build has run, and `josh init` / `josh sync` copy it to consumers from the package. It is run by
// hand, never from `pnpm build`, so a build never rewrites a committed file:
// `codex-project-config.test.ts` fails the gate when the committed copy has drifted.
function build_codex_hooks(): string {
	writeFileSync(CODEX_HOOKS, codex_hooks.codex_hooks_text(readFileSync(CLAUDE_SETTINGS, 'utf8')))

	return CODEX_HOOKS
}

function main(): void {
	console.info(`  ✔ ${build_codex_hooks()} built`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { build_codex_hooks, CLAUDE_SETTINGS, CODEX_HOOKS }
