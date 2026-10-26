#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { status_icons } from '#scripts/lib/status-icons'
import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { execa } from 'execa'
import run_parallel from 'run-parallel'
import { check_related_pinned } from './check-related-pinned'
import { gate_plan } from './gate-plan'
import { metrics_totals } from './metrics-totals'

const LINT_RELATED = 'lint:related'
const CHECKS: ReadonlyArray<string> = [
	LINT_RELATED,
	'test:related',
	gate_plan.TYPE_CHECK_TARGET,
	'cspell:dot',
]
const METRICS_STOP =
	'`josh ship`\'s pre-detach stops on the metrics notice above unless the branch approval already names the total; settle it first (`pnpm josh metrics --accept --reason "<why>"`)'

interface CheckResult {
	command: string
	exit_code: number
	output: string
}

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

async function run_checks(execute: CheckExecutor = execute_check): Promise<Array<CheckResult>> {
	const tasks = CHECKS.map((command): run_parallel.Task<CheckResult> => {
		return (complete): void => {
			void start_check(command, execute, complete)
		}
	})

	return await new Promise<Array<CheckResult>>((resolve): void => {
		run_parallel(tasks, (_error, results): void => {
			resolve(results)
		})
	})
}

function report_result(result: CheckResult): void {
	const status = result.exit_code === 0 ? 'passed' : `failed (${String(result.exit_code)})`

	process.stdout.write(`\n=== ${result.command}: ${status} ===\n`)
	if (result.output.length === 0) return

	process.stdout.write(result.output)
	if (!result.output.endsWith('\n')) process.stdout.write('\n')
}

// The verdict is the last line, as every josh check prints it, so a reader of the tail sees every
// check that failed rather than only the section that finished last (joshuafolkken/kit#4940).
function checks_line(results: ReadonlyArray<CheckResult>): string {
	const failed = results.filter((result) => result.exit_code !== 0).map((result) => result.command)

	if (failed.length === 0) return `${status_icons.PASS_ICON} check:related passed`

	return `${status_icons.FAIL_ICON} check:related failed: ${failed.join(', ')}`
}

// A notice is never a failure, so a passing verdict line alone hid it from a reader of the last lines,
// and the ship's pre-detach stopped on it (joshuafolkken/kit#4987).
function verdict_line(results: ReadonlyArray<CheckResult>, has_metrics_notice: boolean): string {
	const line = checks_line(results)

	return has_metrics_notice ? `${line} — ${METRICS_STOP}` : line
}

// `josh lint:related` ends its section with the metrics growth notice, which the sections after it
// bury; it is repeated above the verdict so the tail still carries what stops `josh ship`
// (joshuafolkken/kit#4939).
function metrics_notice(results: ReadonlyArray<CheckResult>): string | undefined {
	const output = results.find((result) => result.command === LINT_RELATED)?.output ?? ''
	const start = output.indexOf(metrics_totals.NOTICE_HEADING)

	if (start === -1) return undefined

	return output.slice(start).trimEnd()
}

function report_results(results: ReadonlyArray<CheckResult>, pinned_notice?: string): void {
	for (const result of results) {
		report_result(result)
	}

	const metrics = metrics_notice(results)

	for (const notice of [metrics, pinned_notice]) {
		if (notice !== undefined) process.stdout.write(`\n${notice}\n`)
	}

	process.stdout.write(`\n${verdict_line(results, metrics !== undefined)}\n`)
}

function exit_code(results: ReadonlyArray<CheckResult>): number {
	return results.every((result: CheckResult): boolean => result.exit_code === 0) ? 0 : 1
}

// **The first check of a round-1 fix starts `josh test:pinned` again on the fixed tree**
// (joshuafolkken/kit#4948): left to `josh review:record`, the restart came minutes before the ship, and
// its pre-detach waited out a whole run. Started here, the check runs beside these four; a tree that did
// not move, or a run outside a lane child, starts nothing. A verdict that check already reached on this
// tree is printed above the verdict line, waited for when this run started it (`check-related-pinned.ts`).
async function run_all(root?: string, execute: CheckExecutor = execute_check): Promise<number> {
	const is_started = await review_record_pinned.restart_in_lane(root)
	const results = await run_checks(execute)

	report_results(results, await check_related_pinned.notice(root, is_started))

	return exit_code(results)
}

const check_related = {
	METRICS_STOP,
	execute_check,
	exit_code,
	report_results,
	run_all,
	run_checks,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await check_related.run_all()
}

export type { CheckExecutor, CheckResult }
export { check_related }
