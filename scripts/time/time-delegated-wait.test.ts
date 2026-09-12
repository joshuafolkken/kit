import { describe, expect, it } from 'vitest'
import { time_delegated_wait } from './time-delegated-wait'
import { time_phase_fixture } from './time-phase-fixture'
import { time_report } from './time-report'

const { span } = time_phase_fixture

// Positions are whole minutes, so the intervals are exact multiples of a minute and the naked and
// parallel arithmetic lands on round figures rather than a floating-point remainder.
const MINUTE_MS = 60_000
const BRACKET_LENGTH = 10
const UNIT_START = 1
const UNIT_LENGTH = 8
const CONCURRENT_START = 2
const CONCURRENT_LENGTH = 2
const SECOND_UNIT_START = 3
const SECOND_UNIT_LENGTH = 6
const FIRST_UNIT_LENGTH = 4
const PARALLEL_LENGTH = 2
const COVER_HALF_LENGTH = 4
const COVER_SECOND_START = 5
const CONCURRENT_LABEL = 'Bash'

// One parent `Agent`/`Task` bracket enclosing the delegation, and a unit inside it.
const BRACKET = span(0, BRACKET_LENGTH)
const UNIT = span(UNIT_START, UNIT_LENGTH)

function rendered(waits: ReturnType<typeof time_delegated_wait.waits_of>): string {
	return time_delegated_wait
		.wait_lines(time_delegated_wait.build_totals(waits, true, true))
		.join('\n')
}

describe('time_delegated_wait.waits_of', () => {
	it('reads a serial delegation as wholly naked', () => {
		const [wait] = time_delegated_wait.waits_of([BRACKET], [UNIT])

		expect(wait?.naked_ms).toBe(UNIT_LENGTH * MINUTE_MS)
		expect(wait?.parallel_ms).toBe(0)
		expect(wait?.lead_phase).toBe('')
	})

	it('subtracts concurrent main-line work from naked and names it', () => {
		const concurrent = span(CONCURRENT_START, CONCURRENT_LENGTH, { label: CONCURRENT_LABEL })

		const [wait] = time_delegated_wait.waits_of([BRACKET, concurrent], [UNIT])

		expect(wait?.naked_ms).toBe((UNIT_LENGTH - CONCURRENT_LENGTH) * MINUTE_MS)
		expect(wait?.lead_label).toBe(CONCURRENT_LABEL)
		expect(wait?.parallel_ms).toBe(0)
	})

	it('counts a parallel launch and keeps it out of naked', () => {
		const first = span(UNIT_START, FIRST_UNIT_LENGTH)
		const second = span(SECOND_UNIT_START, SECOND_UNIT_LENGTH)

		const [wait] = time_delegated_wait.waits_of([BRACKET], [first, second])

		expect(wait?.parallel_ms).toBe(PARALLEL_LENGTH * MINUTE_MS)
		expect(wait?.naked_ms).toBe((UNIT_LENGTH - PARALLEL_LENGTH) * MINUTE_MS)
	})

	it('reports nothing for a run that delegated nothing', () => {
		expect(time_delegated_wait.waits_of([BRACKET], [])).toEqual([])
	})
})

describe('time_delegated_wait.wait_lines', () => {
	it('withholds the whole block for a run that never delegated', () => {
		expect(
			time_delegated_wait.wait_lines(time_delegated_wait.build_totals([], false, false)),
		).toEqual([])
	})

	it('distinguishes an unmeasured wait from a measured zero', () => {
		const first = span(UNIT_START, COVER_HALF_LENGTH, { label: CONCURRENT_LABEL })
		const second = span(COVER_SECOND_START, COVER_HALF_LENGTH, { label: CONCURRENT_LABEL })
		const waits = time_delegated_wait.waits_of([BRACKET, first, second], [UNIT])

		const measured = rendered(waits)
		const unmeasured = time_delegated_wait
			.wait_lines(time_delegated_wait.build_totals([], false, true))
			.join('\n')

		expect(measured).toContain('naked 0.0 s')
		expect(measured).not.toContain(time_report.NOT_MEASURED)
		expect(unmeasured).toContain(time_report.NOT_MEASURED)
	})

	it('names concurrent main-line work as behind', () => {
		const concurrent = span(CONCURRENT_START, CONCURRENT_LENGTH, { label: CONCURRENT_LABEL })
		const text = rendered(time_delegated_wait.waits_of([BRACKET, concurrent], [UNIT]))

		expect(text).toContain('behind')
		expect(text).toContain(CONCURRENT_LABEL)
	})

	it('names a parallel launch', () => {
		const first = span(UNIT_START, FIRST_UNIT_LENGTH)
		const second = span(SECOND_UNIT_START, SECOND_UNIT_LENGTH)
		const text = rendered(time_delegated_wait.waits_of([BRACKET], [first, second]))

		expect(text).toContain('parallel')
	})
})

describe('time_report.format_report — delegated waits', () => {
	const timeline = { spans: [BRACKET, UNIT], started_ms: 0, ended_ms: BRACKET_LENGTH * MINUTE_MS }

	it('carries the block on a session report that waited on a delegation', () => {
		const totals = time_delegated_wait.build_totals(
			time_delegated_wait.waits_of([BRACKET], [UNIT]),
			true,
			true,
		)
		const text = time_report.format_report(time_report.build_report('x', timeline, [], totals))

		expect(text).toContain(time_delegated_wait.HEADING)
		expect(text).toContain('naked')
	})

	it('leaves the block out of a report with no delegation', () => {
		const text = time_report.format_report(time_report.build_report('y', timeline))

		expect(text).not.toContain(time_delegated_wait.HEADING)
	})
})
