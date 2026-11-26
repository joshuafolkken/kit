import path from 'node:path'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_state } from '#scripts/lane/lane-state'
import { lane_transition_guards } from '#scripts/lane/lane-transition-guards'
import { run_board_single } from '#scripts/run/board/run-board-single'
import { run_hold } from '#scripts/run/hold/run-hold'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_halfrun_resume } from './run-halfrun-resume'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#2796: `fullrun #N` after a `halfrun` stop adopts the hold that stop marked, and adopts
// nothing else — a `halfrun` still running, a `backlogrun` child, another issue's hold, a clean tree and
// a free tree all fall through to the ordinary claim unchanged.

const scratch = make_directory('run-halfrun-resume-test-')
const TARGET = run_hold.hold_path(path.join(scratch, '.git'))
const ISSUE = '2796'
const OTHER_ISSUE = '2795'
const is_dirty = true
const MARKED_RECORD = { issue: ISSUE, is_fullrun: undefined, is_halfrun_stop: true }
const ADOPTED_RECORD = { issue: ISSUE, is_fullrun: true, is_halfrun_stop: undefined }
const RUNNING_RECORD = { issue: ISSUE, is_fullrun: undefined, is_halfrun_stop: undefined }
const OTHER_STOP = 'another issue stopped here'

afterEach(() => {
	run_hold.release_hold(TARGET)
	vi.restoreAllMocks()
})

afterAll(() => {
	run_hold.release_hold(TARGET)
})

function hold_record(): unknown {
	const read = run_hold.read_hold(TARGET)

	if (read.kind !== 'held') return read.kind

	const { issue, is_fullrun, is_halfrun_stop } = read.hold

	return { issue, is_fullrun, is_halfrun_stop }
}

