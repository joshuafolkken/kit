import { existsSync } from 'node:fs'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { execa } from 'execa'
import { test_red_logic, type RedProbe, type RedVerdict } from './test-red-logic'
import { vitest_cache_directory } from './vitest-cache-directory'

// `josh test:red` — run the added and changed Vitest files against the pre-fix tree and print `red`,
// `green`, `no-test`, `stopped` or `test-only`.
//
// **The pre-fix tree is a detached worktree at the merge-base, never the caller's checkout**
// (`base-tree.ts`). The tests are copied in from the working tree, so what runs is the new test
// against the old code.

const TREE_PREFIX = 'josh-test-red-'
const REPORT_NAME = 'report.json'
const PROGRESS_NAME = 'progress.log'
const REPORTER_NAME = 'progress-reporter.mjs'
// A probe this long is spinning, not slow: it stops well inside the harness cap a detached `josh ship`
// runs `test:pinned` under (joshuafolkken/kit#6814).
const PROBE_TIMEOUT_MS = 300_000
const KILL_SIGNAL = 'SIGKILL'
// Beside the tree, so the run's dependency optimizer never rewrites the borrowed `node_modules/.vite`
// a gate beside it imports from (`vitest-cache-directory.ts`).
const CACHE_NAME = 'vite-cache'
const VITEST_BIN = path.join(base_tree.NODE_MODULES, '.bin', 'vitest')
const USAGE =
	'Usage: josh test:red — prints red / green / no-test / stopped / test-only for the changed tests on the merge-base'

interface RedRun {
	verdict: RedVerdict
	files: ReadonlyArray<string>
}

interface VitestRun {
	is_failed: boolean
	timed_out: boolean
}

// The changed Vitest files that still exist — a deleted test has nothing to run.
function changed_tests(paths: ReadonlyArray<string>): Array<string> {
	return test_red_logic.unit_test_files(paths).filter((file) => existsSync(file))
}

function reporter_arguments(report: string): Array<string> {
	// The plain `--outputFile`, not `--outputFile.json`: a config that sets `test.outputFile` as a string
	// wins over the keyed form, which would send the report into the tree and read every run `no-test`.
	return ['--reporter=json', `--outputFile=${report}`]
}

async function read_report(report: string): Promise<string> {
	return existsSync(report) ? await readFile(report, 'utf8') : ''
}

// The reporter is written beside the tree, never into it, and both outputs are removed first, so a run
// that writes none never reads the one before it.
async function prepare_outputs(parent: string, outputs: ReadonlyArray<string>): Promise<string> {
	const reporter = path.join(parent, REPORTER_NAME)

	await Promise.all(
		outputs.map(async (output) => {
			await rm(output, { force: true })
		}),
	)
	await writeFile(reporter, test_red_logic.progress_reporter(path.join(parent, PROGRESS_NAME)))

	return reporter
}

// The run is detached so its pid leads a process group holding vitest and its fork workers: a worker
// spinning in a test never answers its parent, so only signalling the whole group stops it. A detached
// run sits outside its caller's group and execa's exit cleanup, so every group still running is killed
// when this process exits — a `test:pinned` or `test:red` stopped by SIGTERM, SIGINT or SIGHUP ends
// through `process.exit` (`base-tree.ts`).
const live_groups = new Set<number | undefined>()

function kill_group(pid: number | undefined): void {
	if (pid === undefined) return

	try {
		process.kill(-pid, KILL_SIGNAL)
	} catch {
		// It ended before the signal; there is nothing left to stop.
	}
}

function stop_live_probes(): void {
	for (const pid of live_groups) kill_group(pid)
}

process.on('exit', stop_live_probes)

// What `vitest_in` reads of the run: the group leader's pid and how the run ended.
type VitestProcess = Promise<{
	exitCode?: number | undefined
	signal?: NodeJS.Signals | undefined
}> & { pid?: number | undefined }

function spawn_vitest(
	{ parent, tree }: BaseTree,
	vitest_args: ReadonlyArray<string>,
): VitestProcess {
	return execa(path.join(tree, VITEST_BIN), vitest_args, {
		cwd: tree,
		detached: true,
		env: {
			...git_location_environment.location_free_environment(),
			[vitest_cache_directory.CACHE_DIRECTORY_KEY]: path.join(parent, CACHE_NAME),
		},
		extendEnv: true,
		reject: false,
	})
}

