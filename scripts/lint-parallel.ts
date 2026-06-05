#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const PNPM = 'pnpm'
const FORCE_COLOR = '1'
const FAIL_EXIT_CODE = 1
const PRETTIER_ARGS = ['exec', 'prettier', '--check', '.'] as const
const ESLINT_ARGS = ['exec', 'eslint', '.', '--cache', '--cache-strategy', 'content'] as const

interface LintCheckResult {
	output: string
	// execa reports `undefined` when a process is terminated by a signal; treat
	// that as a failure (it is never strictly equal to 0).
	exit_code: number | undefined
}

async function run_process(arguments_: ReadonlyArray<string>): Promise<LintCheckResult> {
	const result = await execa(PNPM, [...arguments_], {
		env: { ...process.env, FORCE_COLOR },
		all: true,
		reject: false,
	})

	return { output: result.all, exit_code: result.exitCode }
}

async function run_lint_parallel_checks(): Promise<number> {
	const [prettier, eslint] = await Promise.all([
		run_process(PRETTIER_ARGS),
		run_process(ESLINT_ARGS),
	])

	if (prettier.output) process.stdout.write(prettier.output)
	if (eslint.output) process.stdout.write(eslint.output)

	return prettier.exit_code !== 0 || eslint.exit_code !== 0 ? FAIL_EXIT_CODE : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const exit_code = await run_lint_parallel_checks()

	process.exit(exit_code)
}

export { run_lint_parallel_checks }
