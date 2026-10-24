#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import run_parallel from 'run-parallel'
import { gate_plan } from './gate-plan'

const CHECKS: ReadonlyArray<string> = [
	'lint:related',
	'test:related',
	gate_plan.TYPE_CHECK_TARGET,
	'cspell:dot',
]

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

function report_results(results: ReadonlyArray<CheckResult>): void {
	for (const result of results) {
		report_result(result)
	}
}

function exit_code(results: ReadonlyArray<CheckResult>): number {
	return results.every((result: CheckResult): boolean => result.exit_code === 0) ? 0 : 1
}

const check_related = { execute_check, exit_code, report_results, run_checks }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const results = await check_related.run_checks()

	check_related.report_results(results)
	process.exitCode = check_related.exit_code(results)
}

export type { CheckExecutor, CheckResult }
export { check_related }
