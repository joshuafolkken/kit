import { existsSync } from 'node:fs'
import { project_checks } from '#scripts/gate/project-checks'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import {
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import {
	buffered_process,
	FAIL_EXIT_CODE,
	type BufferedProcessResult,
} from '#scripts/lib/buffered-process'
import { SKIP_MARKER } from '#scripts/test/skip-marker'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_daemon, type DaemonState } from './eslint-daemon'
import { lint_gate_scope } from './lint-gate-scope'
import { lint_timing } from './lint-timing'

// This — not the `lint:eslint` map entry — is the eslint invocation `josh gate` reaches, so the
// cache flags come from the same constant the ignore rules are asserted against.
// A copy here would keep writing the old location the day that constant
// moves, with every test still green.
const WHOLE_TREE = '.'
const ESLINT_ARGS = ['exec', 'eslint', WHOLE_TREE, ...ESLINT_CACHE_FLAGS] as const

// Prettier's cache stays this checkout's own, never shared through `lane_cache_run` as eslint's is:
// its entries do not survive a move (`josh-command-types.ts` → `GATE_CACHE_SPECS`).
const PRETTIER_ARGS = ['exec', 'prettier', '--check', WHOLE_TREE, ...PRETTIER_CACHE_FLAGS] as const
const GATE_TIMING_LABEL = 'lint'

// What one eslint run is made of: the child's arguments and the cache file they name.
interface EslintRun {
	args: ReadonlyArray<string>
	cache_file: string
	warm_daemon: boolean
}

// The name a run's timing line carries and what it read (`lint-timing.ts`).
interface LintRunTiming {
	label: string
	targets: string
}

// Whether eslint may go through the checkout's warm daemon (`eslint-daemon.ts`). `josh lint:related`
// asks for it; the gate's own lint does not, so its whole-tree run stays one cold process of its own.
// `josh lint:related` names a `timing` too, so its run prints where its seconds went (joshuafolkken/kit#5712).
interface LintRunOptions {
	warm_daemon: boolean
	timing?: LintRunTiming | undefined
}

const COLD_RUN: LintRunOptions = { warm_daemon: false }

// Whether the eslint cache was there once the lane's cache sharing had run, before eslint read it,
// and what a warm run did with the daemon (`eslint_daemon.run_or_cold`).
interface EslintResult extends BufferedProcessResult {
	is_cached?: boolean | undefined
	daemon?: DaemonState | undefined
}

interface LintPair {
	prettier: BufferedProcessResult
	eslint: EslintResult
}

// The warm daemon when asked for and reachable, else the cold `pnpm exec eslint` it falls back to.
async function run_eslint_process(eslint: EslintRun): Promise<EslintResult> {
	if (eslint.warm_daemon) return await eslint_daemon.run_or_cold(eslint.args)

	return await buffered_process.run_buffered_process(eslint.args)
}

// The run sits inside the lane's cache sharing, between dropping the entries whose imports changed
// and recording what the fresh ones read (`eslint-cache-dependencies.ts`).
async function run_eslint(eslint: EslintRun): Promise<EslintResult> {
	const { cache_file } = eslint

	return await lane_cache_run.run(cache_file, async () => {
		const is_cached = existsSync(cache_file)
		const result = await eslint_cache_dependencies.guard(
			cache_file,
			async () => await run_eslint_process(eslint),
		)

		return { ...result, is_cached }
	})
}

// execa strips the child's final newline, so each output is closed here: unclosed, the next tool's
// output, or the timing line, would start on the same line as prettier's last one.
function write_output(result: BufferedProcessResult): void {
	const { output } = result
	if (!output) return

	process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
}

function skipped(check: string, reason: string): BufferedProcessResult {
	return { output: `${project_checks.skip_notice(check, reason)}\n`, exit_code: 0, elapsed_ms: 0 }
}

async function run_prettier(
	directory: string,
	prettier_args: ReadonlyArray<string>,
): Promise<BufferedProcessResult> {
	const reason = project_checks.prettier_skip_reason(directory)
	if (reason !== undefined) return skipped('prettier', reason)

	return await buffered_process.run_buffered_process(prettier_args)
}

async function run_checked_eslint(directory: string, eslint: EslintRun): Promise<EslintResult> {
	const reason = project_checks.eslint_skip_reason(directory)
	if (reason !== undefined) return skipped('eslint', reason)

	return await run_eslint(eslint)
}

function is_silent_pass(result: BufferedProcessResult): boolean {
	return result.output === '' && !buffered_process.is_process_failed(result)
}

// Only beside a skipped sibling (`project_checks.ran_notice`): a `lint` that skipped nothing keeps the
// output it always had.
function with_ran_notice(
	check: string,
	result: BufferedProcessResult,
	sibling: BufferedProcessResult,
): BufferedProcessResult {
	if (!sibling.output.includes(SKIP_MARKER) || !is_silent_pass(result)) return result

	return { ...result, output: `${project_checks.ran_notice(check)}\n` }
}

