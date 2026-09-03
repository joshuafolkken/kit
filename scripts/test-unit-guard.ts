#!/usr/bin/env tsx
import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const PNPM = 'pnpm'
const FAIL_EXIT_CODE = 1
const ARGV_START = 2
const VITEST_PACKAGE = path.join('node_modules', 'vitest')
const UNIT_GLOB = '**/*.{test,spec}.{ts,js}'
const NODE_MODULES = 'node_modules'

// `vitest` may be absent and the unit suite may be empty in a freshly-bootstrapped project, so
// the CI unit step must skip — not fail — when either is missing. This mirrors the e2e guard so
// the two suites behave symmetrically while still running vitest once both are present.
type GuardAction = 'run' | 'skip-missing-package' | 'skip-no-tests'

// The word the gate looks for to know a passing step did not actually run. Exported and reused on
// both sides rather than matched by eye: joshuafolkken/kit#967 stopped printing a passing check's
// body, and without this a gate that skipped the whole unit suite printed the same five lines as one
// that ran it.
const SKIP_MARKER = '— skipping'

const SKIP_REASONS: Record<Exclude<GuardAction, 'run'>, string> = {
	'skip-missing-package': 'vitest is not installed',
	'skip-no-tests': 'no *.{test,spec}.{ts,js} test files found',
}

function resolve_guard_action(is_installed: boolean, has_tests: boolean): GuardAction {
	if (!is_installed) return 'skip-missing-package'
	if (!has_tests) return 'skip-no-tests'

	return 'run'
}

function is_vitest_installed(project_directory: string): boolean {
	return existsSync(path.join(project_directory, VITEST_PACKAGE))
}

function is_in_node_modules(entry: string): boolean {
	return entry.split(/[/\\]/u).includes(NODE_MODULES)
}

function has_unit_tests(project_directory: string): boolean {
	const matches = globSync(UNIT_GLOB, {
		cwd: project_directory,
		exclude: is_in_node_modules,
	})

	return matches.length > 0
}

// The whole vitest invocation after the binary, not just the flags: `josh test:related` runs
// `vitest related <files> --run` where this command runs `vitest run`, and the two must not grow
// two copies of the guard, the spawn or the skip notice around that one difference
// (joshuafolkken/kit#1257).
async function run_vitest(vitest_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(PNPM, ['exec', 'vitest', ...vitest_arguments], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

// The label names the command the notice is printed for, so a skipped scoped run says
// `josh test:related` rather than reporting itself as the full suite. `SKIP_MARKER` is unchanged
// either way: the gate reads that word, never the label.
const UNIT_COMMAND_LABEL = 'test:unit'

// `announcement` is printed only on the branch that actually spawns vitest. A caller that wrote it
// itself would claim a run before this guard had decided there would be one — the same "a passing
// step did not actually run" ambiguity `SKIP_MARKER` exists for, reintroduced one layer up
// (joshuafolkken/kit#1257).
async function run_guarded_vitest(
	project_directory: string,
	vitest_arguments: ReadonlyArray<string>,
	command_label: string = UNIT_COMMAND_LABEL,
	announcement?: string,
): Promise<number> {
	const is_installed = is_vitest_installed(project_directory)
	const has_tests = has_unit_tests(project_directory)
	const action = resolve_guard_action(is_installed, has_tests)

	if (action === 'run') {
		if (announcement !== undefined) process.stdout.write(`${announcement}\n`)

		return await run_vitest(vitest_arguments)
	}

	console.info(`josh ${command_label}: ${SKIP_REASONS[action]} ${SKIP_MARKER} vitest unit tests.`)

	return 0
}

async function run_guarded_unit(
	project_directory: string,
	extra_arguments: ReadonlyArray<string>,
): Promise<number> {
	return await run_guarded_vitest(project_directory, ['run', ...extra_arguments])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const extra_arguments = process.argv.slice(ARGV_START)
	const exit_code = await run_guarded_unit(process.cwd(), extra_arguments)

	process.exit(exit_code)
}

const test_unit_guard = {
	SKIP_MARKER,
	resolve_guard_action,
	is_vitest_installed,
	has_unit_tests,
	run_guarded_unit,
	run_guarded_vitest,
}

export type { GuardAction }
export { test_unit_guard }
