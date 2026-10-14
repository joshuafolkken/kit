import os from 'node:os'
import path from 'node:path'
import { git_stash } from '#scripts/git/stash/git-stash'
import { run_cut, type RunCut } from '#scripts/run/cut/run-cut'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_preserve } from './lane-preserve'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_restart } from './lane-restart'

// joshuafolkken/kit#3772: a person stops a running lane child and re-dispatches its issue in a fresh
// session. Every side effect is spied on — what is pinned is the order and what each step is handed.

const ISSUE = '3769'
const DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
const STASH = `${ISSUE}: uncommitted work at lane restart`
const PID = 4242
const CUT_TARGET = path.join(DIRECTORY, 'cut.json')
const LOCK_ERROR = 'index.lock exists'
const EMPTY_CUT: Partial<RunCut> = {}

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

const DISPATCHED = { kind: 'dispatched', pid: PID } as unknown as DispatchOutcome

const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const reap_child = vi.spyOn(lane_reap, 'reap_child')
const is_child_running = vi.spyOn(lane_reap, 'is_child_running')
const changes_probe = vi.spyOn(git_stash, 'has_changes')
const push_work = vi.spyOn(lane_preserve, 'push_work')
const announce = vi.spyOn(lane_preserve, 'announce')
const claim_marker = vi.spyOn(lane_dispatch, 'claim_marker')
const dispatch_child = vi.spyOn(lane_dispatch, 'dispatch_child')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const lane_cut_sync = vi.spyOn(run_cut, 'lane_cut_sync')
const end_cut = vi.spyOn(run_cut, 'end_cut')

vi.spyOn(lane_dispatch, 'describe').mockReturnValue('dispatch described')

function arrange_running_child(): void {
	find_open_lane.mockResolvedValue(LANE)
	is_child_running.mockReturnValue(true)
	claim_marker.mockResolvedValue({ is_applied: true })
	reap_child.mockReturnValue([PID])
}

function arrange_relaunch(): void {
	changes_probe.mockResolvedValue(false)
	push_work.mockResolvedValue(STASH)
	announce.mockResolvedValue()
	dispatch_child.mockResolvedValue(DISPATCHED)
	emit.mockResolvedValue()
	lane_cut_sync.mockReturnValue(undefined)
	end_cut.mockReturnValue()
}

beforeEach(() => {
	vi.clearAllMocks()
	arrange_running_child()
	arrange_relaunch()
})

describe('lane_restart.restart — stopping and re-dispatching', () => {
	it('stops the child, then dispatches the issue in a fresh session', async () => {
		const outcome = await lane_restart.restart(ISSUE)

		expect(reap_child).toHaveBeenCalledWith(ISSUE)
		expect(dispatch_child).toHaveBeenCalledWith(ISSUE, 'restart')
		expect(outcome).toStrictEqual({ kind: 'restarted', dispatch: DISPATCHED, stash: undefined })
	})

	it('claims the in-progress marker before the stop, so no GitHub call sits in the window', async () => {
		await lane_restart.restart(ISSUE)

		expect(claim_marker).toHaveBeenCalledWith(ISSUE)
		expect(claim_marker.mock.invocationCallOrder[0]).toBeLessThan(
			reap_child.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('records the restart on the event stream after the dispatch', async () => {
		await lane_restart.restart(ISSUE)

		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.RESTART,
			`#${ISSUE} restarted in a fresh session by a person`,
		)
		expect(dispatch_child.mock.invocationCallOrder[0]).toBeLessThan(
			emit.mock.invocationCallOrder[0] ?? 0,
		)
	})
})

describe('lane_restart.restart — the work in the tree', () => {
	it('stashes uncommitted work before the dispatch and comments on it only after', async () => {
		changes_probe.mockResolvedValue(true)
		const outcome = await lane_restart.restart(ISSUE)

		expect(push_work).toHaveBeenCalledWith(ISSUE, DIRECTORY, 'lane restart')
		expect(announce).toHaveBeenCalledWith(ISSUE, STASH, expect.any(String))
		expect(push_work.mock.invocationCallOrder[0]).toBeLessThan(
			dispatch_child.mock.invocationCallOrder[0] ?? 0,
		)
		expect(dispatch_child.mock.invocationCallOrder[0]).toBeLessThan(
			announce.mock.invocationCallOrder[0] ?? 0,
		)
		expect(outcome).toMatchObject({ kind: 'restarted', stash: STASH })
		expect(lane_restart.describe(outcome, ISSUE)).toContain(`pnpm josh stash:pop "${STASH}"`)
	})

	it('ends a cut the stopped child carried, so the fresh session does not adopt it', async () => {
		lane_cut_sync.mockReturnValue({ target: CUT_TARGET, cut: EMPTY_CUT as RunCut })
		await lane_restart.restart(ISSUE)

		expect(end_cut).toHaveBeenCalledWith(CUT_TARGET)
	})
})

describe('lane_restart.restart — refusals', () => {
	it('refuses when no lane is open, stopping nothing', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await lane_restart.restart(ISSUE)).toStrictEqual({ kind: 'no-lane' })
		expect(reap_child).not.toHaveBeenCalled()
	})

	it('refuses when no child is running, leaving an ended child to run:merge', async () => {
		is_child_running.mockReturnValue(false)
		const outcome = await lane_restart.restart(ISSUE)

		expect(outcome).toStrictEqual({ kind: 'not-running' })
		expect(claim_marker).not.toHaveBeenCalled()
		expect(dispatch_child).not.toHaveBeenCalled()
		expect(lane_restart.describe(outcome, ISSUE)).toContain('run:merge')
	})
})

describe('lane_restart.restart — what stops before or after the kill', () => {
	it('leaves the child running when the marker cannot be claimed', async () => {
		claim_marker.mockResolvedValue({ is_applied: false, reason: 'HTTP 502' })
		const outcome = await lane_restart.restart(ISSUE)

		expect(outcome).toStrictEqual({ kind: 'unclaimed', reason: 'HTTP 502' })
		expect(reap_child).not.toHaveBeenCalled()
		expect(lane_restart.describe(outcome, ISSUE)).toContain('nothing was stopped')
	})

	it('re-dispatches nothing when the work cannot be stashed', async () => {
		changes_probe.mockResolvedValue(true)
		push_work.mockRejectedValue(new Error(LOCK_ERROR))
		const outcome = await lane_restart.restart(ISSUE)

		expect(outcome).toMatchObject({ kind: 'unsaved', reason: LOCK_ERROR })
		expect(dispatch_child).not.toHaveBeenCalled()
	})

	it('records no restart when the fresh dispatch fails, and says run:merge collects', async () => {
		const failed = { kind: 'failed', note: 'boom' } as unknown as DispatchOutcome

		dispatch_child.mockResolvedValue(failed)
		const outcome = await lane_restart.restart(ISSUE)

		expect(emit).not.toHaveBeenCalled()
		expect(lane_restart.describe(outcome, ISSUE)).toContain('`run:merge` will collect')
	})
})
