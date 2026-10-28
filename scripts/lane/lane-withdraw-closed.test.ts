import { git_command } from '#scripts/git/git-command'
import { run_board_closed, type ClosedIssue } from '#scripts/run/board/run-board-closed'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_withdraw, type WithdrawOutcome } from './lane-withdraw'
import { lane_withdraw_closed } from './lane-withdraw-closed'

// joshuafolkken/kit#4915: #4906 was closed as not planned while its lane stayed open. Its child was
// resumed by a cut and kept working for 75 minutes, holding one of the two lanes the run had.

const WITHDRAWN = '4906'
const MERGED = '4912'
const OPEN = '4913'
const STRANDED = '4914'
const COMPLETED = '4915'
const SECOND = '4916'

const WITHDRAWN_OUTCOME: WithdrawOutcome = {
	kind: 'withdrawn',
	by: 'supervisor',
	reaped: 1,
	stash: undefined,
	is_noted: true,
	is_closed: true,
	lane: 'closed',
	residents: [],
}

function lane(issue: string, is_stranded = false): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}
}

function closed(is_merged: boolean, is_not_planned: boolean): ClosedIssue {
	return { title: 'x', labels: [], closed_ms: undefined, is_merged, is_not_planned }
}

function withdraw_event(issue: string): RunEvent {
	return {
		pos: 1,
		at: '2026-10-25T00:00:00.000Z',
		kind: run_event_stream.EVENT_KIND.WITHDRAW,
		text: `#${issue} withdrawn by the run:wake supervisor: x`,
	}
}

const list_lanes = vi.spyOn(lane_registry, 'list_lanes')
const read_all = vi.spyOn(run_board_closed, 'read_all')
const withdraw = vi.spyOn(lane_withdraw, 'withdraw')
const current_events = vi.spyOn(run_event_stream_emit, 'current_events')
const unpushed = vi.spyOn(git_command, 'commit_count_unpushed')

beforeEach(() => {
	vi.clearAllMocks()
	list_lanes.mockResolvedValue([
		lane(WITHDRAWN),
		lane(MERGED),
		lane(OPEN),
		lane(STRANDED, true),
		lane(COMPLETED),
	])
	read_all.mockResolvedValue({
		closed: new Map([
			[Number(WITHDRAWN), closed(false, true)],
			[Number(MERGED), closed(true, false)],
			[Number(COMPLETED), closed(false, false)],
		]),
		is_whole: true,
	})
	withdraw.mockResolvedValue(WITHDRAWN_OUTCOME)
	current_events.mockResolvedValue([])
	unpushed.mockResolvedValue(0)
})

describe('lane_withdraw_closed.withdraw_closed — which lanes', () => {
	it('withdraws only the lane whose issue closed as not planned, as the supervisor', async () => {
		const notes = await lane_withdraw_closed.withdraw_closed()

		expect(withdraw).toHaveBeenCalledExactlyOnceWith(
			WITHDRAWN,
			lane_withdraw_closed.SWEEP_REASON,
			'supervisor',
		)
		expect(notes).toStrictEqual([lane_withdraw.describe(WITHDRAWN_OUTCOME, WITHDRAWN)])
	})

	it('reads the state of the live lanes alone', async () => {
		await lane_withdraw_closed.withdraw_closed()

		expect(read_all).toHaveBeenCalledExactlyOnceWith([
			Number(WITHDRAWN),
			Number(MERGED),
			Number(OPEN),
			Number(COMPLETED),
		])
	})

	it('withdraws nothing when no lane issue answered as closed', async () => {
		read_all.mockResolvedValue({ closed: new Map(), is_whole: false })

		await expect(lane_withdraw_closed.withdraw_closed()).resolves.toStrictEqual([])
		expect(withdraw).not.toHaveBeenCalled()
	})

	it('does not withdraw a lane whose withdrawal is already on the event stream', async () => {
		current_events.mockResolvedValue([withdraw_event(WITHDRAWN)])

		await expect(lane_withdraw_closed.withdraw_closed()).resolves.toStrictEqual([])
		expect(withdraw).not.toHaveBeenCalled()
	})
})

describe('lane_withdraw_closed.withdraw_closed — work that a close would lose', () => {
	it('keeps a lane whose branch has commits on no remote and tells a person', async () => {
		unpushed.mockResolvedValue(2)
		const notes = await lane_withdraw_closed.withdraw_closed()

		expect(withdraw).not.toHaveBeenCalled()
		expect(notes).toStrictEqual([expect.stringContaining(`pnpm josh lane:withdraw ${WITHDRAWN}`)])
	})

	it('keeps the lane when the unpushed count cannot be read', async () => {
		unpushed.mockRejectedValue(new Error('no such branch'))

		await lane_withdraw_closed.withdraw_closed()

		expect(withdraw).not.toHaveBeenCalled()
	})
})

describe('lane_withdraw_closed.withdraw_closed — a failure', () => {
	it('notes the failed lane and still withdraws the rest', async () => {
		list_lanes.mockResolvedValue([lane(WITHDRAWN), lane(SECOND)])
		read_all.mockResolvedValue({
			closed: new Map([
				[Number(WITHDRAWN), closed(false, true)],
				[Number(SECOND), closed(false, true)],
			]),
			is_whole: true,
		})
		withdraw.mockRejectedValueOnce(new Error('gh failed'))
		const notes = await lane_withdraw_closed.withdraw_closed()

		expect(withdraw).toHaveBeenCalledTimes(2)
		expect(notes).toStrictEqual([
			expect.stringContaining('gh failed'),
			lane_withdraw.describe(WITHDRAWN_OUTCOME, SECOND),
		])
	})
})

// joshuafolkken/kit#4916: `run:merge` withdraws a lane closed without a merge through the same guard.
describe('lane_withdraw_closed.withdraw_lane — as run:merge', () => {
	const REASON = 'closed without a merge'

	it('withdraws the lane as the named withdrawer', async () => {
		const result = await lane_withdraw_closed.withdraw_lane(lane(WITHDRAWN), REASON, 'merge')

		expect(withdraw).toHaveBeenCalledExactlyOnceWith(WITHDRAWN, REASON, 'merge')
		expect(result).toStrictEqual({
			note: lane_withdraw.describe(WITHDRAWN_OUTCOME, WITHDRAWN),
			is_retry: false,
		})
	})

	it('keeps a branch with commits on no remote', async () => {
		unpushed.mockResolvedValue(2)
		const result = await lane_withdraw_closed.withdraw_lane(lane(WITHDRAWN), REASON, 'merge')

		expect(withdraw).not.toHaveBeenCalled()
		expect(result.is_retry).toBe(false)
		expect(result.note).toContain(`pnpm josh lane:withdraw ${WITHDRAWN}`)
	})

	// joshuafolkken/kit#4926: a yielded lane's issue is open, so the note does not call it closed.
	it('says a kept yielded lane gave its lane back', async () => {
		unpushed.mockResolvedValue(2)
		const result = await lane_withdraw_closed.withdraw_lane(lane(WITHDRAWN), REASON, 'yield')

		expect(result.note).toContain('gave its lane back')
		expect(result.note).not.toContain(REASON)
	})

	it('asks for a retry when the withdrawal could not read the issue', async () => {
		withdraw.mockResolvedValue({ kind: 'unreadable' })
		const result = await lane_withdraw_closed.withdraw_lane(lane(WITHDRAWN), REASON, 'merge')

		expect(result.is_retry).toBe(true)
	})
})
