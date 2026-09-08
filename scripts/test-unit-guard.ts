#!/usr/bin/env tsx
import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { unit_worker_share } from './unit-worker-share'

const PNPM = 'pnpm'
const FAIL_EXIT_CODE = 1
const ARGV_START = 2
const VITEST_PACKAGE = path.join('node_modules', 'vitest')
const UNIT_GLOB = '**/*.{test,spec}.{ts,js}'
const NODE_MODULES = 'node_modules'

// **A unit check that executed nothing may report success only where the project has no unit suite
// at all** (joshuafolkken/kit#1224). The two halves of "nothing ran" are not the same state:
//
// - **`vitest` absent is the young project.** `josh init` installs no vitest and writes no
//   `test:unit` script, so a freshly-bootstrapped project always lands here — which is the case the
//   skip was written for, and it keeps it.
// - **`vitest` present is the project declaring that it runs unit tests.** Zero matching files
//   there is a broken state rather than a young one — a mis-scoped glob, or a suite that was
//   deleted — and reporting it as a passing check hands `pnpm josh followup`, which reads
//   only the exit code, a verification that verified nothing. That half fails.
//
// Rejected: leaving both halves green — joshuafolkken/kit#1216's `--verbose` makes the zero count
// *readable* in the CI log, but nobody reads a green log and the merge gate reads only pass/fail;
// and putting the failing half behind an opt-in such as `JOSH_REQUIRE_UNIT_TESTS`, which is off in
// exactly the projects that need it. The full decision, including why the absent-vitest half is
// deliberately left asymmetric, is on joshuafolkken/kit#1224.
//
// **`scripts/test-e2e-guard.ts` deliberately keeps both skips, and that divergence is not an
// oversight.** The argument above rests on the package's presence being a declaration, and
// `@playwright/test` is not one: it is an optional peer dependency that vitest's browser mode also
// needs, so a project can legitimately have it installed with no `*.e2e.{ts,js}` file at all.
const SKIP_ACTION = 'skip-missing-package'
const FAIL_ACTION = 'fail-no-tests'

type GuardAction = 'run' | typeof SKIP_ACTION | typeof FAIL_ACTION

// The word the gate looks for to know a passing step did not actually run. Exported and reused on
// both sides rather than matched by eye: joshuafolkken/kit#967 stopped printing a passing check's
// body, and without this a gate that skipped the whole unit suite printed the same five lines as one
// that ran it.
const SKIP_MARKER = '— skipping'

const SKIP_REASON = 'vitest is not installed'
const FAIL_REASON =
	'vitest is installed but no *.{test,spec}.{ts,js} test file was found — refusing to report a unit check that ran nothing'

function resolve_guard_action(is_installed: boolean, has_tests: boolean): GuardAction {
	if (!is_installed) return SKIP_ACTION
	if (!has_tests) return FAIL_ACTION

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
// **The share is read from inside the marker, not before it.** This is the one funnel every
// josh-driven vitest goes through — `test:unit`, `test:related` and the pre-push hook alike — so it is
// where a run both learns how many others are in flight and announces itself to them
// (joshuafolkken/kit#1515). The pre-push hook is the reason it is here rather than only in the gate:
// it passed no cap at all, so vitest opened one worker per core in every lane at once.
//
// Reading the share first and claiming afterwards leaves a window in which two hooks firing together
// both count "alone" and both run uncapped. Inside the marker the number is identical — this run's own
// record is now on disk and `is_nested_run` therefore contributes nothing — and the window is gone.
async function run_vitest(vitest_arguments: ReadonlyArray<string>): Promise<number> {
	return await unit_worker_share.with_run_marker(async () => {
		const sized = unit_worker_share.worker_arguments(
			vitest_arguments,
			unit_worker_share.current_share(),
		)
		const result = await execa(PNPM, ['exec', 'vitest', ...vitest_arguments, ...sized], {
			stdio: 'inherit',
			reject: false,
		})

		return result.exitCode ?? FAIL_EXIT_CODE
	})
}

// The label names the command the notice is printed for, so a skipped scoped run says
// `josh test:related` rather than reporting itself as the full suite. `SKIP_MARKER` is unchanged
// either way: the gate reads that word, never the label.
const UNIT_COMMAND_LABEL = 'test:unit'

// The two non-running outcomes report through different streams and different exit codes, because
// they mean different things: one says the project has no unit suite yet, the other says it has one
// that could not be found (joshuafolkken/kit#1224). Only the first keeps `SKIP_MARKER`, so the
// gate's "passed without running" handling still means exactly what it did.
function report_no_run(action: Exclude<GuardAction, 'run'>, command_label: string): number {
	if (action === FAIL_ACTION) {
		console.error(`josh ${command_label}: ${FAIL_REASON}.`)

		return FAIL_EXIT_CODE
	}

	console.info(`josh ${command_label}: ${SKIP_REASON} ${SKIP_MARKER} vitest unit tests.`)

	return 0
}

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

	if (action !== 'run') return report_no_run(action, command_label)
	if (announcement !== undefined) process.stdout.write(`${announcement}\n`)

	return await run_vitest(vitest_arguments)
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
