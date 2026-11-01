#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lint_related_scope } from '#scripts/lint/lint-related-scope'
import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { execa } from 'execa'
import run_parallel from 'run-parallel'
import { check_related_order } from './check-related-order'
import { check_related_pinned } from './check-related-pinned'
import { check_related_reuse } from './check-related-reuse'
import { check_related_section, type CheckResult } from './check-related-section'
import { check_related_unplanned } from './check-related-unplanned'
import { gate_labels } from './gate-labels'
import { gate_log } from './gate-log'
import type { GateTree } from './gate-tree'
import { metrics_totals } from './metrics-totals'
import { tree_verdict } from './tree-verdict'
import { verification_tail } from './verification-tail'

const COMMAND = 'check:related'
// One file per checkout beside the gate's own log, overwritten by each run.
const LOG_PATH = stamp_file.stamp_path(
	'josh-check-related-log-',
	PROJECT_ROOT,
	gate_log.GATE_LOG_SUFFIX,
)
const LINT_RELATED = 'lint:related'
// The verdict `lint:related` itself prints last, under its own label.
const LINT_PASSED = verification_tail.format_verdict(lint_related_scope.COMMAND_LABEL, [])
const CHECKS: ReadonlyArray<string> = [
	LINT_RELATED,
	'test:related',
	gate_labels.TYPE_CHECK_TARGET,
	'cspell:dot',
]
const REUSED = 'reused'
const VERDICT_RECORD = tree_verdict.record_path('check-related')
const METRICS_STOP =
	'`josh ship`\'s pre-detach stops on the metrics notice above unless the branch approval already names the total; settle it first (`pnpm josh metrics --accept --reason "<why>"`); the accept needs no `check:related` re-run, as the notice changed no exit code'

type CheckExecutor = (command: string) => Promise<CheckResult>
type ProcessRunner = (
	file: string,
	args: Array<string>,
	options: { all: true; reject: false },
) => Promise<{ all: string | null; exitCode?: number }>

async function run_execa(
	file: string,
	args: Array<string>,
	options: { all: true; reject: false },
): Promise<{ all: string | null; exitCode?: number }> {
	return await execa(file, args, options)
}

function failed_result(command: string, error: unknown): CheckResult {
	return {
		command,
		exit_code: 1,
		output: error instanceof Error ? error.message : String(error),
	}
}

async function execute_check(
	command: string,
	run: ProcessRunner = run_execa,
): Promise<CheckResult> {
	try {
		const result = await run('pnpm', ['josh', command], { all: true, reject: false })

		return { command, exit_code: result.exitCode ?? 1, output: result.all ?? '' }
	} catch (error) {
		return failed_result(command, error)
	}
}

async function start_check(
	command: string,
	execute: CheckExecutor,
	complete: run_parallel.TaskCallback<CheckResult>,
): Promise<void> {
	try {
		const result = await execute(command)

		// eslint-disable-next-line unicorn/no-null -- run-parallel requires null for successful tasks.
		complete(null, result)
	} catch (error) {
		// eslint-disable-next-line unicorn/no-null -- run-parallel requires null for successful tasks.
		complete(null, failed_result(command, error))
	}
}

async function run_checks(
	execute: CheckExecutor = execute_check,
	commands: ReadonlyArray<string> = CHECKS,
): Promise<Array<CheckResult>> {
	const ordered = check_related_order.lint_first(execute, commands)
	const tasks = commands.map((command): run_parallel.Task<CheckResult> => {
		return (complete): void => {
			void start_check(command, ordered, complete)
		}
	})

	return await new Promise<Array<CheckResult>>((resolve): void => {
		run_parallel(tasks, (_error, results): void => {
			resolve(results)
		})
	})
}

// A check that was not run did not fail; the one it waited on is the failure to fix.
function failed_commands(results: ReadonlyArray<CheckResult>): ReadonlyArray<string> {
	return results
		.filter((result) => result.exit_code !== 0 && result.is_skipped !== true)
		.map((result) => result.command)
}

function not_run_suffix(results: ReadonlyArray<CheckResult>): string {
	const skipped = results.filter((result) => result.is_skipped === true)

	if (skipped.length === 0) return ''

	return ` (${check_related_section.NOT_RUN}: ${skipped.map((result) => result.command).join(', ')})`
}

// The verdict is the last line, as every josh check prints it, so a reader of the tail sees every
// check that failed rather than only the section that finished last (joshuafolkken/kit#4940).
function checks_line(results: ReadonlyArray<CheckResult>): string {
	return verification_tail.format_verdict(COMMAND, failed_commands(results))
}

// Each failed check and the command that reproduces it alone, above the log notice (joshuafolkken/kit#5162).
function failure_lines(results: ReadonlyArray<CheckResult>): string {
	const failed = failed_commands(results)
	if (failed.length === 0) return ''

	const lines = failed.map((command) =>
		verification_tail.format_rerun(command, `pnpm josh ${command}`),
	)

	return `${COMMAND} — next:\n${lines.join('\n')}\n`
}

// Every check's whole output, kept where the console's size limit cannot reach, as `josh gate` keeps its own.
function write_log(results: ReadonlyArray<CheckResult>, target: string): string | undefined {
	const entries = results.map((result) => ({
		header: `${result.command}: ${check_related_section.result_status(result)}`,
		output: result.output,
	}))

	return gate_log.write_gate_log(entries, target)
}

function reused_suffix(reused: ReadonlySet<string>): string {
	return reused.size === 0 ? '' : ` (reused: ${[...reused].join(', ')})`
}