describe('run_halfrun_resume.mark_stop_at — the halfrun stop marks its own record', () => {
	it.each([
		['its numbered hold', ISSUE],
		[
			'the unnumbered hold of a halfrun new, re-keyed to the filed issue',
			run_hold.UNNUMBERED_ISSUE,
		],
	])('marks %s', (_name, holder) => {
		run_hold.create_hold(TARGET, holder)

		expect(run_halfrun_resume.mark_stop_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(hold_record()).toStrictEqual(MARKED_RECORD)
	})

	it('marks a free tree, since the verified work is in it either way', () => {
		expect(run_halfrun_resume.mark_stop_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(hold_record()).toStrictEqual(MARKED_RECORD)
	})

	it("leaves another issue's hold alone", () => {
		run_hold.create_hold(TARGET, OTHER_ISSUE)

		expect(run_halfrun_resume.mark_stop_at(TARGET, ISSUE)).toBe(run_halfrun_resume.FOREIGN)
		expect(hold_record()).toStrictEqual({
			issue: OTHER_ISSUE,
			is_fullrun: undefined,
			is_halfrun_stop: undefined,
		})
	})
})

// joshuafolkken/kit#7710: the stop keeps when the stopped run began, which `run:board` draws its fixed
// time from; a stop already marked keeps its own.
function started_at(): string | undefined {
	return run_halfrun_resume.hold_of(run_hold.read_hold(TARGET))?.started_at
}

describe('run_halfrun_resume.mark_stop_at — the stop keeps the run’s start', () => {
	const STARTED = new Date('2026-11-17T01:00:00.000Z')

	it('keeps the claim’s moment as the start, through a second stop', () => {
		run_hold.create_hold(TARGET, ISSUE, { now: STARTED })

		run_halfrun_resume.mark_stop_at(TARGET, ISSUE)
		expect(started_at()).toBe(STARTED.toISOString())

		run_halfrun_resume.mark_stop_at(TARGET, ISSUE)
		expect(started_at()).toBe(STARTED.toISOString())
	})

	it('records no start over a free tree', () => {
		run_halfrun_resume.mark_stop_at(TARGET, ISSUE)

		expect(started_at()).toBeUndefined()
	})
})

// joshuafolkken/kit#7494: a fix round re-opens the stop as a running `halfrun` owned by the round, and
// its own stop marks it again; only #N's own stop is re-opened. The stop is drawn stopped (#7710).
function single_run(): string | undefined {
	const span = run_board_single.span_of(run_hold.read_hold(TARGET))

	if (span === undefined) return undefined

	return span.ended_ms === undefined ? span.invocation : `${span.invocation} stopped`
}

describe('run_halfrun_resume.reopen_at — a fix round runs on its stopped halfrun', () => {
	it('draws the round running on the board until its own stop, and the stop stopped', () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		expect(single_run()).toBe(`halfrun #${ISSUE} stopped`)

		expect(run_halfrun_resume.reopen_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(hold_record()).toStrictEqual(RUNNING_RECORD)
		expect(single_run()).toBe(`halfrun #${ISSUE}`)

		expect(run_halfrun_resume.mark_stop_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(single_run()).toBe(`halfrun #${ISSUE} stopped`)
	})

	it("names the round's own process on the tree:status hold line", () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		run_halfrun_resume.reopen_at(TARGET, ISSUE)

		const read = run_hold.read_hold(TARGET)
		const owner = run_hold.session_owner().owner_pid ?? process.pid

		expect(read.kind === 'held' && run_hold.held_message(read.hold)).toContain(
			`(pid ${String(owner)})`,
		)
	})

	it.each([
		['a running halfrun (no stop mark)', ISSUE, false],
		[OTHER_STOP, OTHER_ISSUE, true],
	])('leaves %s untouched', (_name, holder, is_marked) => {
		if (is_marked) run_hold.create_halfrun_stop_hold(TARGET, holder)
		else run_hold.create_hold(TARGET, holder)

		const before = hold_record()

		expect(run_halfrun_resume.reopen_at(TARGET, ISSUE)).toBe(run_halfrun_resume.FOREIGN)
		expect(hold_record()).toStrictEqual(before)
	})
})

// joshuafolkken/kit#8932: a round stopped before its `--halfrun-stop` leaves #N's unmarked record to go
// stale; the next round re-claims it, and the board draws that round running again.
const EXPIRED = new Date(Date.now() - run_hold.HOLD_MAX_AGE_MS * 2)

describe('run_halfrun_resume.reopen_at — an interrupted round is re-claimed', () => {
	it('re-opens its own stale unmarked record as running, drawn running', () => {
		run_hold.create_hold(TARGET, ISSUE, { now: EXPIRED })

		expect(run_halfrun_resume.round_hint(run_hold.read_hold(TARGET), ISSUE)).toContain(
			run_halfrun_resume.round_command(ISSUE),
		)
		expect(run_halfrun_resume.reopen_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(hold_record()).toStrictEqual(RUNNING_RECORD)
		expect(single_run()).toBe(`halfrun #${ISSUE}`)
	})

	it.each([
		['a live unmarked record of the issue', ISSUE, new Date()],
		["another issue's stale record", OTHER_ISSUE, EXPIRED],
	])('leaves %s untouched, with no hint', (_name, holder, now) => {
		run_hold.create_hold(TARGET, holder, { now })

		const before = hold_record()

		expect(run_halfrun_resume.round_hint(run_hold.read_hold(TARGET), ISSUE)).toBeUndefined()
		expect(run_halfrun_resume.reopen_at(TARGET, ISSUE)).toBe(run_halfrun_resume.FOREIGN)
		expect(hold_record()).toStrictEqual(before)
	})
})

// Adopts #ISSUE's marked stop over a human-review lane whose work-tree guard answers `note`.
async function adopt_review_lane(note: string | undefined): Promise<ReturnType<typeof vi.spyOn>> {
	run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(path.join(scratch, '.git'))
	vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
	vi.spyOn(lane_state, 'read_state').mockResolvedValue({
		issue: ISSUE,
		state: 'human-review',
		changed_at: '',
		changed_by: '',
	})
	vi.spyOn(lane_transition_guards, 'rejection').mockResolvedValue(note)
	vi.spyOn(console, 'warn').mockImplementation(vi.fn())
	const record = vi
		.spyOn(lane_state, 'record_change')
		.mockResolvedValue({ kind: 'skipped', reason: 'test' })

	expect(await run_halfrun_resume.adopt(ISSUE, 'fullrun')).toBe(true)

	return record
}

describe('run_halfrun_resume.adopt_at — a marked halfrun stop is adopted as this fullrun', () => {
	it('returns a human-review lane to running when its verified work is adopted', async () => {
		const record = await adopt_review_lane(undefined)

		expect(record).toHaveBeenCalledWith({ issue: ISSUE, state: 'running', command: 'run:entry' })
	})

	// joshuafolkken/kit#8829: the table's work-tree guard is asked before review-resume writes.
	it('leaves a human-review lane whose work tree is gone in human-review, with the reason', async () => {
		const record = await adopt_review_lane('its work tree is gone')

		expect(lane_transition_guards.rejection).toHaveBeenCalledWith('review-resume', ISSUE)
		expect(record).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledWith(
			`run:entry: lane ${session_cite.issue(ISSUE)} stays in human-review — its work tree is gone`,
		)
	})

	it('re-writes the marked hold over a dirty tree with the fullrun mark', () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty, run_hold.FULLRUN_MARK)).toBe(true)
		expect(hold_record()).toStrictEqual(ADOPTED_RECORD)
	})

	it('adopts an expired marked hold, since a person may verify the next day', () => {
		const expired = new Date(Date.now() - run_hold.HOLD_MAX_AGE_MS * 2)

		run_hold.create_halfrun_stop_hold(TARGET, ISSUE, expired)

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty, run_hold.FULLRUN_MARK)).toBe(true)
	})
})

