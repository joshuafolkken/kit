#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { resolve_local_bin } from './local-bin'
import { resolve_spawn_exit } from './spawn-exit'

const SECRETLINT_BIN = 'secretlint'
const NO_GLOB_FLAG = '--no-glob'
const ARGV_OFFSET = 2

// The scan is defense in depth ahead of GitHub push protection, not the only gate, so a
// missing binary must not block the commit. kit ships the pre-commit rule inside
// lefthook/base.yml, but secretlint itself resolves from the consumer project — `josh init`
// and `josh sync` add it to the consumer devDependencies, because pnpm's isolated layout
// never exposes a kit dependency's bin to the consumer's `pnpm exec`. Upgrading kit therefore
// activates this hook one `josh sync` + `pnpm install` ahead of the binary, and a bare
// `pnpm exec secretlint` turns that window into a hard failure on every commit (kit#695).
const MISSING_NOTICE =
	`⚠️  secretlint is not installed — skipping the staged-file secret scan.\n` +
	`   The kit pre-commit hook ships ahead of the dependency it needs.\n` +
	`   Run \`pnpm josh sync && pnpm install\` to provision it.`

type ScanDecision = { kind: 'skip'; notice?: string } | { kind: 'scan'; binary: string }

function resolve_secretlint_binary(project_root: string): string | undefined {
	const candidate = resolve_local_bin(project_root, SECRETLINT_BIN)

	return existsSync(candidate) ? candidate : undefined
}

// lefthook substitutes literal paths, so `--no-glob` is mandatory: a SvelteKit route directory
// such as `(app)` or `[id]` would otherwise reach secretlint's glob engine as a pattern.
// Masking and the .gitignore cascade are both on by default in v13 — no flag adds them.
function build_scan_arguments(staged_files: ReadonlyArray<string>): Array<string> {
	return [NO_GLOB_FLAG, ...staged_files]
}

function plan_scan(staged_files: ReadonlyArray<string>, project_root: string): ScanDecision {
	if (staged_files.length === 0) return { kind: 'skip' }

	const binary = resolve_secretlint_binary(project_root)

	if (binary === undefined) return { kind: 'skip', notice: MISSING_NOTICE }

	return { kind: 'scan', binary }
}

// No `shell` option on purpose. execa resolves a Windows `.cmd` shim itself and escapes the
// arguments for cmd.exe's double expansion; turning the shell on would bypass that and let a
// staged path containing a space split into two paths — the scanner would then quietly walk
// the wrong files and report clean.
function run_scan(binary: string, staged_files: ReadonlyArray<string>): number {
	const result = execaSync(binary, build_scan_arguments(staged_files), {
		stdio: 'inherit',
		reject: false,
	})

	return resolve_spawn_exit(binary, result)
}

function main(staged_files: ReadonlyArray<string>, project_root: string): number {
	const decision = plan_scan(staged_files, project_root)

	if (decision.kind === 'scan') return run_scan(decision.binary, staged_files)

	if (decision.notice !== undefined) console.warn(decision.notice)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const exit_code = main(process.argv.slice(ARGV_OFFSET), process.cwd())

	if (exit_code !== 0) process.exit(exit_code)
}

const secretlint_scan = {
	build_scan_arguments,
	main,
	plan_scan,
	resolve_secretlint_binary,
	run_scan,
}

export type { ScanDecision }
export { MISSING_NOTICE, secretlint_scan }
