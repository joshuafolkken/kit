import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { run_halfrun_resume } from './run-halfrun-resume'
import { run_hold } from './run-hold'

// joshuafolkken/kit#2796: `fullrun #N` after a `halfrun` stop adopts the hold that stop marked, and adopts
// nothing else — a `halfrun` still running, a `backlogrun` child, another issue's hold, a clean tree and
// a free tree all fall through to the ordinary claim unchanged.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-halfrun-resume-test-'))
const TARGET = run_hold.hold_path(path.join(scratch, '.git'))
const ISSUE = '2796'
const OTHER_ISSUE = '2795'
const is_dirty = true
const MARKED_RECORD = { issue: ISSUE, is_fullrun: undefined, is_halfrun_stop: true }
const ADOPTED_RECORD = { issue: ISSUE, is_fullrun: true, is_halfrun_stop: undefined }

afterEach(() => {
	run_hold.release_hold(TARGET)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
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

describe('run_halfrun_resume.adopt_at — a marked halfrun stop is adopted as this fullrun', () => {
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
		['another issue stopped here', OTHER_ISSUE, true, is_dirty],
		['the tree is clean', ISSUE, true, !is_dirty],
	])('does not adopt when %s', (_name, holder, is_marked, is_tree_dirty) => {
		if (is_marked) run_hold.create_halfrun_stop_hold(TARGET, holder)
		else run_hold.create_hold(TARGET, holder)

		const before = hold_record()

		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_tree_dirty)).toBe(false)
		expect(hold_record()).toStrictEqual(before)
	})

	it('does not adopt a free tree, and writes no record', () => {
		expect(run_halfrun_resume.adopt_at(TARGET, ISSUE, is_dirty)).toBe(false)
		expect(run_hold.read_hold(TARGET).kind).toBe('free')
	})
})
