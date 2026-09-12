import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { afterAll, describe, expect, it } from 'vitest'
import { run_cut, type CutResumeRequest, type RunCut } from './run-cut'

// joshuafolkken/kit#1839: the record exists so a lane child can end its process before the gate and a
// fresh one resume from it. What these tests pin is what a rewrite would lose first — that only a
// declared cut on a matching tree resumes, that a wrong branch, a clean tree or a tree no longer
// under its hold is caught as a resume failure rather than run, and the hand-off is spent by the
// adoption so a
// second resume cannot take the same cut.

const TEST_PREFIX = 'run-cut-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const REPOSITORY = path.join(scratch, 'repository.git')
const OTHER_REPOSITORY = path.join(scratch, 'other.git')

const ISSUE = '1839'
const OTHER_ISSUE = '1840'
const BRANCH = '1839-lane'
const INVOCATION = 'fullrun #1839'
const START = new Date('2026-09-12T00:00:00.000Z')
const WITHIN_BOUND = new Date('2026-09-12T07:59:00.000Z')
const PAST_BOUND = new Date('2026-09-12T08:00:01.000Z')

function target(): string {
	return run_cut.cut_path(REPOSITORY)
}

// `begin_cut` answers `undefined` only when another process created the record first, which the
// `end_cut` here rules out in a scratch path of this suite's own. It throws rather than falling back,
// so no assertion runs against a record that is not on disk.
function begun(now: Date = START): RunCut {
	run_cut.end_cut(target())

	const cut = run_cut.begin_cut(target(), { issue: ISSUE, branch: BRANCH }, now)

	if (cut === undefined) throw new Error('the scratch record was claimed by something else')

	return cut
}

function resume_request(overrides: Partial<CutResumeRequest> = {}): CutResumeRequest {
	return { issue: ISSUE, current_branch: BRANCH, is_dirty: true, is_held: true, ...overrides }
}

afterAll(() => {
	rmSync(run_cut.cut_path(REPOSITORY), { force: true })
	rmSync(run_cut.cut_path(OTHER_REPOSITORY), { force: true })
	rmSync(scratch, { force: true, recursive: true })
})

describe('a working tree with no cut in flight', () => {
	it('reads as none', () => {
		run_cut.end_cut(target())

		expect(run_cut.read_cut(target(), START).kind).toBe('none')
	})

	it('keys separately from another working tree', () => {
		expect(run_cut.cut_path(REPOSITORY)).not.toBe(run_cut.cut_path(OTHER_REPOSITORY))
	})
})

describe('a cut written by one process and read by the next', () => {
	it('carries the invocation, issue, branch and hand-off across the boundary', () => {
		begun()

		expect(run_cut.read_cut(target(), WITHIN_BOUND)).toStrictEqual({
			kind: 'carried',
			cut: {
				invocation: INVOCATION,
				issue: ISSUE,
				branch: BRANCH,
				phase: run_cut.PRE_GATE_PHASE,
				cut_at: START.toISOString(),
				is_handed_off: true,
			},
		})
	})

	it('builds the invocation the fresh process runs from the issue', () => {
		expect(run_cut.invocation_for(ISSUE)).toBe(INVOCATION)
	})
})

describe('the whole-run bound', () => {
	it('is spent once the record is older than the bound', () => {
		begun()

		expect(run_cut.read_cut(target(), PAST_BOUND).kind).toBe('expired')
	})

	it('treats a cut time that is not a date as spent rather than as current', () => {
		const undated = { ...begun(), cut_at: 'not-a-date' }

		expect(run_cut.is_expired(undated, START)).toBe(true)
	})
})

describe('a record that cannot be parsed', () => {
	it('is unreadable, never none', () => {
		expect(run_cut.classify('{"issue":1}', START).kind).toBe('unreadable')
		expect(run_cut.classify('not json', START).kind).toBe('unreadable')
	})

	it('is none only when nothing is there', () => {
		expect(run_cut.classify(undefined, START).kind).toBe('none')
	})
})

