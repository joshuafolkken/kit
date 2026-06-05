#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'

const PNPM = 'pnpm'
const LABEL_WIDTH = 12
const FAIL_EXIT_CODE = 1
const STATUS_ICONS = { pass: '✔', warn: '⚠', fail: '✗' } as const

interface HealthCheckDefinition {
	label: string
	cmd: string
	cmd_args: ReadonlyArray<string>
	warn_on_fail?: boolean
}

type CheckStatus = keyof typeof STATUS_ICONS

interface CheckResult {
	label: string
	status: CheckStatus
}

const CHECKS: ReadonlyArray<HealthCheckDefinition> = [
	{ label: 'prettier', cmd: PNPM, cmd_args: ['exec', 'prettier', '--check', '.'] },
	{
		label: 'eslint',
		cmd: PNPM,
		cmd_args: ['exec', 'eslint', '.', '--cache', '--cache-strategy', 'content'],
	},
	{ label: 'type check', cmd: PNPM, cmd_args: ['exec', 'tsc', '--noEmit'] },
	{ label: 'security', cmd: PNPM, cmd_args: ['audit'], warn_on_fail: true },
	{ label: 'outdated', cmd: PNPM, cmd_args: ['outdated'], warn_on_fail: true },
]

function status_icon(status: CheckStatus): string {
	return STATUS_ICONS[status]
}

function classify_exit(exit_code: number, warn_on_fail: boolean | undefined): CheckStatus {
	if (exit_code === 0) return 'pass'

	return warn_on_fail ? 'warn' : 'fail'
}

async function run_silent(cmd: string, cmd_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(cmd, [...cmd_arguments], { stdio: 'ignore', reject: false })

	return result.exitCode ?? FAIL_EXIT_CODE
}

async function run_health_check(check: HealthCheckDefinition): Promise<CheckResult> {
	const exit_code = await run_silent(check.cmd, check.cmd_args)
	const status = classify_exit(exit_code, check.warn_on_fail)

	return { label: check.label, status }
}

function print_results(results: ReadonlyArray<CheckResult>): void {
	for (const { label, status } of results) {
		console.info(`  ${status_icon(status)} ${label.padEnd(LABEL_WIDTH)}`)
	}
}

async function run_health_checks(): Promise<number> {
	console.info('\nRunning health checks...\n')

	const results = await Promise.all(CHECKS.map(async (check) => await run_health_check(check)))

	print_results(results)
	console.info('')

	return results.some((result) => result.status === 'fail') ? FAIL_EXIT_CODE : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const exit_code = await run_health_checks()

	process.exit(exit_code)
}

const health_check = { classify_exit, run_health_check, run_health_checks, status_icon }

export type { CheckResult, CheckStatus }
export { health_check }
