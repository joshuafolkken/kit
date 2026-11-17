import { describe, expect, it } from 'vitest'
import { test_related_record, type RunInput, type StageTimes } from './test-related-record'

// joshuafolkken/kit#7828: the launcher's rebuild, the core wait and vitest, each timed apart.

const ROOT = '/repository'
const CHANGE = 'scripts/own.ts'
const ELAPSED_MS = 1234.6
const ROUNDED_MS = Math.round(ELAPSED_MS)

const INPUT: RunInput = {
	scope: { mode: 'related', files: [`${ROOT}/${CHANGE}`], reason: '1 related file(s)' },
	root: ROOT,
	changed: [CHANGE],
	synced: [],
	since_map: [],
}

function record_with(stages: StageTimes): ReturnType<typeof test_related_record.record_of> {
	return test_related_record.record_of(INPUT, { elapsed_ms: 0, test_files: undefined, stages })
}

describe('test_related_record.record_of — the stage times', () => {
	it('records each timed stage rounded to a whole millisecond', () => {
		const record = record_with({
			rebuild_ms: ELAPSED_MS,
			core_wait_ms: ELAPSED_MS,
			vitest_ms: ELAPSED_MS,
		})

		expect(record).toMatchObject({
			rebuild_ms: ROUNDED_MS,
			core_wait_ms: ROUNDED_MS,
			vitest_ms: ROUNDED_MS,
		})
	})

	it('leaves out a stage that did not run', () => {
		const record = record_with({ rebuild_ms: undefined, vitest_ms: ELAPSED_MS })

		expect(record).not.toHaveProperty('rebuild_ms')
		expect(record).not.toHaveProperty('core_wait_ms')
		expect(record.vitest_ms).toBe(ROUNDED_MS)
	})

	it('leaves out every stage where the run timed none', () => {
		const record = test_related_record.record_of(INPUT, { elapsed_ms: 0, test_files: undefined })

		expect(record).not.toHaveProperty('vitest_ms')
	})
})