// joshuafolkken/kit#7724: a `prrun` that picks the stop up is drawn as one, not as a `fullrun`.
describe('run_halfrun_resume.adopt — a prrun resume keeps its name', () => {
	it('re-writes the marked hold with the prrun mark, drawn as prrun', async () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(path.join(scratch, '.git'))
		vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
		vi.spyOn(lane_state, 'read_state').mockResolvedValue(undefined)

		expect(await run_halfrun_resume.adopt(ISSUE, 'prrun')).toBe(true)
		expect(hold_record()).toStrictEqual(ADOPTED_RECORD)
		expect(single_run()).toBe(`prrun #${ISSUE}`)
	})
})

describe('run_halfrun_resume.adopt_at — anything else is left to the ordinary claim', () => {
	it.each([
		['a halfrun or backlogrun child is still running (no stop mark)', ISSUE, false, is_dirty],
		[OTHER_STOP, OTHER_ISSUE, true, is_dirty],
		['the tree is clean', ISSUE, true, !is_dirty],
	])('does not adopt when %s', (_name, holder, is_marked, is_tree_dirty) => {
		if (is_marked) run_hold.create_halfrun_stop_hold(TARGET, holder)
		else run_hold.create_hold(TARGET, holder)

		const before = hold_record()

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_tree_dirty, run_hold.FULLRUN_MARK)).toBe(
			false,
		)
		expect(hold_record()).toStrictEqual(before)
	})

	it('answers no resume rather than throwing when the git directory cannot be read', async () => {
		vi.spyOn(run_hold, 'worktree_directory').mockRejectedValueOnce(new Error('no git'))

		await expect(run_halfrun_resume.is_pending(ISSUE)).resolves.toBe(false)
	})

	it('does not adopt a free tree, and writes no record', () => {
		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty, run_hold.FULLRUN_MARK)).toBe(false)
		expect(run_hold.read_hold(TARGET).kind).toBe('free')
	})
})
