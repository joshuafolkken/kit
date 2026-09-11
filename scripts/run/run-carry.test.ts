import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry, type CarryClaimRequest, type CarryOwner, type RunCarry } from './run-carry'

// joshuafolkken/kit#1714: the record exists so a `backlogrun` keeps one budget across its own session
// cuts. What these tests pin is the part a rewrite would lose first — that a resumed session reads
// the *same* `started_at` back, that the counters accumulate rather than reset, and that the 8-hour
// whole-run bound is spent even though the session that started it is gone.
//
// joshuafolkken/kit#1722 adds the ownership half. The three cases it separates are the three a
// string comparison could not: the owner still running, the owner gone, and the *same* invocation
// text typed again over a record no cut handed off.

const { DEAD_PID, has_start_probe } = process_identity_fixture

const TEST_PREFIX = 'run-carry-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const REPOSITORY = path.join(scratch, 'repository.git')
const OTHER_REPOSITORY = path.join(scratch, 'other.git')

const INVOCATION = 'backlogrun --max 5 --idle 30'
const OTHER_INVOCATION = 'backlogrun --max 10'
// The opening list, pinned: it is what the record holds across every cut of this queue.
const QUEUE_INVOCATION = 'queue #1762 #1749 #1759'
const START = new Date('2026-09-10T00:00:00.000Z')
const WITHIN_BOUND = new Date('2026-09-10T07:59:00.000Z')
const PAST_BOUND = new Date('2026-09-10T08:00:01.000Z')

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// `begin_carry` answers `undefined` only when another process created the record first, which the
// `end_carry` here rules out in a scratch path of this suite's own. It throws rather than falling
// back to an unwritten record: a fallback would let every assertion after it run against something
// that is not on disk, and pass.
function begun(owner: CarryOwner = run_carry.NO_OWNER, now: Date = START): RunCarry {
	run_carry.end_carry(target())

	const carry = run_carry.begin_carry(target(), INVOCATION, owner, now)

	if (carry === undefined) throw new Error('the scratch record was claimed by something else')

	return carry
}

function claim_of(
	invocation: string,
	owner: CarryOwner = run_carry.NO_OWNER,
	is_adoption = false,
): CarryClaimRequest {
	return { invocation, owner, is_adoption }
}

function live_owner(): CarryOwner {
	return run_carry.owner_of(process.pid)
}

