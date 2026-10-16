import os from 'node:os'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_label } from '#scripts/run/run-label'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_close, type CloseOutcome } from './lane-close'
import { lane_preserve } from './lane-preserve'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_withdraw } from './lane-withdraw'

// joshuafolkken/kit#3908: a person withdraws a running lane child's issue for good. Every side effect is
// spied on — what is pinned is the order, and that a refusal writes nothing.

const ISSUE = '3769'
const REASON = 'superseded by #3780'
const DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
const STASH = `${ISSUE}: uncommitted work at lane withdraw`
const PID = 4242
const LOCK_ERROR = 'index.lock exists'

const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: DIRECTORY,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

const CLOSED_LANE: CloseOutcome = { issue: ISSUE, kind: 'closed', left_behind: [], reaped: [] }

function state_read(state: string): StateRead {
	return { kind: 'state', state: { state, labels: [], is_human_review: false } }
}

const read_issue = vi.spyOn(issue_state_cli, 'read_issue')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const reap_child = vi.spyOn(lane_reap, 'reap_child')
const changes_probe = vi.spyOn(git_stash, 'has_changes')
const push = vi.spyOn(git_stash, 'push')
const close_not_planned = vi.spyOn(git_gh_issue_write, 'issue_close_not_planned')
const announce = vi.spyOn(lane_preserve, 'announce')
const unmark = vi.spyOn(run_label, 'unmark')
const close_lane = vi.spyOn(lane_close, 'close_lane')

function first_call(spy: { mock: { invocationCallOrder: Array<number> } }): number {
	return spy.mock.invocationCallOrder[0] ?? 0
}

function expect_nothing_written(): void {
	expect(emit).not.toHaveBeenCalled()
	expect(reap_child).not.toHaveBeenCalled()
	expect(close_not_planned).not.toHaveBeenCalled()
	expect(close_lane).not.toHaveBeenCalled()
}

function arrange_open_lane(): void {
	read_issue.mockResolvedValue(state_read('OPEN'))
	find_open_lane.mockResolvedValue(LANE)
	emit.mockResolvedValue()
	reap_child.mockReturnValue([PID])
	changes_probe.mockResolvedValue(false)
}

function arrange_close(): void {
	push.mockResolvedValue()
	close_not_planned.mockResolvedValue(true)
	announce.mockResolvedValue()
	unmark.mockResolvedValue(true)
	close_lane.mockResolvedValue(CLOSED_LANE)
}

beforeEach(() => {
	vi.clearAllMocks()
	arrange_open_lane()
	arrange_close()
})

describe('lane_withdraw.withdraw — the order of the steps', () => {
	it('records the event, stops the child, keeps the work, closes the issue, then the lane', async () => {
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)
		const order = [emit, reap_child, changes_probe, close_not_planned, unmark, close_lane].map(
			(spy) => first_call(spy),
		)

		expect(order).toStrictEqual(order.toSorted((left, right) => left - right))
		expect(outcome).toStrictEqual({
			kind: 'withdrawn',
			reaped: 1,
			stash: undefined,
			is_closed: true,
			had_closed: false,
			lane: 'closed',
		})
	})

	it('names the issue and the reason on the event stream and in the close comment', async () => {
		await lane_withdraw.withdraw(ISSUE, REASON)

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.WITHDRAW,
			`#${ISSUE} withdrawn by a person: ${REASON}`,
		)
		expect(close_not_planned).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(`- Why: ${REASON}`),
		)
	})
})

describe('lane_withdraw.withdraw — the work and the child', () => {
	it('stashes uncommitted work and names the stash on the issue', async () => {
		changes_probe.mockResolvedValue(true)
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(push).toHaveBeenCalledWith(STASH, DIRECTORY)
		expect(announce).toHaveBeenCalledWith(ISSUE, STASH, expect.any(String))
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain(`pnpm josh stash:pop "${STASH}"`)
	})

	it('still withdraws a child that had already ended', async () => {
		reap_child.mockReturnValue([])
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toMatchObject({ kind: 'withdrawn', reaped: 0, is_closed: true })
		expect(close_lane).toHaveBeenCalledWith(ISSUE)
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('already ended')
	})

	it('leaves the close of an issue that merged before its child was stopped', async () => {
		read_issue.mockResolvedValueOnce(state_read('OPEN')).mockResolvedValueOnce(state_read('CLOSED'))
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toMatchObject({ kind: 'withdrawn', is_closed: true, had_closed: true })
		expect(close_not_planned).not.toHaveBeenCalled()
		expect(close_lane).toHaveBeenCalledWith(ISSUE)
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('already closed')
	})
})

describe('lane_withdraw.withdraw — refusals write nothing', () => {
	it('refuses a closed issue', async () => {
		read_issue.mockResolvedValue(state_read('closed'))

		expect(await lane_withdraw.withdraw(ISSUE, REASON)).toStrictEqual({ kind: 'closed' })
		expect(find_open_lane).not.toHaveBeenCalled()
		expect_nothing_written()
	})

	it('refuses when no lane is open', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await lane_withdraw.withdraw(ISSUE, REASON)).toStrictEqual({ kind: 'no-lane' })
		expect_nothing_written()
	})

	it('refuses when the issue state cannot be read', async () => {
		read_issue.mockResolvedValue({ kind: 'unreadable' })
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toStrictEqual({ kind: 'unreadable' })
		expect_nothing_written()
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('nothing was stopped or closed')
	})
})

describe('lane_withdraw.withdraw — what is left when a step fails', () => {
	it('leaves the issue open and the lane in place when the work cannot be stashed', async () => {
		changes_probe.mockResolvedValue(true)
		push.mockRejectedValue(new Error(LOCK_ERROR))
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toStrictEqual({ kind: 'unsaved', directory: DIRECTORY, reason: LOCK_ERROR })
		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.WITHDRAW, expect.any(String))
		expect(reap_child).toHaveBeenCalledWith(ISSUE)
		expect(close_not_planned).not.toHaveBeenCalled()
		expect(close_lane).not.toHaveBeenCalled()
	})

	it('closes the lane and says to close the issue by hand when the close fails', async () => {
		close_not_planned.mockResolvedValue(false)
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toMatchObject({ kind: 'withdrawn', is_closed: false })
		expect(close_lane).toHaveBeenCalledWith(ISSUE)
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('by hand')
	})
})
