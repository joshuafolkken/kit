import { describe, expect, it } from 'vitest'
import { time_batch } from './time-batch'
import { time_epic_fixture } from './time-epic-fixture'

// What a run is worth measuring, in the four states a batch reports it in (joshuafolkken/kit#1312).
//
// The cases were `time-epic.test.ts`'s until `--last` needed the same classification: two scopes now
// read these answers, so the suite sits beside the module rather than beside one of its callers. The
// fan-out itself is covered where a batch drives it — `time-epic-children.test.ts` for `--epic` and
// `time-last.test.ts` for `--last`.

const { MINUTE_MS, report_of } = time_epic_fixture

describe('time_batch.status_of', () => {
	// The acceptance criterion: a run that never ran is not a run that took no time.
	it('calls a run with no spans and no merge "not run"', () => {
		const report = report_of({ issue_number: 1, has_ci_data: false, span_count: 0 })

		expect(time_batch.status_of(report)).toBe(time_batch.NOT_RUN)
	})

	it('separates a run that never merged from one that did', () => {
		const open = report_of({ issue_number: 1, has_ci_data: false, span_count: 4 })

		expect(time_batch.status_of(open)).toBe(time_batch.NOT_MERGED)
		expect(time_batch.status_of(report_of({ issue_number: 1 }))).toBe(time_batch.MEASURED)
	})

	// Measured on epic #1272 itself: children that merged with a real CI wait and not one line of
	// transcript attributed. Calling that `measured` would print `model 0.0 min` for a model wait
	// nobody read.
	it('separates a merge with no transcript from a fully measured run', () => {
		const merged_only = report_of({ issue_number: 1, span_count: 0 })

		expect(time_batch.status_of(merged_only)).toBe(time_batch.NO_TRANSCRIPT)
	})
})

describe('time_batch.ms_per_turn_of', () => {
	it('divides model wait by the turns it was spread over', () => {
		const report = report_of({ issue_number: 1, model_ms: 4 * MINUTE_MS, turn_count: 4 })

		expect(time_batch.ms_per_turn_of(report)).toBe(MINUTE_MS)
	})

	// Never `0`: "no turn was recorded" and "each turn was instant" are different answers.
	it('answers undefined rather than zero for a run with no turn', () => {
		expect(time_batch.ms_per_turn_of(report_of({ issue_number: 1, turn_count: 0 }))).toBeUndefined()
	})
})

describe('time_batch.count_status', () => {
	it('counts only the rows carrying the status asked about', () => {
		const rows = [
			time_batch.to_timing(1, report_of({ issue_number: 1 })),
			time_batch.to_timing(2, report_of({ issue_number: 2, span_count: 0 })),
			time_batch.to_timing(3, report_of({ issue_number: 3, span_count: 0 })),
		]

		expect(time_batch.count_status(rows, time_batch.MEASURED)).toBe(1)
		expect(time_batch.count_status(rows, time_batch.NO_TRANSCRIPT)).toBe(2)
	})
})
