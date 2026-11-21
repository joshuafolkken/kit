import { git_directory } from '#scripts/discovery/git-directory'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_hold, type HoldRead, type RunHold } from '#scripts/run/hold/run-hold'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_records } from './run-board-records'
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

const FREE: HoldRead = { kind: 'free' }
const LANE_GIT_DIRECTORY = '/repo/.git/worktrees/6597'

function held(hold: Partial<RunHold> = {}): HoldRead {
	return { kind: 'held', hold: { ...HOLD, ...hold } }
}

function lane_record(issue: string): LaneStateRecord {
	return { issue, state: 'running', changed_at: TAKEN_AT, changed_by: 'run:entry' }
}

// The root checkout's hold is read first and is free; the lane's, through its `.git` file, next.
function arrange_lane(
	record: LaneStateRecord,
	own: string | undefined,
	is_single_in_lane: boolean | undefined,
): void {
	arrange(NONE, undefined)
	vi.spyOn(run_board_records, 'read_records').mockReturnValue([record])
	vi.spyOn(git_directory, 'own_git_directory').mockReturnValue(own)
	vi.spyOn(run_hold, 'read_hold')
		.mockReturnValueOnce(FREE)
		.mockReturnValueOnce(held({ is_fullrun: true, is_single_in_lane }))
}

afterEach(() => vi.restoreAllMocks())

// joshuafolkken/kit#7525: the runs a merge released are read back for the run's ✅ done.
describe('run_board_single.ended_in', () => {
	const ENDED_AT = '2026-10-08T09:30:00.000Z'
	const ENDED_MS = Date.parse(ENDED_AT)
	const RECORD = { issue: String(ISSUE), taken_at: TAKEN_AT, ended_at: ENDED_AT }
	const SPAN = { invocation: 'backlogrun', started_ms: TAKEN_MS, ended_ms: undefined }

	it('reads a fullrun, a prrun and a halfrun that ended inside the run', () => {
		const records = [
			{ ...RECORD, is_fullrun: true },
			{ ...RECORD, is_fullrun: true, is_prrun: true },
			RECORD,
		]

		expect(run_board_single.ended_in(records, SPAN)).toStrictEqual([
			{ command: FULLRUN, issue: ISSUE, started_ms: TAKEN_MS, ended_ms: ENDED_MS },
			{ command: 'prrun', issue: ISSUE, started_ms: TAKEN_MS, ended_ms: ENDED_MS },
			{ command: 'halfrun', issue: ISSUE, started_ms: TAKEN_MS, ended_ms: ENDED_MS },
		])
	})

	it.each([
		['before the run began', { ...SPAN, started_ms: ENDED_MS + 1 }, RECORD],
		['after the run ended', { ...SPAN, ended_ms: ENDED_MS - 1 }, RECORD],
		['with no issue number', SPAN, { ...RECORD, issue: 'new' }],
		['with no moment', SPAN, { ...RECORD, ended_at: 'later' }],
	])('reads none that ended %s', (_, span, record) => {
		expect(run_board_single.ended_in([record], span)).toStrictEqual([])
	})
})

describe('run_board_single.span_of', () => {
	it.each([
		{ read: held({ is_fullrun: true }), invocation: `fullrun #${String(ISSUE)}` },
		{ read: held({ is_fullrun: true, is_prrun: true }), invocation: `prrun #${String(ISSUE)}` },
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
	])('draws no single run from a $kind hold that names no running issue', (read) => {
		expect(run_board_single.span_of(read)).toBeUndefined()
	})
})

