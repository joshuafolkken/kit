import path from 'node:path'
import { lane_state } from '#scripts/lane/lane-state'
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

// joshuafolkken/kit#7494: a fix round re-opens the stop as a running `halfrun` owned by the round, and
// its own stop marks it again; only #N's own stop is re-opened.
function single_run(): string | undefined {
	return run_board_single.span_of(run_hold.read_hold(TARGET))?.invocation
}

describe('run_halfrun_resume.reopen_at — a fix round runs on its stopped halfrun', () => {
	it('draws the round on the board until its own stop, and draws no bare stop', () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		expect(single_run()).toBeUndefined()

		expect(run_halfrun_resume.reopen_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(hold_record()).toStrictEqual(RUNNING_RECORD)
		expect(single_run()).toBe(`halfrun #${ISSUE}`)

		expect(run_halfrun_resume.mark_stop_at(TARGET, ISSUE)).toBe(run_halfrun_resume.MARKED)
		expect(single_run()).toBeUndefined()
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

describe('run_halfrun_resume.adopt_at — a marked halfrun stop is adopted as this fullrun', () => {
	it('returns a human-review lane to running when its verified work is adopted', async () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(path.join(scratch, '.git'))
		vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
		vi.spyOn(lane_state, 'read_state').mockResolvedValue({
			issue: ISSUE,
			state: 'human-review',
			changed_at: '',
			changed_by: '',
		})
		const record = vi
			.spyOn(lane_state, 'record_change')
			.mockResolvedValue({ kind: 'skipped', reason: 'test' })

		expect(await run_halfrun_resume.adopt(ISSUE)).toBe(true)
		expect(record).toHaveBeenCalledWith({ issue: ISSUE, state: 'running', command: 'run:entry' })
	})

	it('re-writes the marked hold over a dirty tree with the fullrun mark', () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty)).toBe(true)
		expect(hold_record()).toStrictEqual(ADOPTED_RECORD)
	})

	it('adopts an expired marked hold, since a person may verify the next day', () => {
		const expired = new Date(Date.now() - run_hold.HOLD_MAX_AGE_MS * 2)

		run_hold.create_halfrun_stop_hold(TARGET, ISSUE, expired)

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty)).toBe(true)
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

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_tree_dirty)).toBe(false)
		expect(hold_record()).toStrictEqual(before)
	})

	it('answers no resume rather than throwing when the git directory cannot be read', async () => {
		vi.spyOn(run_hold, 'worktree_directory').mockRejectedValueOnce(new Error('no git'))

		await expect(run_halfrun_resume.is_pending(ISSUE)).resolves.toBe(false)
	})

	it('does not adopt a free tree, and writes no record', () => {
		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty)).toBe(false)
		expect(run_hold.read_hold(TARGET).kind).toBe('free')
	})
})
