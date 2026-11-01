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
import { time_format } from '#scripts/time-runtime/time-format'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_daemon } from './eslint-daemon'
import { lint_gate_scope } from './lint-gate-scope'

// This — not the `lint:eslint` map entry — is the eslint invocation `josh gate` reaches, so the
// cache flags come from the same constant the ignore rules are asserted against.
// A copy here would keep writing the old location the day that constant
// moves, with every test still green.
const WHOLE_TREE = '.'
const ESLINT_ARGS = ['exec', 'eslint', WHOLE_TREE, ...ESLINT_CACHE_FLAGS] as const

// Prettier's cache stays this checkout's own, never shared through `lane_cache_run` as eslint's is:
// its entries do not survive a move (`josh-command-types.ts` → `GATE_CACHE_SPECS`).
const PRETTIER_ARGS = ['exec', 'prettier', '--check', WHOLE_TREE, ...PRETTIER_CACHE_FLAGS] as const

// What one eslint run is made of: the child's arguments and the cache file they name.
interface EslintRun {
	args: ReadonlyArray<string>
	cache_file: string
	warm_daemon: boolean
}

// Whether eslint may go through the checkout's warm daemon (`eslint-daemon.ts`). `josh lint:related`
// asks for it; the gate's own lint does not, so its whole-tree run stays one cold process of its own.
interface LintRunOptions {
	warm_daemon: boolean
}

const COLD_RUN: LintRunOptions = { warm_daemon: false }

interface LintPair {
	prettier: BufferedProcessResult
	eslint: BufferedProcessResult
}

// The warm daemon when asked for and reachable, else the cold `pnpm exec eslint` it falls back to.
async function run_eslint_process(eslint: EslintRun): Promise<BufferedProcessResult> {
	if (eslint.warm_daemon) return await eslint_daemon.run_or_cold(eslint.args)

	return await buffered_process.run_buffered_process(eslint.args)
}

// The run sits inside the lane's cache sharing, between dropping the entries whose imports changed
// and recording what the fresh ones read (`eslint-cache-dependencies.ts`).
async function run_eslint(eslint: EslintRun): Promise<BufferedProcessResult> {
	const { cache_file } = eslint

	return await lane_cache_run.run(cache_file, async () => {
		return await eslint_cache_dependencies.guard(
			cache_file,
			async () => await run_eslint_process(eslint),
		)
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

async function run_checked_eslint(
	directory: string,
	eslint: EslintRun,
): Promise<BufferedProcessResult> {
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

async function run_lint_checks(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
	options: LintRunOptions = COLD_RUN,
): Promise<number> {
	return write_lint_pair(await run_lint_pair(prettier_args, eslint_args, cache_file, options))
}

// joshuafolkken/kit#5116: the gate times `lint` as one step, and the two tools run side by side, so
// the step's seconds name neither tool as the long pole. This line, the gate's lint alone, does.
function timing_line({ prettier, eslint }: LintPair): string {
	const prettier_seconds = time_format.format_seconds(prettier.elapsed_ms)
	const eslint_seconds = time_format.format_seconds(eslint.elapsed_ms)

	return `lint timing — prettier ${prettier_seconds} · eslint ${eslint_seconds}\n`
}

async function run_timed_lint_checks(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
): Promise<number> {
	const pair = await run_lint_pair(prettier_args, eslint_args, cache_file, COLD_RUN)
	const exit_code = write_lint_pair(pair)

	process.stdout.write(timing_line(pair))

	return exit_code
}

async function run_lint_parallel_checks(): Promise<number> {
	return await run_lint_checks(PRETTIER_ARGS, ESLINT_ARGS, ESLINT_CACHE_FILE)
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

export { ESLINT_ARGS, lint_parallel, PRETTIER_ARGS }
export type { EslintRun }
