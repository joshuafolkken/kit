import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry } from './run-carry'

// joshuafolkken/kit#1714: the record exists so a `backlogrun` keeps one budget across its own session
// cuts. What these tests pin is the part a rewrite would lose first — that a resumed session reads
// the *same* `started_at` back, that the counters accumulate rather than reset, and that the 8-hour
// whole-run bound is spent even though the session that started it is gone.

const TEST_PREFIX = 'run-carry-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const REPOSITORY = path.join(scratch, 'repository.git')
const OTHER_REPOSITORY = path.join(scratch, 'other.git')

const INVOCATION = 'backlogrun --max 5 --idle 30'
const START = new Date('2026-09-10T00:00:00.000Z')
const WITHIN_BOUND = new Date('2026-09-10T07:59:00.000Z')
const PAST_BOUND = new Date('2026-09-10T08:00:01.000Z')

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

afterAll(() => {
	rmSync(run_carry.carry_path(REPOSITORY), { force: true })
	rmSync(run_carry.carry_path(OTHER_REPOSITORY), { force: true })
	rmSync(scratch, { force: true, recursive: true })
})

describe('a repository with no run in flight', () => {
	it('reads as none', () => {
		run_carry.end_carry(target())

		expect(run_carry.read_carry(target(), START).kind).toBe('none')
	})

	it('keys separately from another repository', () => {
		expect(run_carry.carry_path(REPOSITORY)).not.toBe(run_carry.carry_path(OTHER_REPOSITORY))
	})
})

describe('a record written by one session and read by the next', () => {
	it('carries the invocation and the start time across the cut', () => {
		run_carry.end_carry(target())
		run_carry.begin_carry(target(), INVOCATION, START)

		expect(run_carry.read_carry(target(), WITHIN_BOUND)).toStrictEqual({
			kind: 'carried',
			carry: {
				invocation: INVOCATION,
				started_at: START.toISOString(),
				merged: 0,
				filed: 0,
				cuts: 0,
			},
		})
	})

	it('accumulates the counters instead of resetting them', () => {
		run_carry.end_carry(target())
		const started = run_carry.begin_carry(target(), INVOCATION, START)

		run_carry.apply_change(target(), started, { merged: 1, filed: 1 })
		const read = run_carry.read_carry(target(), WITHIN_BOUND)
		const carried = read.kind === 'carried' ? read.carry : started

		expect(run_carry.apply_change(target(), carried, { merged: 2, cuts: 1 })).toMatchObject({
			merged: 3,
			filed: 1,
			cuts: 1,
		})
	})
})

describe('the whole-run bound', () => {
	it('is spent once the record is older than eight hours', () => {
		run_carry.end_carry(target())
		run_carry.begin_carry(target(), INVOCATION, START)

		expect(run_carry.read_carry(target(), PAST_BOUND).kind).toBe('expired')
	})

	it('treats a start time that is not a date as spent rather than as current', () => {
		const undated = {
			invocation: INVOCATION,
			started_at: 'not-a-date',
			merged: 0,
			filed: 0,
			cuts: 0,
		}

		expect(run_carry.is_expired(undated, START)).toBe(true)
	})
})

describe('a record that cannot be parsed', () => {
	it('is unreadable, never none', () => {
		expect(run_carry.classify('{"invocation":1}', START).kind).toBe('unreadable')
		expect(run_carry.classify('not json', START).kind).toBe('unreadable')
	})

	it('is none only when nothing is there', () => {
		expect(run_carry.classify(undefined, START).kind).toBe('none')
	})
})