function lint_exit_code(prettier: BufferedProcessResult, eslint: BufferedProcessResult): number {
	return buffered_process.is_process_failed(prettier) || buffered_process.is_process_failed(eslint)
		? FAIL_EXIT_CODE
		: 0
}

// The two checks are run from here whether they were pointed at the whole tree or at one change's
// files, so `josh lint:related` reaches prettier and eslint through the same buffering, the same
// "one failure does not abort the other" reading, and the same exit code —
// and through the same basic-project skip, so a narrowed run never reaches a tool the whole-tree
// run would have skipped. The skip reasons answer nothing for a full
// project, so the one path serves both profiles.
async function run_lint_pair(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
	options: LintRunOptions,
): Promise<LintPair> {
	const directory = process.cwd()
	const [prettier, eslint] = await Promise.all([
		run_prettier(directory, prettier_args),
		run_checked_eslint(directory, { args: eslint_args, cache_file, ...options }),
	])

	return { prettier, eslint }
}

function write_lint_pair({ prettier, eslint }: LintPair): number {
	write_output(with_ran_notice('prettier', prettier, eslint))
	write_output(with_ran_notice('eslint', eslint, prettier))

	return lint_exit_code(prettier, eslint)
}

function timing_line(pair: LintPair, label: string, facts: ReadonlyArray<string>): string {
	const { prettier, eslint } = pair

	return lint_timing.line({
		label,
		prettier_ms: prettier.elapsed_ms,
		eslint_ms: eslint.elapsed_ms,
		facts,
	})
}

// A run that never asked for the daemon, or skipped eslint, names none.
function daemon_fact(eslint: EslintResult): string {
	return eslint.daemon ?? 'cold process'
}

function cache_fact(eslint: EslintResult): string {
	return eslint.is_cached === true ? 'cache present' : 'cache absent'
}

// A run that names a `timing` prints its line after the linters' output: the tools' seconds, then
// what it read, the daemon it found and the cache it started from (joshuafolkken/kit#5712).
async function run_lint_checks(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
	options: LintRunOptions = COLD_RUN,
): Promise<number> {
	const { timing } = options

	if (timing === undefined) {
		return write_lint_pair(await run_lint_pair(prettier_args, eslint_args, cache_file, options))
	}

	const pair = await run_lint_pair(prettier_args, eslint_args, cache_file, options)
	const exit_code = write_lint_pair(pair)
	const facts = [timing.targets, daemon_fact(pair.eslint), cache_fact(pair.eslint)]

	process.stdout.write(timing_line(pair, timing.label, facts))

	return exit_code
}

async function run_timed_lint_checks(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
): Promise<number> {
	const pair = await run_lint_pair(prettier_args, eslint_args, cache_file, COLD_RUN)
	const exit_code = write_lint_pair(pair)

	// joshuafolkken/kit#5116: the gate times `lint` as one step, so only this line names the long pole.
	process.stdout.write(timing_line(pair, GATE_TIMING_LABEL, []))

	return exit_code
}

async function run_lint_parallel_checks(options: LintRunOptions = COLD_RUN): Promise<number> {
	return await run_lint_checks(PRETTIER_ARGS, ESLINT_ARGS, ESLINT_CACHE_FILE, options)
}

// `josh lint --changed`, the gate's lint: the branch's changed files on the gate's own caches, or the
// whole tree where `lint-gate-scope.ts` cannot narrow. The line naming the decision is printed first,
// so a narrowed run is never read as a whole one.
async function run_changed_lint_checks(): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const files = await changed_file_scope.read_changed_files(root)
	const scope = lint_gate_scope.resolve_gate_scope(files, root, process.env)

	process.stdout.write(`${lint_gate_scope.describe_scope(scope, root)}\n`)

	if (scope.mode === 'all') {
		return await run_timed_lint_checks(PRETTIER_ARGS, ESLINT_ARGS, ESLINT_CACHE_FILE)
	}

	const narrowed = lint_gate_scope.narrowed_run(scope.files)

	return await run_timed_lint_checks(narrowed.prettier, narrowed.eslint, narrowed.eslint_cache_file)
}

async function run_lint_command(command_arguments: ReadonlyArray<string>): Promise<number> {
	if (command_arguments.includes(lint_gate_scope.CHANGED_FLAG)) {
		return await run_changed_lint_checks()
	}

	return await run_lint_parallel_checks()
}

const lint_parallel = {
	run_eslint,
	run_lint_checks,
	run_lint_command,
	run_lint_parallel_checks,
}

export type { LintRunTiming }
export { ESLINT_ARGS, lint_parallel, PRETTIER_ARGS }
