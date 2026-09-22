import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { PILOT_FILES } from './pilot-files'

const RESULTS_FILE = 'pilot-measure-results.json'
const BASELINE_LABEL = 'baseline (isolate=true)'
const PILOT_LABEL = 'pilot (isolate=false)'
const PILOT_CONFIG = 'vitest.pilot.config.ts'
const JSON_INDENT = 2

interface MeasureResult {
	label: string
	duration_ms: number
	file_count: number
	worker_count: number
}

interface MeasureReport {
	baseline: MeasureResult
	pilot: MeasureResult
	saved_ms: number
	measured_at: string
}

function timed_vitest(args: string): number {
	const start = Date.now()

	execSync(`pnpm vitest run ${args}`, { stdio: 'inherit' })

	return Date.now() - start
}

function build_result(label: string, duration_ms: number, worker_count: number): MeasureResult {
	return { label, duration_ms, file_count: PILOT_FILES.length, worker_count }
}

function run_baseline(): MeasureResult {
	const duration_ms = timed_vitest(PILOT_FILES.join(' '))

	return build_result(BASELINE_LABEL, duration_ms, PILOT_FILES.length)
}

function run_pilot(): MeasureResult {
	const duration_ms = timed_vitest(`--config ${PILOT_CONFIG}`)

	return build_result(PILOT_LABEL, duration_ms, 1)
}

function output_path(): string {
	return path.join(process.cwd(), 'scripts', 'test', RESULTS_FILE)
}

function measure(): void {
	console.info('Running baseline (isolate=true)...')
	const baseline = run_baseline()

	console.info('Running pilot (isolate=false)...')
	const pilot = run_pilot()

	const report: MeasureReport = {
		baseline,
		pilot,
		saved_ms: baseline.duration_ms - pilot.duration_ms,
		measured_at: new Date().toISOString(),
	}

	const out = output_path()

	writeFileSync(out, JSON.stringify(report, undefined, JSON_INDENT))

	console.info(
		`Baseline: ${String(baseline.duration_ms)}ms | Pilot: ${String(pilot.duration_ms)}ms | Saved: ${String(report.saved_ms)}ms`,
	)
	console.info(`Results saved to ${out}`)
}

measure()
