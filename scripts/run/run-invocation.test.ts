import { describe, expect, it } from 'vitest'
import { run_invocation } from './run-invocation'

// joshuafolkken/kit#1774: the grammar moved out of `run-wake-session.ts` so that `run-carry.ts` could
// read it too, and it grew a second command word at the same time. What is pinned here is the pair of
// properties the move must not lose — the `backlogrun` shapes answer exactly as they did, and the
// round-trip identity that `run:wake` refuses a wake on still holds for both commands.
//
// **The round trip is the load-bearing one.** The woken session hands its prompt straight back to
// `run:carry --begin`, where the invocation is compared character for character, so a rebuild that
// rewrote the string at all would launch a session that declines to claim the record and takes ten
// minutes to say so.

const BARE_BACKLOG = 'backlogrun'
const BARE_QUEUE = 'queue'
const BACKLOG = `${BARE_BACKLOG} --max 5 --idle 30`
const QUEUE = `${BARE_QUEUE} #1762 #1749 #1759`
const REFUSES = 'refuses %s'
const QUALIFIED = 'queue kit#1749'

describe('a backlogrun invocation', () => {
	it('rebuilds its budget flags to the text they were given', () => {
		expect(run_invocation.rebuild(BACKLOG)).toBe(BACKLOG)
	})

	it('rebuilds a bare keyword, which declares the default budget', () => {
		expect(run_invocation.rebuild(BARE_BACKLOG)).toBe(BARE_BACKLOG)
	})

	// Dropping one would wake a session running to a budget the person did not declare.
	it('refuses an unknown flag rather than dropping it', () => {
		expect(run_invocation.rebuild('backlogrun --depth 2')).toBeUndefined()
	})

	// **Normalizing is this module's job; refusing is `run-wake-session.ts`'s.** The rebuild composes
	// from constants and validated integers, so `05` comes back as `5` — and the round-trip check at
	// the wake then refuses the record, because the woken session would hand a prompt the record does
	// not match straight back to `run:carry --begin`.
	it('normalizes a value rather than carrying the text it was written with', () => {
		expect(run_invocation.rebuild('backlogrun --max 05')).toBe('backlogrun --max 5')
	})

	it('has no issue list to report', () => {
		expect(run_invocation.issue_numbers(BACKLOG)).toBeUndefined()
	})
})

describe('a queue invocation', () => {
	it('rebuilds its issue list to the text it was given', () => {
		expect(run_invocation.rebuild(QUEUE)).toBe(QUEUE)
	})

	it('reports the issues in the order they were declared', () => {
		expect(run_invocation.issue_numbers(QUEUE)).toStrictEqual([1762, 1749, 1759])
	})

	// The prefix is what tells an issue reference from a flag value, and a bare number would rebuild
	// as `#<n>` — a string the record never held, which the round-trip check would then refuse anyway.
	it('refuses a reference with no prefix', () => {
		expect(run_invocation.rebuild('queue 1749')).toBeUndefined()
	})

	// `run-issue-number.ts` refuses `0` and a leading zero outright, so — unlike a flag value — a
	// malformed issue reference never reaches the normalization above and is refused here.
	it.each(['queue #0', 'queue #05', 'queue #17a9', 'queue #'])(REFUSES, (invocation) => {
		expect(run_invocation.rebuild(invocation)).toBeUndefined()
	})

	// A queue with no issue is not an invocation a person can have typed, and waking a session on one
	// would launch an agent with a prompt that names nothing to do.
	it('refuses an empty issue list', () => {
		expect(run_invocation.rebuild(BARE_QUEUE)).toBeUndefined()
		expect(run_invocation.issue_numbers(BARE_QUEUE)).toBeUndefined()
	})

	// The repository prefix is `SKILL.md` → §2c's, and this grammar does not carry it: the record's
	// `done` holds numbers. `queue.md` → "The session boundary" is why such a queue begins no record at
	// all, rather than beginning one the supervisor then refuses at the cut.
	it('refuses a repository-qualified reference', () => {
		expect(run_invocation.rebuild(QUALIFIED)).toBeUndefined()
		expect(run_invocation.issue_numbers(QUALIFIED)).toBeUndefined()
	})

	// The digit pattern bounds nothing, so a number past the safe range would rebuild as a *different*
	// number through precision loss — and the record would then carry a `done` entry that never matches
	// anything in `remaining`.
	it('refuses a number past the safe integer range rather than rewriting it', () => {
		expect(run_invocation.rebuild('queue #99999999999999999999')).toBeUndefined()
	})
})

describe('an invocation that is neither', () => {
	it.each(['epicrun #1761', 'fullrun #1774', '', '  '])(REFUSES, (invocation) => {
		expect(run_invocation.rebuild(invocation)).toBeUndefined()
	})
})
