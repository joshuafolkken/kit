import type { StartupSummary } from '#scripts/run/startup/run-startup-store'
import type { MeasureBoundary } from './backlog-measure-schema'

interface Completeness {
	status: 'normal' | 'degraded' | 'failed' | 'waiting' | 'incomplete'
	reasons: Array<string>
	normal_sample: boolean
	warmup_origin?: string
}

function reasons_of(
	summaries: ReadonlyArray<StartupSummary>,
	boundaries: ReadonlyArray<MeasureBoundary>,
): Array<string> {
	return [
		...summaries
			.filter((row) => row.status === 'failed')
			.map((row) => `failed: ${row.start.phase}`),
		...boundaries
			.filter((row) => row.read_status !== undefined)
			.map((row) => `${row.read_status ?? 'unknown'}: ${row.operation}`),
	]
}

function incomplete(summaries: ReadonlyArray<StartupSummary>): boolean {
	return summaries.length === 0 || summaries.some((row) => row.status === 'incomplete')
}

function status_of(
	summaries: ReadonlyArray<StartupSummary>,
	reasons: ReadonlyArray<string>,
	edge: 'done' | 'failed' | 'waiting',
): Completeness['status'] {
	if (edge === 'failed') return 'failed'
	if (incomplete(summaries)) return 'incomplete'
	if (reasons.length > 0) return 'degraded'

	return edge === 'waiting' ? 'waiting' : 'normal'
}

function assess(
	summaries: ReadonlyArray<StartupSummary>,
	boundaries: ReadonlyArray<MeasureBoundary>,
	edge: 'done' | 'failed' | 'waiting',
	warmup?: { attempt: string; completeness: Completeness },
): Completeness {
	const reasons = reasons_of(summaries, boundaries)

	if (warmup !== undefined && !['normal', 'waiting'].includes(warmup.completeness.status)) {
		reasons.push(`warmup: ${warmup.completeness.status}`, ...warmup.completeness.reasons)
	}

	const status = status_of(summaries, reasons, edge)

	return {
		status,
		reasons,
		normal_sample: status === 'normal',
		...(warmup !== undefined && { warmup_origin: warmup.attempt }),
	}
}

function is_capped(value: unknown): boolean {
	return value !== null && typeof value === 'object' && Reflect.get(value, 'is_capped') === true
}

function observe(value: unknown, operation: string): MeasureBoundary['read_status'] {
	if (value === undefined && operation === 'defect.measure_window') return 'missing'
	if (is_capped(value)) return 'capped'

	return undefined
}

const backlog_measure_completeness = { assess, observe }
export { backlog_measure_completeness }
export type { Completeness }