// A pid that cannot exist, so the record reads as an owner that is gone without racing the operating
// system over a pid it might reissue.
function dead_owner(): CarryOwner {
	return run_carry.owner_of(DEAD_PID)
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
		run_carry.begin_carry(target(), INVOCATION, run_carry.NO_OWNER, START)

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
		const started = begun()

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
		begun()

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

describe('the record is claimed exclusively', () => {
	it('refuses a second begin over a record that is already there', () => {
		begun()

		expect(run_carry.begin_carry(target(), INVOCATION, run_carry.NO_OWNER, START)).toBeUndefined()
	})

	// `replace_carry` never consults the bound — deciding that a record may be replaced is the
	// caller's — so what this pins is that replacing succeeds where a bare `begin_carry` would not.
	it('replaces whatever record is there', () => {
		begun()

		const replaced = run_carry.replace_carry(target(), OTHER_INVOCATION, run_carry.NO_OWNER, START)

		expect(replaced).toEqual(expect.objectContaining({ invocation: OTHER_INVOCATION }))
	})
})

// The case joshuafolkken/kit#1722 was filed for: the owner is still running, so the budget is being
// spent right now and no second parent may count into it — whatever either command line says.
describe('an owner that is still running', () => {
	it.skipIf(!has_start_probe)('refuses another process asking for the same invocation', () => {
		const carry = begun(live_owner())
		const request = claim_of(INVOCATION, dead_owner())

		expect(run_carry.classify_claim(carry, request)).toBe('busy')
	})

	it.skipIf(!has_start_probe)('refuses on liveness rather than on the invocation text', () => {
		const carry = begun(live_owner())
		const request = claim_of(OTHER_INVOCATION, dead_owner())

		expect(run_carry.classify_claim(carry, request)).toBe('busy')
	})

	it.skipIf(!has_start_probe)('refuses an adoption too', () => {
		const carry = begun(live_owner())
		const request = claim_of(INVOCATION, dead_owner(), true)

		expect(run_carry.classify_claim(carry, request)).toBe('busy')
	})

	// The hand-off is read *after* liveness, or a second parent naming the same invocation would take
	// over a record whose owner is still running — the string comparison, surviving on one path.
	it.skipIf(!has_start_probe)('refuses even a record its own cut handed off', () => {
		const cut = run_carry.apply_change(target(), begun(live_owner()), { cuts: 1 })
		const request = claim_of(INVOCATION, dead_owner())

		expect(run_carry.classify_claim(cut, request)).toBe('busy')
	})

	// The same record, asked for by the process that owns it: a session cut that kept its process —
	// a compaction — is still the run that declared the cut, and still resumes.
	it.skipIf(!has_start_probe)('carries a handed-off record for its own owner', () => {
		const owner = live_owner()
		const cut = run_carry.apply_change(target(), begun(owner), { cuts: 1 })

		expect(run_carry.classify_claim(cut, claim_of(INVOCATION, owner))).toBe('resume')
	})
})

describe('an owner that is gone', () => {
	it('reads as standing rather than as live', () => {
		const carry = begun(dead_owner())

		expect(run_carry.is_owner_live(carry)).toBe(false)
	})

	it('is not carried by retyping the same invocation text', () => {
		const carry = begun(dead_owner())

		expect(run_carry.classify_claim(carry, claim_of(INVOCATION))).toBe('standing')
	})

	it('is carried once an adoption says so', () => {
		const carry = begun(dead_owner())
		const request = claim_of(INVOCATION, run_carry.NO_OWNER, true)

		expect(run_carry.classify_claim(carry, request)).toBe('resume')
	})

	it('names a different invocation as a mismatch', () => {
		const carry = begun(dead_owner())

		expect(run_carry.classify_claim(carry, claim_of(OTHER_INVOCATION))).toBe('mismatch')
	})
})

// The same session retyping its own command is the shape the string comparison read as `resumed`.
describe('the same invocation typed again', () => {
	it.skipIf(!has_start_probe)('is standing even for the record’s own owner', () => {
		const owner = live_owner()
		const carry = begun(owner)

		expect(run_carry.classify_claim(carry, claim_of(INVOCATION, owner))).toBe('standing')
	})
})

describe('a cut declares the hand-off', () => {
	it('carries the budget with nobody deciding', () => {
		const cut = run_carry.apply_change(target(), begun(), { cuts: 1 })

		expect(cut.is_handed_off).toBe(true)
		expect(run_carry.classify_claim(cut, claim_of(INVOCATION))).toBe('resume')
	})

	it('is spent by the next count, so it carries one cut and not every later one', () => {
		const cut = run_carry.apply_change(target(), begun(), { cuts: 1 })
		const later = run_carry.apply_change(target(), cut, { merged: 1 })

		expect(later.is_handed_off).toBe(false)
		expect(run_carry.classify_claim(later, claim_of(INVOCATION))).toBe('standing')
	})

	it('is spent by the adoption that carries it', () => {
		const cut = run_carry.apply_change(target(), begun(), { cuts: 1 })

		// `undefined` is the exclusive create losing to another process, which cannot happen against a
		// scratch path this suite owns — so it is asserted rather than narrowed away.
		expect(run_carry.adopt_carry(target(), cut, dead_owner())).toStrictEqual({
			invocation: cut.invocation,
			started_at: cut.started_at,
			merged: cut.merged,
			filed: cut.filed,
			cuts: cut.cuts,
			done: undefined,
			owner_pid: DEAD_PID,
			owner_start: undefined,
			is_handed_off: false,
		})
	})
})

// joshuafolkken/kit#1774: a `queue`'s invocation is pinned to the list that was typed, so the
// comparison `classify_claim` makes is untouched and what shrinks is this field instead. These pin the
// two properties a resumed queue rests on — the finished issues survive the hand-off, and what is left
// is derived from the record rather than from an arithmetic the successor does in its head.
function queued(): RunCarry {
	run_carry.end_carry(target())

	const carry = run_carry.begin_carry(target(), QUEUE_INVOCATION, run_carry.NO_OWNER, START)

	if (carry === undefined) throw new Error('the scratch record was not created')

	return carry
}

describe('the issues a queue has finished', () => {
	it('accumulates in the order they were recorded', () => {
		const first = run_carry.apply_change(target(), queued(), { done: 1762 })

		expect(run_carry.apply_change(target(), first, { done: 1749 }).done).toStrictEqual([1762, 1749])
	})

	// A `--done` reissued after a retry must not list an issue twice, or `remaining` would be short by
	// something already taken out of it.
	it('records the same issue only once', () => {
		const first = run_carry.apply_change(target(), queued(), { done: 1762 })

		expect(run_carry.apply_change(target(), first, { done: 1762 }).done).toStrictEqual([1762])
	})

	it('leaves what is left in the order the invocation declared it', () => {
		const carry = run_carry.apply_change(target(), queued(), { done: 1749 })

		expect(run_carry.remaining_of(carry)).toStrictEqual([1762, 1759])
	})

	// The whole point of the resumption: the successor does not re-run what the cut session finished.
	it('survives the hand-off and the adoption that carries it', () => {
		const started = run_carry.apply_change(target(), queued(), { done: 1762 })
		const cut = run_carry.apply_change(target(), started, { cuts: 1 })

		expect(run_carry.adopt_carry(target(), cut, dead_owner())?.done).toStrictEqual([1762])
	})

	// "This invocation has no issue list" and "this queue has no issues left" are different facts.
	it('is not reported for an invocation that declared none', () => {
		expect(run_carry.remaining_of(begun())).toBeUndefined()
	})

	it('is named in the description a refusal message carries', () => {
		const carry = run_carry.apply_change(target(), queued(), { done: 1762 })

		expect(run_carry.describe_carry(carry)).toContain('issues 1762 done')
	})
})