// A timeout counts only when its kill ended the run: one that finished just as the timer fired is read
// by its own exit code.
async function vitest_in(
	base: BaseTree,
	vitest_args: ReadonlyArray<string>,
	timeout_ms: number,
): Promise<VitestRun> {
	const state = { timed_out: false }
	const subprocess = spawn_vitest(base, vitest_args)

	live_groups.add(subprocess.pid)
	const timer = setTimeout(() => {
		state.timed_out = true
		kill_group(subprocess.pid)
	}, timeout_ms)
	const result = await subprocess

	clearTimeout(timer)
	live_groups.delete(subprocess.pid)

	return {
		is_failed: result.exitCode !== 0,
		timed_out: state.timed_out && result.signal === KILL_SIGNAL,
	}
}

async function timeout_error(
	progress: string,
	roots: ReadonlyArray<string>,
	timeout_ms: number,
): Promise<Error> {
	const running = test_red_logic.unfinished_files(await read_report(progress), roots)
	const names = running.length > 0 ? running.join(', ') : 'no test file had been queued'

	return new Error(
		`vitest probe passed its ${String(timeout_ms)} ms timeout, still running: ${names}`,
	)
}

// The verdict of one run over `selection` — `run <files>`, or `related <file> --run` for
// `josh test:pinned`. `--passWithNoTests` keeps "the filter matched nothing" from reading as a
// failure, and the JSON report — written beside the tree, never into it — says whether anything ran at
// all, so a file the old config excludes is `no-test` rather than a `green` that refuses a correct fix.
// A test that ran and broke, or a file that could not load against the old code, makes it `red`, and
// the files it broke in come back beside the verdict. A run past `timeout_ms` is killed and throws,
// naming the test files still running (joshuafolkken/kit#6814).
async function probe_in(
	base: BaseTree,
	selection: ReadonlyArray<string>,
	timeout_ms = PROBE_TIMEOUT_MS,
): Promise<RedProbe> {
	const report = path.join(base.parent, REPORT_NAME)
	const progress = path.join(base.parent, PROGRESS_NAME)
	const reporter = await prepare_outputs(base.parent, [report, progress])
	const vitest_args = [
		...selection,
		'--passWithNoTests',
		...reporter_arguments(report),
		`--reporter=${reporter}`,
	]
	const outcome = await vitest_in(base, vitest_args, timeout_ms)
	const roots = [base.tree, await realpath(base.tree)]

	if (outcome.timed_out) throw await timeout_error(progress, roots, timeout_ms)

	const text = await read_report(report)
	const ran = test_red_logic.ran_file_count(text)

	return {
		verdict: test_red_logic.verdict_for(ran, outcome.is_failed),
		failed: test_red_logic.failed_files(text, roots),
		ran,
	}
}

async function verdict_on(base: string, files: ReadonlyArray<string>): Promise<RedVerdict> {
	return await base_tree.with_tree(TREE_PREFIX, base, async (pre_fix) => {
		await base_tree.copy_in(pre_fix.tree, files)

		const probe = await probe_in(pre_fix, ['run', ...files])

		return probe.verdict
	})
}

// The verdict over the current checkout. No merge-base (not a repository, no default branch) reads as
// `no-test` — there is no pre-fix tree to run against, and a guard fails open. A change whose every path
// is a test file is `test-only` without a run: the merge-base runs the same code as HEAD.
async function run(): Promise<RedRun> {
	const base = await change_base.resolved_through_merge()
	const paths = await changed_paths.read_changed_paths(false)
	const files = changed_tests(paths)

	if (base === undefined || files.length === 0) return { verdict: 'no-test', files }
	if (test_red_logic.is_test_only(paths)) return { verdict: 'test-only', files }

	return { verdict: await verdict_on(base, files), files }
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		process.stderr.write(`${USAGE}\n`)

		return argv.includes('--help') ? 0 : 1
	}

	const { verdict, files } = await run()

	process.stdout.write(`${verdict}\n`)
	if (files.length > 0) process.stderr.write(`${files.join('\n')}\n`)

	return 0
}

// Whether the checkout has the Vitest `probe_in` runs; without it every run would read `no-test`.
function has_runner(): boolean {
	return existsSync(VITEST_BIN)
}

const test_red = { has_runner, main, probe_in, run, stop_live_probes }

export type { RedRun }
export { test_red }
