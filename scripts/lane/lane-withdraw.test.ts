import os from 'node:os'
import path from 'node:path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
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
import { lane_state } from './lane-state'
import { lane_withdraw } from './lane-withdraw'

// joshuafolkken/kit#3908: a person withdraws a running lane child's issue from the run. Every side effect
// is spied on — what is pinned is the order, and that a refusal writes nothing. joshuafolkken/kit#4365:
// the Issue stays open.

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

const CLOSED_LANE: CloseOutcome = {
	issue: ISSUE,
	kind: 'closed',
	left_behind: [],
	reaped: [],
	residents: [],
}

function state_read(state: string): StateRead {
	return { kind: 'state', state: { state, labels: [], is_human_review: false } }
}

const read_issue = vi.spyOn(issue_state_cli, 'read_issue')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const reap_child = vi.spyOn(lane_reap, 'reap_child')
const changes_probe = vi.spyOn(git_stash, 'has_changes')
const push = vi.spyOn(git_stash, 'push')
const try_comment = vi.spyOn(git_gh_issue_write, 'issue_try_comment')
// The REST transport every issue write goes through, so a close of any reason is caught.
const gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const announce = vi.spyOn(lane_preserve, 'announce')
const unmark = vi.spyOn(run_label, 'unmark')
const close_lane = vi.spyOn(lane_close, 'close_lane')
const record_change = vi.spyOn(lane_state, 'record_change')

function first_call(spy: { mock: { invocationCallOrder: Array<number> } }): number {
	return spy.mock.invocationCallOrder[0] ?? 0
}

function expect_nothing_written(): void {
	expect(emit).not.toHaveBeenCalled()
	expect(reap_child).not.toHaveBeenCalled()
	expect(try_comment).not.toHaveBeenCalled()
	expect(close_lane).not.toHaveBeenCalled()
	expect(record_change).not.toHaveBeenCalled()
}

function arrange_open_lane(): void {
	read_issue.mockResolvedValue(state_read('OPEN'))
	find_open_lane.mockResolvedValue(LANE)
	emit.mockResolvedValue()
	reap_child.mockReturnValue([PID])
	changes_probe.mockResolvedValue(false)
}

function arrange_writes(): void {
	push.mockResolvedValue()
	try_comment.mockResolvedValue(true)
	gh_api.mockResolvedValue('')
	announce.mockResolvedValue()
	unmark.mockResolvedValue(true)
	close_lane.mockResolvedValue(CLOSED_LANE)
	record_change.mockResolvedValue({ kind: 'skipped', reason: 'test' })
}

beforeEach(() => {
	vi.clearAllMocks()
	arrange_open_lane()
	arrange_writes()
})

describe('lane_withdraw.withdraw — the order of the steps', () => {
	it('records the event, stops the child, keeps the work, comments, then closes the lane', async () => {
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)
		const order = [emit, reap_child, changes_probe, try_comment, unmark, close_lane].map((spy) =>
			first_call(spy),
		)

		expect(order).toStrictEqual(order.toSorted((left, right) => left - right))
		expect(outcome).toStrictEqual({
			kind: 'withdrawn',
			reaped: 1,
			stash: undefined,
			is_noted: true,
			lane: 'closed',
			residents: [],
		})
	})

	it('names the issue and the reason on the event stream and in the issue comment', async () => {
		await lane_withdraw.withdraw(ISSUE, REASON)

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.WITHDRAW,
			`#${ISSUE} withdrawn by a person: ${REASON}`,
		)
		expect(try_comment).toHaveBeenCalledWith(ISSUE, expect.stringContaining(`- Why: ${REASON}`))
	})
})

// joshuafolkken/kit#4365: the withdrawal ends this run's attempt, not the work.
describe('lane_withdraw.withdraw — the issue stays open', () => {
	it('never closes the issue and reads its state only once', async () => {
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toMatchObject({ kind: 'withdrawn' })
		expect(gh_api).not.toHaveBeenCalled()
		expect(read_issue).toHaveBeenCalledOnce()
	})

	it('says on the issue and in the report that the next run offers it again', async () => {
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(try_comment).toHaveBeenCalledWith(ISSUE, expect.stringContaining('stays open'))
		expect(try_comment).toHaveBeenCalledWith(ISSUE, expect.stringContaining('next run'))
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('The Issue stays open')
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

		expect(outcome).toMatchObject({ kind: 'withdrawn', reaped: 0, is_noted: true })
		expect(close_lane).toHaveBeenCalledWith(ISSUE)
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('already ended')
	})
})

// joshuafolkken/kit#4304: a withdrawal closes the lane, so it says what the close ended from the checkout.
describe('lane_withdraw.withdraw — processes still running from the checkout', () => {
	it('names the processes the close ended', async () => {
		close_lane.mockResolvedValue({ ...CLOSED_LANE, residents: [PID] })
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(lane_withdraw.describe(outcome, ISSUE)).toContain(
			`Terminated 1 process(es) still running from the lane`,
		)
	})

	it('says a reading that failed rather than reading it as none', async () => {
		close_lane.mockResolvedValue({ ...CLOSED_LANE, residents: undefined })
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('lsof or ps failed')
	})
})

// joshuafolkken/kit#4268: the state record names the withdrawal, not the close it ran.
describe('lane_withdraw.withdraw — the lane state record', () => {
	it('records the lane as ended by lane:withdraw after the close', async () => {
		await lane_withdraw.withdraw(ISSUE, REASON)

		expect(record_change).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			state: 'ended',
			command: 'lane:withdraw',
		})
		expect(first_call(record_change)).toBeGreaterThan(first_call(close_lane))
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
	it('leaves the lane in place and writes nothing on the issue when the work cannot be stashed', async () => {
		changes_probe.mockResolvedValue(true)
		push.mockRejectedValue(new Error(LOCK_ERROR))
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toStrictEqual({ kind: 'unsaved', directory: DIRECTORY, reason: LOCK_ERROR })
		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.WITHDRAW, expect.any(String))
		expect(reap_child).toHaveBeenCalledWith(LANE)
		expect(try_comment).not.toHaveBeenCalled()
		expect(close_lane).not.toHaveBeenCalled()
	})

	it('still closes the lane and says so when the comment cannot be posted', async () => {
		try_comment.mockResolvedValue(false)
		const outcome = await lane_withdraw.withdraw(ISSUE, REASON)

		expect(outcome).toMatchObject({ kind: 'withdrawn', is_noted: false })
		expect(close_lane).toHaveBeenCalledWith(ISSUE)
		expect(lane_withdraw.describe(outcome, ISSUE)).toContain('could not be posted')
	})
})