// joshuafolkken/kit#7710: a stopped `halfrun` or `prrun` is drawn under its own command, its span from
// the run's start to its stop, so its time stands still.
describe('run_board_single.span_of — a stop', () => {
	const STARTED_AT = '2026-10-08T08:20:00.000Z'
	const STARTED_MS = Date.parse(STARTED_AT)

	it.each([
		{ mark: { is_halfrun_stop: true }, invocation: `halfrun #${String(ISSUE)}` },
		{ mark: { prrun_stop_head: 'abc' }, invocation: `prrun #${String(ISSUE)}` },
	])('draws $invocation from its start to its stop', ({ mark, invocation }) => {
		expect(run_board_single.span_of(held({ ...mark, started_at: STARTED_AT }))).toStrictEqual({
			invocation,
			started_ms: STARTED_MS,
			ended_ms: TAKEN_MS,
		})
	})

	it('draws a stop recorded with no start from its stop', () => {
		expect(run_board_single.span_of(held({ is_halfrun_stop: true }))).toStrictEqual({
			invocation: `halfrun #${String(ISSUE)}`,
			started_ms: TAKEN_MS,
			ended_ms: TAKEN_MS,
		})
	})

	it('reads the stopped run back with its times, and a running one as none', () => {
		const span = { invocation: 'prrun #12', started_ms: STARTED_MS, ended_ms: TAKEN_MS }

		expect(run_board_single.stopped_of(span)).toStrictEqual({
			command: 'prrun',
			issue: 12,
			started_ms: STARTED_MS,
			ended_ms: TAKEN_MS,
		})
		expect(run_board_single.stopped_of({ ...span, ended_ms: undefined })).toBeUndefined()
	})
})

describe('run_board_single — a stopped run read back', () => {
	it('reads a stopped root run beside a carried run back as stopped', () => {
		const span = { invocation: FULLRUN_12, started_ms: TAKEN_MS, ended_ms: TAKEN_MS }

		expect(run_board_single.root_of(span, [])?.stopped).toStrictEqual({
			command: FULLRUN,
			issue: 12,
			started_ms: TAKEN_MS,
			ended_ms: TAKEN_MS,
		})
	})

	it('reads the stopped run this checkout holds as its stopped single run', async () => {
		arrange(NONE, undefined)
		vi.spyOn(run_hold, 'read_hold').mockReturnValue(held({ is_halfrun_stop: true }))

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			stopped_single: { command: 'halfrun', issue: ISSUE, ended_ms: TAKEN_MS },
		})
	})
})

describe('run_board_single.scope_of / name_of', () => {
	it('covers a single run its own issue alone, under its own name', () => {
		expect(run_board_single.scope_of('halfrun #12')).toStrictEqual({ issues: [12], only: true })
		expect(run_board_single.name_of(FULLRUN_12)).toBe(FULLRUN)
	})

	// joshuafolkken/kit#7724: the `🏠` heading reads its name from here.
	it('names a running prrun prrun', () => {
		expect(run_board_single.scope_of('prrun #12')).toStrictEqual({ issues: [12], only: true })
		expect(run_board_single.name_of('prrun #12')).toBe('prrun')
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

// joshuafolkken/kit#7653: a single run that resumed a leftover lane holds the lane's tree, not this one.
describe('run_board_read.read_local for a single run in a lane', () => {
	it.each([
		{ is_single_in_lane: true, run_name: FULLRUN },
		{ is_single_in_lane: undefined, run_name: undefined },
	])(
		'reads a lane hold marked $is_single_in_lane as the run $run_name',
		async ({ is_single_in_lane, run_name }) => {
			arrange_lane(lane_record(String(ISSUE)), LANE_GIT_DIRECTORY, is_single_in_lane)

			const local = await run_board_read.read_local()

			expect(local?.run_name).toBe(run_name)
		},
	)

	it.each([
		{
			label: 'an ended lane',
			record: { ...lane_record(String(ISSUE)), state: 'ended' as const },
			own: LANE_GIT_DIRECTORY,
		},
		{ label: 'a lane with no .git file', record: lane_record(String(ISSUE)), own: undefined },
	])('reads no lane hold for $label', async ({ record, own }) => {
		arrange_lane(record, own, true)

		const local = await run_board_read.read_local()

		expect(local?.run_name).toBeUndefined()
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

	// joshuafolkken/kit#7524: the carried run stays the frame; the root checkout's run is read beside it.
	it('reads the fullrun a checkout outside a lane holds as the root run beside a carried run', async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(undefined)
		vi.spyOn(run_hold, 'read_hold').mockReturnValue(held({ is_fullrun: true }))

		const local = await run_board_read.read_local()

		expect(local?.run_name).toBeUndefined()
		expect(local?.carry).toStrictEqual(CARRY)
		expect(local?.root).toMatchObject({ command: FULLRUN, issue: ISSUE })
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
