#!/usr/bin/env tsx
import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const PNPM = 'pnpm'
const FAIL_EXIT_CODE = 1
const ARGV_START = 2
const PLAYWRIGHT_PACKAGE = path.join('node_modules', '@playwright', 'test')
const E2E_GLOB = '**/*.e2e.{ts,js}'
const NODE_MODULES = 'node_modules'

// `@playwright/test` is an optional peer dependency and the e2e suite may be empty in a
// fresh project, so the pre-push gate must skip — not fail — when either is missing. This
// keeps the optional peer truly optional while still running Playwright once both are present.
type GuardAction = 'run' | 'skip-missing-package' | 'skip-no-tests'

const SKIP_REASONS: Record<Exclude<GuardAction, 'run'>, string> = {
	'skip-missing-package': '@playwright/test is not installed',
	'skip-no-tests': 'no *.e2e.{ts,js} test files found',
}

function resolve_guard_action(is_installed: boolean, has_tests: boolean): GuardAction {
	if (!is_installed) return 'skip-missing-package'
	if (!has_tests) return 'skip-no-tests'

	return 'run'
}

function is_playwright_installed(project_directory: string): boolean {
	return existsSync(path.join(project_directory, PLAYWRIGHT_PACKAGE))
}

function has_e2e_tests(project_directory: string): boolean {
	const matches = globSync(E2E_GLOB, {
		cwd: project_directory,
		exclude: (entry) => entry.includes(NODE_MODULES),
	})

	return matches.length > 0
}

async function run_playwright(extra_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(PNPM, ['exec', 'playwright', 'test', ...extra_arguments], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

async function run_guarded_e2e(
	project_directory: string,
	extra_arguments: ReadonlyArray<string>,
): Promise<number> {
	const is_installed = is_playwright_installed(project_directory)
	const has_tests = has_e2e_tests(project_directory)
	const action = resolve_guard_action(is_installed, has_tests)
	if (action === 'run') return await run_playwright(extra_arguments)

	console.info(`josh test:e2e: ${SKIP_REASONS[action]} — skipping Playwright e2e.`)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const extra_arguments = process.argv.slice(ARGV_START)
	const exit_code = await run_guarded_e2e(process.cwd(), extra_arguments)

	process.exit(exit_code)
}

const test_e2e_guard = {
	resolve_guard_action,
	is_playwright_installed,
	has_e2e_tests,
	run_guarded_e2e,
}

export type { GuardAction }
export { test_e2e_guard }
