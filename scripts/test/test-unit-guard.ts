#!/usr/bin/env tsx
import { existsSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_ENVIRONMENT_KEYS } from '#ports'
import { project_checks } from '#scripts/gate/project-checks'
import { execa } from 'execa'
import { project_test_script, type ProjectScriptState } from './project-test-script'
import { SKIP_MARKER } from './skip-marker'
import { unit_worker_share } from './unit-worker-share'

const PNPM = 'pnpm'
const FAIL_EXIT_CODE = 1
const ARGV_START = 2
const VITEST_PACKAGE = path.join('node_modules', 'vitest')
const UNIT_GLOB = '**/*.{test,spec}.{ts,js}'
const NODE_MODULES = 'node_modules'

// **A unit check that executed nothing may report success only where the project has no unit suite
// at all**. The two halves of "nothing ran" are not the same state:
//
// - **`vitest` absent is the young project.** `josh init` installs no vitest and writes no
//   `test:unit` script, so a freshly-bootstrapped project always lands here — which is the case the
//   skip was written for, and it keeps it.
// - **`vitest` present is the full project's declaration that it runs unit tests.** Zero matching
//   files there is a broken state — a mis-scoped glob, or a deleted suite — and fails. A basic
//   project may carry vitest as an unused dependency without declaring a unit suite; zero files
//   there are reported as skipped, never as a test pass.
//
// Rejected: leaving both halves green — `--verbose` makes the zero count *readable* in the CI log,
// but nobody reads a green log and the merge gate reads only pass/fail; and putting the failing half
// behind an opt-in such as `JOSH_REQUIRE_UNIT_TESTS`, which is off in exactly the projects that need
// it.
//
// **`scripts/test/test-e2e-guard.ts` deliberately keeps both skips, and that divergence is not an
// oversight.** The argument above rests on the package's presence being a declaration, and
// `@playwright/test` is not one: it is an optional peer dependency that vitest's browser mode also
// needs, so a project can legitimately have it installed with no `*.e2e.{ts,js}` file at all.
//
// **A basic project without vitest is not thereby a project without tests.** It may be of any
// language and any runner, and the `scripts.test` it declares is run in vitest's place
// (`project-test-script.ts`); only a basic project that declares none skips. A full project keeps the
// plain skip: its unit suite is vitest's, and `scripts.test` there is not this check's to run.
const SKIP_ACTION = 'skip-missing-package'
const SKIP_NO_TESTS_ACTION = 'skip-no-tests'
const SKIP_NO_SCRIPT_ACTION = 'skip-no-test-script'
const SKIP_REENTRANT_ACTION = 'skip-reentrant'
const RUN_SCRIPT_ACTION = 'run-project-script'
const FAIL_ACTION = 'fail-no-tests'

type SkipAction =
	| typeof SKIP_ACTION
	| typeof SKIP_NO_TESTS_ACTION
	| typeof SKIP_NO_SCRIPT_ACTION
	| typeof SKIP_REENTRANT_ACTION
type GuardAction = 'run' | typeof RUN_SCRIPT_ACTION | SkipAction | typeof FAIL_ACTION

// What each skip did not run, said in full: a basic project that declares no test script was not
// skipped for lacking vitest alone, and the unit tests it skipped were never vitest's. The
// `SKIP_MARKER` between the two halves is the word the gate looks for to know a passing step did not
// actually run; the gate does not print a passing check's body, so without it a gate that skipped the
// whole unit suite would print the same lines as one that ran it.
const VITEST_SUBJECT = 'vitest unit tests'
const UNIT_SUBJECT = 'unit tests'
const SKIP_NOTICES: Record<SkipAction, { reason: string; subject: string }> = {
	[SKIP_ACTION]: { reason: 'vitest is not installed', subject: VITEST_SUBJECT },
	[SKIP_NO_TESTS_ACTION]: {
		reason: 'no unit test files were found in this basic project',
		subject: VITEST_SUBJECT,
	},
	[SKIP_NO_SCRIPT_ACTION]: {
		reason: 'vitest is not installed and package.json declares no test script',
		subject: UNIT_SUBJECT,
	},
	[SKIP_REENTRANT_ACTION]: {
		reason: "the project's test script called back into this check",
		subject: UNIT_SUBJECT,
	},
}
const FAIL_REASON =
	'vitest is installed but no *.{test,spec}.{ts,js} test file was found — refusing to report a unit check that ran nothing'

const BASIC_MISSING_PACKAGE_ACTIONS: Record<ProjectScriptState, GuardAction> = {
	declared: RUN_SCRIPT_ACTION,
	absent: SKIP_NO_SCRIPT_ACTION,
	reentrant: SKIP_REENTRANT_ACTION,
}