describe('a cut is claimed exclusively', () => {
	it('refuses a second cut over a record already there', () => {
		begun()

		expect(run_cut.begin_cut(target(), { issue: ISSUE, branch: BRANCH }, START)).toBeUndefined()
	})
})

describe('a fresh process deciding whether to resume', () => {
	it('resumes a declared cut whose tree matches', () => {
		expect(run_cut.classify_resume(begun(), resume_request())).toBe('resume')
	})

	it('refuses a clean tree, because the implementation is gone', () => {
		expect(run_cut.classify_resume(begun(), resume_request({ is_dirty: false }))).toBe('stale')
	})

	it('refuses a tree no longer under its hold', () => {
		expect(run_cut.classify_resume(begun(), resume_request({ is_held: false }))).toBe('stale')
	})

	it('refuses a branch the cut did not record', () => {
		expect(run_cut.classify_resume(begun(), resume_request({ current_branch: 'main' }))).toBe(
			'stale',
		)
	})

	it('refuses a different issue', () => {
		expect(run_cut.classify_resume(begun(), resume_request({ issue: OTHER_ISSUE }))).toBe('stale')
	})

	it('refuses a record no cut handed off', () => {
		const crashed = { ...begun(), is_handed_off: false }

		expect(run_cut.classify_resume(crashed, resume_request())).toBe('stale')
	})
})

describe('the adoption that carries a cut', () => {
	it('spends the hand-off', () => {
		expect(run_cut.adopt_cut(target(), begun())).toMatchObject({ is_handed_off: false })
	})

	// The uniqueness guarantee: once the hand-off is spent, a second resume reads `is_handed_off:
	// false` and is refused, so two processes cannot resume the same cut.
	it('leaves a spent cut that no second resume can take', () => {
		run_cut.adopt_cut(target(), begun())
		const read = run_cut.read_cut(target(), WITHIN_BOUND)
		const carried = read.kind === 'carried' ? read.cut : begun()

		expect(run_cut.classify_resume(carried, resume_request())).toBe('stale')
	})
})

// joshuafolkken/kit#1864: the pre-gate cut is enforced from a `PreToolUse` guard, and a guard answers
// synchronously or not at all. What is pinned here is that the synchronous path reaches the **same**
// record the asynchronous one does — a reader keyed to a different tree would answer "no cut" on the
// resumed process and refuse a run that had already obeyed.
describe('the synchronous read the pre-gate guard makes', () => {
	// **Read against the fixture repository, never this checkout's own record.** Keyed to the work
	// tree, that record is what tells the guard a resumed lane child has already cut — and the unit
	// suite runs inside `pnpm josh gate`, the very call the guard stands in front of. A case that
	// wrote there would erase it mid-run and cost the lane a spurious relaunch on the next gate.
	it('names the same git directory the asynchronous reader names', async () => {
		const [asynchronous] = await git_command.git_directories()

		expect(run_cut.worktree_git_directory_sync()).toBe(asynchronous)
	})

	it('reads no cut while the tree has no record', () => {
		rmSync(target(), { force: true })

		expect(run_cut.carried_cut_sync(WITHIN_BOUND, REPOSITORY)).toBeUndefined()
	})

	it('reads back a record written for that tree', () => {
		const record = JSON.stringify({ ...begun(), is_handed_off: false })

		writeFileSync(target(), record)

		expect(run_cut.carried_cut_sync(WITHIN_BOUND, REPOSITORY)).toMatchObject({ issue: ISSUE })
	})

	// An expired record is the crashed process the bound exists for, and it reads as no cut rather
	// than as one — so the guard speaks again instead of staying silent forever.
	it('reads an expired record as no cut', () => {
		writeFileSync(target(), JSON.stringify(begun()))

		expect(run_cut.carried_cut_sync(PAST_BOUND, REPOSITORY)).toBeUndefined()
	})
})
