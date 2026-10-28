import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_ending_reason } from './run-board-ending-reason'

// joshuafolkken/kit#4045: a parked or withdrawn row says why it ended, in its ending event's words.

const KIND = run_event_stream.EVENT_KIND

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
	it('reads a run:stalled park as its cause and the resume action', () => {
		expect(
			reasons(KIND.PARK, [
				'#13 parked (run:stalled: review failed)',
				'#13 parked (run:stalled: ship-stop cap)',
				'#13 parked (run:stalled)',
			]),
		).toStrictEqual(['review failed → fullrun #13', 'ship-stop cap → fullrun #13', 'fullrun #13'])
	})

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

// joshuafolkken/kit#4916: `run:merge` withdraws a child whose issue closed without a merge.
describe('run_board_ending_reason.reason_of — a run:merge withdrawal', () => {
	it('reads the reason after the run:merge driver prefix', () => {
		expect(
			reasons(KIND.WITHDRAW, ['#13 withdrawn by the run:merge driver: closed without a merge']),
		).toStrictEqual(['closed without a merge'])
	})
})
