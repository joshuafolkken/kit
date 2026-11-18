import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_ending_reason } from './run-board-ending-reason'
import { run_board_lane_state } from './run-board-lane-state'
import { run_board_lane_stop } from './run-board-lane-stop'
import {
	run_board_status,
	type ItemState,
	type ItemStatus,
	type OpenRead,
} from './run-board-status'

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
		const running = { state: 'running', stop_reason: RUN_STALLED_LABEL } as const

		expect(run_board_ending_reason.row_reason(13, stopped, read)).toStrictEqual({
			reason: { tail: 'stopped by lane:close' },
		})
		expect(run_board_ending_reason.row_reason(13, running, read)).toStrictEqual({
			reason: { tail: `ship stopped by ${RUN_STALLED_LABEL}` },
		})
	})

	it('draws no reason where nothing recorded one', () => {
		expect(run_board_ending_reason.row_reason(13, { state: 'stopped' }, read)).toStrictEqual({})
	})
})

// joshuafolkken/kit#7901: a ⏳ lane row says why it waits and what starts it.
describe('run_board_ending_reason.row_reason — a waiting lane', () => {
	const { WAITING_TAILS } = run_board_ending_reason
	const waiting: ItemStatus = { state: 'waiting' }

	it.each<[string, ReadonlyArray<string> | undefined, string]>([
		['no blocker', undefined, WAITING_TAILS.free],
		['a blocker in this repository', ['7228'], WAITING_TAILS.blocker],
		['an upstream Issue', ['joshuafolkken/kit#7691'], WAITING_TAILS.upstream],
		['an upstream Issue beside a local blocker', ['7228', 'owner/repo#3'], WAITING_TAILS.upstream],
	])('names the next move of a retry held by %s', (_case, waits, tail) => {
		const read = {
			titles: new Map(),
			labels: new Map(),
			...(waits !== undefined && { waits: new Map([[13, waits]]) }),
		}

		expect(run_board_ending_reason.row_reason(13, waiting, read)).toStrictEqual({
			reason: { tail },
		})
	})

	it('keeps a recorded waiting reason', () => {
		const read = { titles: new Map(), labels: new Map() }
		const reason = 'held by the parent'
		const status: ItemStatus = { state: 'waiting', reason }

		expect(run_board_ending_reason.row_reason(13, status, read)).toStrictEqual({
			reason: { tail: reason },
		})
	})

	it('fits each tail within a running row tail width', () => {
		const RUNNING_TAIL_WIDTH = 26

		for (const tail of Object.values(WAITING_TAILS)) {
			expect(tail.length).toBeLessThanOrEqual(RUNNING_TAIL_WIDTH)
		}
	})
})

// joshuafolkken/kit#7750: a missing `in-progress` is a fact, not a guessed `run:release`.
describe('run_board_ending_reason.row_reason — no in-progress label', () => {
	const read = { titles: new Map(), labels: new Map() }
	const { UNLABELLED_REASON } = run_board_lane_stop

	it.each<[ItemState, string]>([
		['stopped', `stopped · ${UNLABELLED_REASON}`],
		['running', UNLABELLED_REASON],
	])('names a %s row without in-progress by that fact', (state, tail) => {
		const status = { state, stop_reason: UNLABELLED_REASON }

		expect(run_board_ending_reason.row_reason(13, status, read)).toStrictEqual({
			reason: { tail },
		})
	})

	// The #7703 board: a live lane's worker handed off to its detached ship and lost `in-progress`.
	it('draws a live lane without in-progress running, naming no run:release', () => {
		const handed_off: ItemStatus = { state: 'running', started_ms: 0, result: 'completed' }
		const lanes = { ...run_board_lane_state.NO_LANES, own: new Map([[7703, handed_off]]) }
		const labels = new Map([[7703, ['bug', 'run:lane']]])
		const open: OpenRead = { open_numbers: new Set([7703]), read_ms: 1, closed: new Map(), labels }
		const status = run_board_status
			.settle_closed(run_board_status.statuses_of([], lanes), open)
			.get(7703)

		expect(status?.state).toBe('running')
		expect(run_board_ending_reason.row_reason(7703, status ?? handed_off, read)).toStrictEqual({
			reason: { tail: UNLABELLED_REASON },
		})
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
