import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_ending_reason } from './run-board-ending-reason'

// joshuafolkken/kit#4045: a parked or withdrawn row says why it ended, in its ending event's words.

const KIND = run_event_stream.EVENT_KIND
const REVIEW_FAILED = 'run:stalled: review failed'

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-10-18T09:00:00.000Z', kind, text }
}

function reasons(kind: string, texts: ReadonlyArray<string>): Array<string | undefined> {
	return texts.map((text) => run_board_ending_reason.reason_of(event(kind, text)))
}

describe('run_board_ending_reason.reason_of', () => {
	it('reads a park reason with its parentheses unwrapped, and none from a bare park', () => {
		expect(
			reasons(KIND.PARK, ['#13 parked (ship-stop cap)', '#13 waiting on #7', '#13 parked']),
		).toStrictEqual(['ship-stop cap', 'waiting on #7', undefined])
	})

	// joshuafolkken/kit#4215: a stalled row names its cause and the action that resumes it.
	it('keeps the raw stall cause until the layout chooses the resume action', () => {
		expect(
			reasons(KIND.PARK, [
				'#13 parked (run:stalled: review failed)',
				'#13 parked (run:stalled: ship-stop cap)',
				'#13 parked (run:stalled)',
			]),
		).toStrictEqual([REVIEW_FAILED, 'run:stalled: ship-stop cap', 'run:stalled'])
	})

	// joshuafolkken/kit#5780: a park on a timed-out merge wait names the missing required context.
	it('keeps the missing context of a park on a timed-out merge wait', () => {
		expect(reasons(KIND.PARK, ['#13 parked (run:stalled: BLOCKED: Checks missing)'])).toStrictEqual(
			['run:stalled: BLOCKED: Checks missing'],
		)
	})
})

describe('run_board_ending_reason.park_row_reason', () => {
	it('bounds a long recorded cause without changing the stored event reason', () => {
		const cause = 'Long cause. '.repeat(20)
		const reason = `run:stalled: ${cause}`

		expect(run_board_ending_reason.park_row_reason(13, reason, true)).toBe(
			`→ resume: pnpm josh run:add 13 --retry (${cause.slice(0, 119)}…)`,
		)
	})
	it.each([
		[true, 'pnpm josh run:add 13 --retry'],
		[false, 'fullrun #13'],
	])('selects the current resume action when live is %s', (is_live, command) => {
		expect(run_board_ending_reason.park_row_reason(13, REVIEW_FAILED, is_live)).toBe(
			`→ resume: ${command} (review failed)`,
		)
	})
})

describe('run_board_ending_reason.reason_of — other ending events', () => {
	it('reads a withdraw reason after its prefix, and none where it gives none', () => {
		expect(
			reasons(KIND.WITHDRAW, [
				'#13 withdrawn by a person: superseded by #20',
				'#13 withdrawn by a person: ',
				'#13 withdrawn by the run:wake supervisor: closed as not planned',
				'#13 withdrawn',
			]),
		).toStrictEqual(['superseded by #20', undefined, 'closed as not planned', undefined])
	})

	it('reads no reason from an event that is neither a park nor a withdraw', () => {
		expect(reasons(KIND.MERGE, ['#13 merged'])).toStrictEqual([undefined])
	})
})

// joshuafolkken/kit#6577: a stopped lane, or a working child's stopped ship, names what stopped it.
describe('run_board_ending_reason.row_reason — a stop reason', () => {
	const read = { titles: new Map(), labels: new Map() }

	it('names the command that stopped the lane, or the ship of a child still working', () => {
		const stopped = { state: 'stopped', stop_reason: 'lane:close' } as const
		const running = { state: 'running', stop_reason: 'run:release' } as const

		expect(run_board_ending_reason.row_reason(13, stopped, read)).toStrictEqual({
			reason: { tail: 'stopped by lane:close' },
		})
		expect(run_board_ending_reason.row_reason(13, running, read)).toStrictEqual({
			reason: { tail: 'ship stopped by run:release' },
		})
	})

	it('draws no reason where nothing recorded one', () => {
		expect(run_board_ending_reason.row_reason(13, { state: 'stopped' }, read)).toStrictEqual({})
	})
})

// joshuafolkken/kit#4916: `run:merge` withdraws a child whose issue closed without a merge.
describe('run_board_ending_reason.reason_of — a run:merge withdrawal', () => {
	it('reads the reason after the run:merge driver prefix', () => {
		expect(
			reasons(KIND.WITHDRAW, ['#13 withdrawn by the run:merge driver: closed without a merge']),
		).toStrictEqual(['closed without a merge'])
	})
})