function resolve_installed_action(has_tests: boolean, is_basic: boolean): GuardAction {
	if (has_tests) return 'run'

	return is_basic ? SKIP_NO_TESTS_ACTION : FAIL_ACTION
}

function resolve_guard_action(
	is_installed: boolean,
	has_tests: boolean,
	is_basic = false,
	script_state: ProjectScriptState = 'absent',
): GuardAction {
	if (is_installed) return resolve_installed_action(has_tests, is_basic)

	return is_basic ? BASIC_MISSING_PACKAGE_ACTIONS[script_state] : SKIP_ACTION
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

// The guard's decision for one project, asked here once so the run, the scoped record and the gate's
// precondition can never disagree about whether this project's vitest runs.
function guard_action(project_directory: string): GuardAction {
	return resolve_guard_action(
		is_vitest_installed(project_directory),
		has_unit_tests(project_directory),
		project_checks.is_basic(project_directory),
		project_test_script.state(project_directory),
	)
}

function is_skip_action(action: GuardAction): action is SkipAction {
	return Object.hasOwn(SKIP_NOTICES, action)
}

// **A skip is the project having no unit suite, so no unit check can ever vouch for its tree.** The
// failing branch is not one: it is a broken suite, and it is left to fail where it is reported.
function is_skipping(project_directory: string): boolean {
	return is_skip_action(guard_action(project_directory))
}

// **Whether a green exit vouches for the tree** — vitest ran, or the project's own script did. The
// scoped record is written on this answer, so a project `is_skipping` requires a record from is
// always one that can write it.
function is_running(project_directory: string): boolean {
	const action = guard_action(project_directory)

	return action === 'run' || action === RUN_SCRIPT_ACTION
}

// A lane's port allocation belongs to its development and preview servers, not to unit fixtures.
// Passing it into Vitest makes every case that deliberately omits or replaces the seed inherit the
// checkout's seat instead. Keep the rest of the caller's environment, including CI and PATH guards.
function isolated_unit_environment(
	environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const isolated = { ...environment }

	for (const key of PROJECT_ENVIRONMENT_KEYS) Reflect.deleteProperty(isolated, key)

	return isolated
}

// The whole vitest invocation after the binary, not just the flags: `josh test:related` runs
// `vitest related <files> --run` where this command runs `vitest run`, and the two must not grow
// two copies of the guard, the spawn or the skip notice around that one difference.
// **The share is read from inside the marker, not before it.** This is the one funnel every
// josh-driven vitest goes through — `test:unit`, `test:related` and the pre-push hook alike — so it is
// where a run both learns how many others are in flight and announces itself to them.
// The pre-push hook is the reason it is here rather than only in the gate:
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
			env: isolated_unit_environment(),
			extendEnv: false,
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
// that could not be found. Only the first keeps `SKIP_MARKER`, so the
// gate's "passed without running" handling still means exactly what it did.
function report_no_run(action: SkipAction | typeof FAIL_ACTION, command_label: string): number {
	if (action === FAIL_ACTION) {
		console.error(`josh ${command_label}: ${FAIL_REASON}.`)

		return FAIL_EXIT_CODE
	}

	const { reason, subject } = SKIP_NOTICES[action]

	console.info(`josh ${command_label}: ${reason} ${SKIP_MARKER} ${subject}.`)

	return 0
}

// `announcement` is printed only on the branch that actually spawns vitest. A caller that wrote it
// itself would claim a run before this guard had decided there would be one — the same "a passing
// step did not actually run" ambiguity `SKIP_MARKER` exists for, reintroduced one layer up.
//
// **The project's own script takes neither the vitest arguments nor the announcement.** Both describe
// a vitest run — a filter, a narrowing to related files — and the script runs as the project declared
// it, whole; it prints its own notice saying so.
async function run_guarded_vitest(
	project_directory: string,
	vitest_arguments: ReadonlyArray<string>,
	command_label: string = UNIT_COMMAND_LABEL,
	announcement?: string,
): Promise<number> {
	const action = guard_action(project_directory)

	if (action === RUN_SCRIPT_ACTION) {
		return await project_test_script.run(project_directory, command_label)
	}

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
	guard_action,
	is_skipping,
	is_running,
	resolve_guard_action,
	is_vitest_installed,
	has_unit_tests,
	isolated_unit_environment,
	run_guarded_unit,
	run_guarded_vitest,
}

export type { GuardAction }
export { test_unit_guard }
