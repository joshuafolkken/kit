#!/usr/bin/env tsx
import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { environment_flags } from '@joshuafolkken/kit/env'
import { core_budget } from '#scripts/gate/core-budget'
import { execa } from 'execa'

const PNPM = 'pnpm'
// `--workers`, `--workers=<n>` and Playwright's `-j` short form.
const WORKER_FLAGS = /^(?:--workers(?:=|$)|-j)/u
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

function is_in_node_modules(entry: string): boolean {
	return entry.split(/[/\\]/u).includes(NODE_MODULES)
}

function has_e2e_tests(project_directory: string): boolean {
	const matches = globSync(E2E_GLOB, {
		cwd: project_directory,
		exclude: is_in_node_modules,
	})

	return matches.length > 0
}

// **A local run's worker count is the weight it reserved** (joshuafolkken/kit#3944). Playwright's own
// default is half the cores, which no ledger entry stood for; CI keeps its config's count, and a
// count the caller names wins.
function playwright_arguments(extra_arguments: ReadonlyArray<string>): ReadonlyArray<string> {
	const is_count_named = extra_arguments.some((argument) => WORKER_FLAGS.test(argument))

	if (is_count_named || environment_flags.is_ci_enabled(process.env['CI'])) return extra_arguments

	return [`--workers=${String(core_budget.CORE_WEIGHTS.e2e)}`, ...extra_arguments]
}

async function run_playwright(extra_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(
		PNPM,
		['exec', 'playwright', 'test', ...playwright_arguments(extra_arguments)],
		{ stdio: 'inherit', reject: false },
	)

	return result.exitCode ?? FAIL_EXIT_CODE
}

// Only a run reserves: a skip starts nothing, and a claim there could wait out a full ledger for it.
async function run_reserved_playwright(extra_arguments: ReadonlyArray<string>): Promise<number> {
	return await core_budget.with_command_reservation(
		core_budget.CORE_WEIGHTS.e2e,
		async () => await run_playwright(extra_arguments),
		{ command: 'test:e2e' },
	)
}

async function run_guarded_e2e(
	project_directory: string,
	extra_arguments: ReadonlyArray<string>,
): Promise<number> {
	const is_installed = is_playwright_installed(project_directory)
	const has_tests = has_e2e_tests(project_directory)
	const action = resolve_guard_action(is_installed, has_tests)
	if (action === 'run') return await run_reserved_playwright(extra_arguments)

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
