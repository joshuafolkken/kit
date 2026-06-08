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

function has_unit_tests(project_directory: string): boolean {
	const matches = globSync(UNIT_GLOB, {
		cwd: project_directory,
		exclude: (entry) => entry.includes(NODE_MODULES),
	})

	return matches.length > 0
}

async function run_vitest(extra_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(PNPM, ['exec', 'vitest', 'run', ...extra_arguments], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

async function run_guarded_unit(
	project_directory: string,
	extra_arguments: ReadonlyArray<string>,
): Promise<number> {
	const is_installed = is_vitest_installed(project_directory)
	const has_tests = has_unit_tests(project_directory)
	const action = resolve_guard_action(is_installed, has_tests)
	if (action === 'run') return await run_vitest(extra_arguments)

	console.info(`josh test:unit: ${SKIP_REASONS[action]} — skipping vitest unit tests.`)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const extra_arguments = process.argv.slice(ARGV_START)
	const exit_code = await run_guarded_unit(process.cwd(), extra_arguments)

	process.exit(exit_code)
}

const test_unit_guard = {
	resolve_guard_action,
	is_vitest_installed,
	has_unit_tests,
	run_guarded_unit,
}

export type { GuardAction }
export { test_unit_guard }
