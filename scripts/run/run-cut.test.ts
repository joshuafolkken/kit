import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { afterAll, describe, expect, it } from 'vitest'
import { run_cut, type CutResumeRequest, type RunCut } from './run-cut'
import type { Handoff } from './run-cut-handoff'

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
// The `classify_resume` verdict a successor's adoption leaves for a process woken after its own cut.
const HANDED_OFF = 'handed-off'
const CLAIMED_ERROR = 'the scratch record was claimed by something else'

// The handoff a resume into implementation requires (joshuafolkken/kit#2354).
const HANDOFF: Handoff = {
	instruction: 'Add the field; leave the migration alone.',
	completed: ['read the record'],
	remaining: ['wire the CLI'],
	untouched: ['the migration'],
}

function target(): string {
	return run_cut.cut_path(REPOSITORY)
}

// `begin_cut` answers `undefined` only when another process created the record first, which the
// `end_cut` here rules out in a scratch path of this suite's own. It throws rather than falling back,
// so no assertion runs against a record that is not on disk.
function begun(now: Date = START): RunCut {
	run_cut.end_cut(target())

	const cut = run_cut.begin_cut(
		target(),
		{ issue: ISSUE, branch: BRANCH, phase: run_cut.PRE_GATE_PHASE },
		now,
	)

	if (cut === undefined) throw new Error(CLAIMED_ERROR)

	return cut
}

// A declared implementation-phase cut, optionally carrying the handoff a resume into implementation
// requires (joshuafolkken/kit#2354).
function begun_impl(handoff?: Handoff): RunCut {
	run_cut.end_cut(target())

	const cut = run_cut.begin_cut(
		target(),
		{ issue: ISSUE, branch: BRANCH, phase: run_cut.IMPLEMENTATION_PHASE, handoff },
		START,
	)

	if (cut === undefined) throw new Error(CLAIMED_ERROR)

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

		expect(
			run_cut.begin_cut(
				target(),
				{ issue: ISSUE, branch: BRANCH, phase: run_cut.PRE_GATE_PHASE },
				START,
			),
		).toBeUndefined()
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

	// joshuafolkken/kit#1935: a record a successor already adopted — `is_handed_off` spent to `false` —
	// answers `handed-off`, so a process woken after its own cut is told to stop rather than sent to
	// investigate a tree that is not wrong.
	it('answers handed-off for a record a successor already adopted', () => {
		const adopted = { ...begun(), is_handed_off: false }

		expect(run_cut.classify_resume(adopted, resume_request())).toBe(HANDED_OFF)
	})

	it('refuses a record whose hand-off state is unknown', () => {
		const unknown: RunCut = { ...begun(), is_handed_off: undefined }

		expect(run_cut.classify_resume(unknown, resume_request())).toBe('stale')
	})
})

// joshuafolkken/kit#2354: the record carries the run's instruction and work state so a fresh process
// resumes on what it was told to do, and a resume into implementation is refused rather than run when
// the instruction is missing — the failure the issue exists to stop.
describe('the instruction a cut carries across the boundary', () => {
	it('carries the handoff through the write and read', () => {
		begun_impl(HANDOFF)
		const read = run_cut.read_cut(target(), START)

		expect(read.kind === 'carried' ? read.cut.handoff : undefined).toStrictEqual(HANDOFF)
	})

	it('resumes an implementation cut that carries an instruction', () => {
		expect(run_cut.classify_resume(begun_impl(HANDOFF), resume_request())).toBe('resume')
	})

	it('refuses an implementation cut with no instruction rather than continuing blind', () => {
		expect(run_cut.classify_resume(begun_impl(), resume_request())).toBe('incomplete')
	})

	it('resumes a pre-gate cut with no handoff, which resumes into the gate', () => {
		expect(run_cut.classify_resume(begun(), resume_request())).toBe('resume')
	})
})

// The backward-compatible legacy shape: a record written from the six scalar fields alone still
// parses and reads as carried, so the existing six fields keep their meaning (joshuafolkken/kit#2354).
describe('a legacy record without a handoff', () => {
	it('reads as carried, with no handoff', () => {
		const legacy = {
			invocation: INVOCATION,
			issue: ISSUE,
			branch: BRANCH,
			phase: run_cut.PRE_GATE_PHASE,
			cut_at: START.toISOString(),
			is_handed_off: true,
		}
		const read = run_cut.classify(JSON.stringify(legacy), START)

		expect(read.kind).toBe('carried')
		expect(read.kind === 'carried' ? read.cut.handoff : 'sentinel').toBeUndefined()
	})
})

// joshuafolkken/kit#2484: `run:merge` relaunches the successor of a cut nobody adopted — once, and only
// for a cut this issue declared that carries what its resume needs.
describe('the fallback relaunch run:merge takes', () => {
	it('relaunches a declared implementation cut carrying its instruction', () => {
		expect(run_cut.is_relaunchable(begun_impl(HANDOFF), ISSUE)).toBe(true)
	})

	it('does not relaunch a cut its resume would refuse incomplete', () => {
		expect(run_cut.is_relaunchable(begun_impl(), ISSUE)).toBe(false)
	})

	it('does not relaunch another issue’s cut or an adopted one', () => {
		expect(run_cut.is_relaunchable(begun(), OTHER_ISSUE)).toBe(false)
		expect(run_cut.is_relaunchable({ ...begun(), is_handed_off: false }, ISSUE)).toBe(false)
	})

	it('relaunches once — the mark it writes makes the record no longer relaunchable', () => {
		const cut = begun_impl(HANDOFF)

		expect(run_cut.mark_merge_relaunched(target(), cut)).toBe(true)

		const read = run_cut.read_cut(target(), WITHIN_BOUND)

		expect(read.kind === 'carried' && run_cut.is_relaunchable(read.cut, ISSUE)).toBe(false)
		expect(read.kind === 'carried' ? read.cut.handoff : undefined).toStrictEqual(HANDOFF)
	})
})

