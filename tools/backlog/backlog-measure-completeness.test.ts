import { run_startup_schema } from '#scripts/run/startup/run-startup-schema'
import type { StartupSummary } from '#scripts/run/startup/run-startup-store'
import { expect, test } from 'vitest'
import { backlog_measure_completeness } from './backlog-measure-completeness'

const DEFECT_READ = 'defect.measure_window'

function summary(status: StartupSummary['status']): StartupSummary {
	return {
		start: run_startup_schema.entry_schema.parse({
			kind: 'startup',
			run: 'test',
			attempt: '0',
			at: '2026-11-13',
			id: 'child',
			phase: 'defect rate',
			edge: 'start',
		}),
		status,
		elapsed_ms: undefined,
		api: {},
		cache: {},
	}
}

test.each(['failed', 'incomplete'] as const)(
	'rejects %s children despite a completed parent',
	(status) => {
		const result = backlog_measure_completeness.assess(
			[summary('done'), summary(status)],
			[],
			'done',
		)

		expect(result.normal_sample).toBe(false)
		expect(result.status).toBe(status === 'failed' ? 'degraded' : 'incomplete')
	},
)

test('distinguishes a capped search from a missing required read', () => {
	expect(backlog_measure_completeness.observe({ is_capped: true }, DEFECT_READ)).toBe('capped')
	expect(backlog_measure_completeness.observe(undefined, DEFECT_READ)).toBe('missing')
	expect(backlog_measure_completeness.observe({ is_capped: false }, DEFECT_READ)).toBeUndefined()
})

test('retains incomplete warmup provenance on a later cache hit with no API reads', () => {
	const completeness = backlog_measure_completeness.assess([summary('failed')], [], 'done')
	const result = backlog_measure_completeness.assess([summary('done')], [], 'done', {
		attempt: 'warm:0',
		completeness,
	})

	expect(result).toMatchObject({
		status: 'degraded',
		normal_sample: false,
		warmup_origin: 'warm:0',
	})
	expect(result.reasons).toContain('failed: defect rate')
})

test('keeps intentional waiting distinct from failed launch and missing telemetry', () => {
	expect(backlog_measure_completeness.assess([summary('waiting')], [], 'waiting').status).toBe(
		'waiting',
	)
	expect(backlog_measure_completeness.assess([summary('done')], [], 'failed').status).toBe('failed')
	expect(backlog_measure_completeness.assess([], [], 'done').status).toBe('incomplete')
})