// A notice is never a failure, so a passing verdict line alone hid it from a reader of the last lines,
// and the ship's pre-detach stopped on it (joshuafolkken/kit#4987).
function verdict_line(
	results: ReadonlyArray<CheckResult>,
	has_metrics_notice: boolean,
	reused: ReadonlySet<string>,
): string {
	const line = `${checks_line(results)}${not_run_suffix(results)}${reused_suffix(reused)}`

	return has_metrics_notice ? `${line} — ${METRICS_STOP}` : line
}

// `josh lint:related` ends its section with the metrics growth notice, which the sections after it
// bury; it is repeated above the verdict so the tail still carries what stops `josh ship`
// (joshuafolkken/kit#4939).
function metrics_notice(results: ReadonlyArray<CheckResult>): string | undefined {
	const output = results.find((result) => result.command === LINT_RELATED)?.output ?? ''
	const start = output.indexOf(metrics_totals.NOTICE_HEADING)

	if (start === -1) return undefined

	// The lint's own verdict closes its section; it is not part of the notice.
	return output.slice(start).replace(LINT_PASSED, '').trimEnd()
}

function report_reused(reused: ReadonlySet<string>): void {
	for (const command of reused) {
		process.stdout.write(`\n=== ${command}: ${REUSED} ===\n`)
	}
}

interface ReportOptions {
	pinned_notice?: string | undefined
	unplanned_notice?: string | undefined
	reused?: ReadonlySet<string>
	log_target?: string
	is_full?: boolean
}

function format_notices(notices: ReadonlyArray<string | undefined>): string {
	return notices.map((notice) => (notice === undefined ? '' : `\n${notice}\n`)).join('')
}

function verdict_tail(
	results: ReadonlyArray<CheckResult>,
	log: { path: string | undefined },
	verdict: string,
): string {
	return `\n${verification_tail.format_tail({ failures: failure_lines(results), log, verdict })}`
}

// Returns what `tree-verdict.ts` keeps for a re-run on the same tree: the metrics notice and the tail.
// The `test:pinned` and unplanned notices, printed first, read state outside the tree key, so a replay
// asks them again above the kept text.
function report_results(results: ReadonlyArray<CheckResult>, options: ReportOptions = {}): string {
	const { is_full, log_target = LOG_PATH, reused = new Set<string>() } = options

	report_reused(reused)

	for (const result of results) {
		process.stdout.write(check_related_section.format_section(result, is_full))
	}

	const metrics = metrics_notice(results)
	const log = { path: write_log(results, log_target) }
	const tail = verdict_tail(results, log, verdict_line(results, metrics !== undefined, reused))

	const kept = `${format_notices([metrics])}${tail}`

	process.stdout.write(
		`${format_notices([options.pinned_notice, options.unplanned_notice])}${kept}`,
	)

	return kept
}

function exit_code(results: ReadonlyArray<CheckResult>): number {
	return results.every((result: CheckResult): boolean => result.exit_code === 0) ? 0 : 1
}

// **The first check of a round-1 fix starts `josh test:pinned` again on the fixed tree**
// (joshuafolkken/kit#4948): left to `josh review:record`, the restart came minutes before the ship, and
// its pre-detach waited out a whole run. Started here, the check runs beside these four; a tree that did
// not move, or a run outside a lane child, starts nothing. A verdict that check already reached on this
// tree is printed above the verdict line, waited for when this run started it (`check-related-pinned.ts`).
// A check whose green record still holds is not run (`check-related-reuse.ts`).
async function results_not_reused(
	tree: GateTree,
	execute: CheckExecutor,
): Promise<{ results: Array<CheckResult>; reused: ReadonlySet<string> }> {
	const reused = await check_related_reuse.reusable(CHECKS, tree)
	const results = await run_checks(
		execute,
		CHECKS.filter((command) => !reused.has(command)),
	)

	await check_related_reuse.record(results, tree)

	return { results, reused }
}

async function run_fresh(
	tree: GateTree,
	root: string | undefined,
	execute: CheckExecutor,
	is_full: boolean,
): Promise<number> {
	const is_started = await review_record_pinned.restart_in_lane(root)
	const { results, reused } = await results_not_reused(tree, execute)
	const tail = report_results(results, {
		is_full,
		pinned_notice: await check_related_pinned.notice(root, is_started),
		unplanned_notice: await check_related_unplanned.notice(),
		reused,
	})
	const code = exit_code(results)

	await tree_verdict.record(
		{ before: tree, exit_code: code, tail },
		check_related_reuse.read_tree,
		VERDICT_RECORD,
	)

	return code
}

// A tree this run already answered for, green or red, is answered again with no check run
// (`tree-verdict.ts`) — unless `--full` asks for the whole output the kept tail does not hold.
async function run_all(
	root?: string,
	execute: CheckExecutor = execute_check,
	is_full = false,
): Promise<number> {
	const tree = await check_related_reuse.read_tree()
	const kept = is_full ? undefined : tree_verdict.read(tree, VERDICT_RECORD)

	if (kept === undefined) return await run_fresh(tree, root, execute, is_full)

	return tree_verdict.replay(kept, VERDICT_RECORD, [
		await check_related_pinned.notice(root, false),
		await check_related_unplanned.notice(),
	])
}

const check_related = {
	CHECKS,
	METRICS_STOP,
	REUSED,
	execute_check,
	exit_code,
	report_results,
	run_all,
	run_checks,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await check_related.run_all(
		undefined,
		execute_check,
		check_related_section.is_full_requested(process.argv),
	)
}

export type { CheckExecutor }
export { check_related }

export { type CheckResult } from './check-related-section'
