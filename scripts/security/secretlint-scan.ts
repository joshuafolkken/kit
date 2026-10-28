#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { execaSync } from 'execa'

const SECRETLINT_BIN = 'secretlint'
const NO_GLOB_FLAG = '--no-glob'
const END_OF_OPTIONS = '--'
const ARGV_OFFSET = 2
// Set by the CI `Secret Scan` job, where nothing provisions the binary later: there a missing
// secretlint would turn the scan into a silent pass, so it fails instead (kit#4657).
const REQUIRE_ENV = 'JOSH_SECRETLINT_REQUIRE'

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

const REQUIRED_MISSING_ERROR =
	`❌ secretlint is not installed, and ${REQUIRE_ENV} requires the scan.\n` +
	`   Add it to the devDependencies with \`pnpm josh sync && pnpm install\`.`

type ScanDecision =
	| { kind: 'skip'; notice?: string }
	| { kind: 'fail'; error: string }
	| { kind: 'scan'; binary: string }

function resolve_secretlint_binary(project_root: string): string | undefined {
	const candidate = resolve_local_bin(project_root, SECRETLINT_BIN)

	return existsSync(candidate) ? candidate : undefined
}

// lefthook substitutes literal paths, so `--no-glob` is mandatory: a SvelteKit route directory
// such as `(app)` or `[id]` would otherwise reach secretlint's glob engine as a pattern.
// Masking and the .gitignore cascade are both on by default in v13 — no flag adds them. `--` ends
// the options, so a staged file named like `--secretlintrc=evil.json` stays a path, not a flag.
function build_scan_arguments(staged_files: ReadonlyArray<string>): Array<string> {
	return [NO_GLOB_FLAG, END_OF_OPTIONS, ...staged_files]
}

function plan_missing(is_required: boolean): ScanDecision {
	return is_required
		? { kind: 'fail', error: REQUIRED_MISSING_ERROR }
		: { kind: 'skip', notice: MISSING_NOTICE }
}

function plan_scan(
	staged_files: ReadonlyArray<string>,
	project_root: string,
	is_required = false,
): ScanDecision {
	if (staged_files.length === 0) return { kind: 'skip' }

	const binary = resolve_secretlint_binary(project_root)

	if (binary === undefined) return plan_missing(is_required)

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

function main(
	staged_files: ReadonlyArray<string>,
	project_root: string,
	is_required = false,
): number {
	const decision = plan_scan(staged_files, project_root, is_required)

	if (decision.kind === 'scan') return run_scan(decision.binary, staged_files)

	if (decision.kind === 'fail') {
		console.error(decision.error)

		return 1
	}

	if (decision.notice !== undefined) console.warn(decision.notice)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const is_required = process.env[REQUIRE_ENV] === '1'
	const exit_code = main(process.argv.slice(ARGV_OFFSET), process.cwd(), is_required)

	if (exit_code !== 0) process.exit(exit_code)
}

const secretlint_scan = {
	build_scan_arguments,
	main,
	plan_scan,
	resolve_secretlint_binary,
	run_scan,
}

export { MISSING_NOTICE, REQUIRE_ENV, REQUIRED_MISSING_ERROR, secretlint_scan }