describe('the adoption that carries a cut', () => {
	it('spends the hand-off', () => {
		expect(run_cut.adopt_cut(target(), begun())).toMatchObject({ is_handed_off: false })
	})

	// The uniqueness guarantee: once the hand-off is spent, a second resume reads `is_handed_off: false`
	// and is answered `handed-off` (joshuafolkken/kit#1935) — a process woken after its own cut stops,
	// so two processes cannot resume the same cut.
	it('answers a second resume handed-off, so the woken cutter stops', () => {
		run_cut.adopt_cut(target(), begun())
		const read = run_cut.read_cut(target(), WITHIN_BOUND)
		const carried = read.kind === 'carried' ? read.cut : begun()

		expect(run_cut.classify_resume(carried, resume_request())).toBe(HANDED_OFF)
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

	// **The no-argument form is the only one the guard calls**, and every case above passes a directory
	// — so without this the default-argument wiring could regress and the suite would still pass. It
	// stays read-only, which is what keeps the hazard the injected directory removed from returning.
	it('derives the same answer with no directory as with this tree, explicitly', () => {
		const derived = run_cut.worktree_git_directory_sync() ?? REPOSITORY

		expect(run_cut.carried_cut_sync(WITHIN_BOUND)).toStrictEqual(
			run_cut.carried_cut_sync(WITHIN_BOUND, derived),
		)
	})
})

describe('the resume grouping — which phase resumes into implementation', () => {
	// The implementation cut resumes into more implementation; the pre-gate cut resumes into the gate.
	// The grouping is named once so `run-cut-cli.ts` cannot disagree with it. The retired setup phase
	// (joshuafolkken/kit#2489) no longer resumes into implementation.
	it('resumes implementation alone into implementation', () => {
		expect(run_cut.resumes_into_implementation(run_cut.IMPLEMENTATION_PHASE)).toBe(true)
		expect(run_cut.resumes_into_implementation(run_cut.PRE_GATE_PHASE)).toBe(false)
		expect(run_cut.resumes_into_implementation('setup')).toBe(false)
	})
})

describe('the hand-off record stays within its byte bound', () => {
	// Every field is a short scalar, so a well-formed record is far under the cap — the mechanical check
	// exists so a field that ever grew unbounded is refused at the write rather than silently carried.
	it('accepts a well-formed record', () => {
		const spec = { issue: ISSUE, branch: BRANCH, phase: run_cut.IMPLEMENTATION_PHASE }

		expect(run_cut.within_handoff_bound(run_cut.fresh_cut(spec, START))).toBe(true)
	})

	it('rejects a record whose field grew past the bound', () => {
		const bloated = {
			...run_cut.fresh_cut(
				{ issue: ISSUE, branch: BRANCH, phase: run_cut.IMPLEMENTATION_PHASE },
				START,
			),
			branch: 'x'.repeat(run_cut.MAX_HANDOFF_BYTES + 1),
		}

		expect(run_cut.within_handoff_bound(bloated)).toBe(false)
	})

	it('refuses to write an oversized record rather than carrying it', () => {
		run_cut.end_cut(target())

		const written = run_cut.begin_cut(
			target(),
			{
				issue: ISSUE,
				branch: 'y'.repeat(run_cut.MAX_HANDOFF_BYTES + 1),
				phase: run_cut.IMPLEMENTATION_PHASE,
			},
			START,
		)

		expect(written).toBeUndefined()
		expect(run_cut.read_cut(target(), START).kind).toBe('none')
	})
})

// joshuafolkken/kit#2354: a handoff that fits its own bound can still push the assembled record — with
// the scalar fields — past the cap. `record_within_bound` catches that on the full record, so the caller
// reports `bad-handoff` rather than falling through to `begin_cut`'s `busy`.
describe('record_within_bound checks the assembled record, not the handoff alone', () => {
	it('rejects a spec whose handoff fits alone but overflows the record with the scalars', () => {
		const empty: Handoff = { instruction: '', completed: [], remaining: [], untouched: [] }
		const wrapper_bytes = Buffer.byteLength(JSON.stringify(empty), 'utf8')
		// An instruction that fills the handoff to exactly the cap, so the handoff alone is within bound
		// but the record's scalar fields carry it over.
		const near_cap: Handoff = {
			...empty,
			instruction: 'x'.repeat(run_cut.MAX_HANDOFF_BYTES - wrapper_bytes),
		}
		const spec = {
			issue: ISSUE,
			branch: BRANCH,
			phase: run_cut.IMPLEMENTATION_PHASE,
			handoff: near_cap,
		}

		expect(Buffer.byteLength(JSON.stringify(near_cap), 'utf8')).toBe(run_cut.MAX_HANDOFF_BYTES)
		expect(run_cut.record_within_bound(spec, START)).toBe(false)
	})
})
