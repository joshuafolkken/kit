import { lane_paths } from '#scripts/lane/lane-paths'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_hold, type HoldRead, type RunHold } from '#scripts/run/hold/run-hold'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_single } from './run-board-single'

// joshuafolkken/kit#6597: a single `fullrun` or `halfrun` is drawn from this checkout's hold record
// when no carry record is here; "no run" is left for a checkout with neither.

const { CARRY, INSIDE, arrange } = run_board_read_fixture
const TAKEN_AT = '2026-10-08T09:00:00.000Z'
const TAKEN_MS = Date.parse(TAKEN_AT)
const ISSUE = 6597
const NONE: CarryRead = { kind: 'none' }
const FULLRUN = 'fullrun'
const FULLRUN_12 = 'fullrun #12'
const CHILD_LAUNCH = 'child-launch'
const HOLD: RunHold = { issue: String(ISSUE), taken_at: TAKEN_AT, pid: 1 }

function held(hold: Partial<RunHold> = {}): HoldRead {
	return { kind: 'held', hold: { ...HOLD, ...hold } }
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_single.span_of', () => {
	it.each([
		{ read: held({ is_fullrun: true }), invocation: `fullrun #${String(ISSUE)}` },
		{ read: held(), invocation: `halfrun #${String(ISSUE)}` },
	])('draws $invocation from its hold from the hold on', ({ read, invocation }) => {
		expect(run_board_single.span_of(read)).toStrictEqual({
			invocation,
			started_ms: TAKEN_MS,
			ended_ms: undefined,
		})
	})

	it.each<HoldRead>([
		{ kind: 'free' },
		{ kind: 'unreadable' },
		{ kind: 'stale', hold: HOLD },
		held({ issue: 'new' }),
		held({ taken_at: 'not a date' }),
		held({ is_halfrun_stop: true }),
		held({ is_fullrun: true, prrun_stop_head: 'abc' }),
	])('draws no single run from a $kind hold that names no running issue', (read) => {
		expect(run_board_single.span_of(read)).toBeUndefined()
	})
})

describe('run_board_single.scope_of / name_of', () => {
	it('covers a single run its own issue alone, under its own name', () => {
		expect(run_board_single.scope_of('halfrun #12')).toStrictEqual({ issues: [12], only: true })
		expect(run_board_single.name_of(FULLRUN_12)).toBe(FULLRUN)
	})

	it('names nothing for a backlogrun', () => {
		expect(run_board_single.scope_of('backlogrun #12 --only')).toBeUndefined()
		expect(run_board_single.name_of('backlogrun')).toBeUndefined()
	})
})

describe('run_board_single.events_of', () => {
	const span = { invocation: FULLRUN_12, started_ms: TAKEN_MS, ended_ms: undefined }

	it("opens a single run's events with its issue's launch at the hold", () => {
		const [launch, ...rest] = run_board_single.events_of(span, [INSIDE])

		expect(launch).toStrictEqual({
			pos: 0,
			at: TAKEN_AT,
			kind: CHILD_LAUNCH,
			text: '#12 fullrun',
		})
		expect(rest).toStrictEqual([INSIDE])
	})

	it("leaves a backlogrun's events as read", () => {
		const events: ReadonlyArray<RunEvent> = [INSIDE]

		expect(run_board_single.events_of({ ...span, invocation: 'backlogrun' }, events)).toBe(events)
	})
})

describe('run_board_read.read_local for a single run', () => {
	it.each([
		{ read: held({ is_fullrun: true }), run_name: FULLRUN },
		{ read: held(), run_name: 'halfrun' },
	])('reads the $run_name this checkout holds with no carry record', async ({ read, run_name }) => {
		arrange(NONE, undefined)
		vi.spyOn(run_hold, 'read_hold').mockReturnValue(read)

		const local = await run_board_read.read_local()

		expect(local).toMatchObject({ run_name, started_ms: TAKEN_MS, ended_ms: undefined })
		expect(local?.scope).toStrictEqual({ issues: [ISSUE], only: true })
		expect(local?.events[0]).toMatchObject({
			kind: CHILD_LAUNCH,
			text: `#${String(ISSUE)} ${run_name}`,
		})
	})

	it('reads no run with neither a hold nor a carry record', async () => {
		arrange(NONE, undefined)

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})
})

describe('run_board_read.read_local beside a carried run', () => {
	it("reads a lane's carried run, not the lane child's hold", async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(String(ISSUE))
		const read_hold = vi.spyOn(run_hold, 'read_hold').mockReturnValue(held({ is_fullrun: true }))

		const local = await run_board_read.read_local()

		expect(local?.run_name).toBeUndefined()
		expect(read_hold).not.toHaveBeenCalled()
		expect(run_carry.read_carry).toHaveBeenCalled()
	})

	it('reads the fullrun a checkout outside a lane holds beside a carried run', async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(undefined)
		vi.spyOn(run_hold, 'read_hold').mockReturnValue(held({ is_fullrun: true }))

		await expect(run_board_read.read_local()).resolves.toMatchObject({ run_name: FULLRUN })
	})

	it('asks git again on the next read after a failed resolve', async () => {
		const failure = 'git timed out'

		arrange(NONE, undefined)
		// A checkout no earlier read resolved, so the memo holds nothing for it yet.
		vi.spyOn(process, 'cwd').mockReturnValue('/unresolved-checkout')
		const resolve = vi.mocked(run_hold.worktree_directory).mockRejectedValueOnce(new Error(failure))

		await expect(run_board_read.read_local()).rejects.toThrow(failure)
		await expect(run_board_read.read_local()).resolves.toBeUndefined()
		expect(resolve).toHaveBeenCalledTimes(2)
	})
})
