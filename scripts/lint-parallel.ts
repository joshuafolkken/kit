#!/usr/bin/env tsx
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PNPM = 'pnpm'
const FORCE_COLOR = '1'
const FAIL_EXIT_CODE = 1
const PRETTIER_ARGS = ['exec', 'prettier', '--check', '.'] as const
const ESLINT_ARGS = ['exec', 'eslint', '.', '--cache', '--cache-strategy', 'content'] as const

interface LintCheckResult {
	output: string
	exit_code: number
}

async function run_process(arguments_: ReadonlyArray<string>): Promise<LintCheckResult> {
	return await new Promise((resolve) => {
		let output = ''
		// eslint-disable-next-line sonarjs/no-os-command-from-path -- pnpm is a trusted developer CLI
		const proc = spawn(PNPM, [...arguments_], {
			stdio: 'pipe',
			env: { ...process.env, FORCE_COLOR },
		})

		proc.stdout.on('data', (data: Buffer) => {
			output += data.toString()
		})
		proc.stderr.on('data', (data: Buffer) => {
			output += data.toString()
		})
		proc.on('close', (code) => {
			resolve({ output, exit_code: code ?? FAIL_EXIT_CODE })
		})
	})
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
