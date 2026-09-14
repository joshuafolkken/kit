import { describe, expect, it } from 'vitest'
import { run_invocation } from './run-invocation'

// joshuafolkken/kit#1774: the grammar moved out of `run-wake-session.ts` so that `run-carry.ts` could
// read it too. joshuafolkken/kit#1984 then folded the old `queue` keyword into `backlogrun`, so the
// one command now carries a named-issue list, a budget, or both. What is pinned here is the pair of
// properties that must not be lost — the `backlogrun` shapes answer exactly as they did, the named
// list reads back in order, and the round-trip identity that `run:wake` refuses a wake on still holds.
//
// **The round trip is the load-bearing one.** The woken session hands its prompt straight back to
// `run:carry --begin`, where the invocation is compared character for character, so a rebuild that
// rewrote the string at all would launch a session that declines to claim the record and takes ten
// minutes to say so.

const BARE_BACKLOG = 'backlogrun'
const BUDGET = `${BARE_BACKLOG} --max 5 --idle 30`
const NAMED = `${BARE_BACKLOG} #1762 #1749 #1759`
const NAMED_WITH_BUDGET = `${BARE_BACKLOG} #1762 #1749 --max 5`
const QUALIFIED = `${BARE_BACKLOG} kit#1749`
const NAMED_ONLY = `${BARE_BACKLOG} #1762 #1749 --only`
const ONLY_WITH_BUDGET = `${BARE_BACKLOG} #1762 --only --max 5`
const REFUSES = 'refuses %s'

describe('a backlogrun invocation with only a budget', () => {
	it('rebuilds its budget flags to the text they were given', () => {
		expect(run_invocation.rebuild(BUDGET)).toBe(BUDGET)
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

	it('has no named list to report', () => {
		expect(run_invocation.issue_numbers(BUDGET)).toBeUndefined()
		expect(run_invocation.issue_numbers(BARE_BACKLOG)).toBeUndefined()
	})
})

describe('a backlogrun invocation with a named issue list', () => {
	it('rebuilds its named list to the text it was given', () => {
		expect(run_invocation.rebuild(NAMED)).toBe(NAMED)
	})

	it('reports the named issues in the order they were declared', () => {
		expect(run_invocation.issue_numbers(NAMED)).toStrictEqual([1762, 1749, 1759])
	})

	// The named block leads and the budget follows it — the one canonical order, so a resumed session
	// hands back exactly what the record holds.
	it('carries a named list and a budget together, named first', () => {
		expect(run_invocation.rebuild(NAMED_WITH_BUDGET)).toBe(NAMED_WITH_BUDGET)
		expect(run_invocation.issue_numbers(NAMED_WITH_BUDGET)).toStrictEqual([1762, 1749])
	})

	// The prefix is what tells an issue reference from a flag value, and a bare number would rebuild
	// as `#<n>` — a string the record never held, which the round-trip check would then refuse anyway.
	it('refuses a reference with no prefix', () => {
		expect(run_invocation.rebuild('backlogrun 1749')).toBeUndefined()
	})

	// A `#N` after the flags is refused: the named list is the leading block, never interleaved with
	// the budget, so a stray reference there matches no known flag and fails.
	it('refuses a named reference placed after the budget flags', () => {
		expect(run_invocation.rebuild('backlogrun --max 5 #1749')).toBeUndefined()
	})

	// `run-issue-number.ts` refuses `0` and a leading zero outright, so — unlike a flag value — a
	// malformed issue reference never reaches the normalization above and is refused here.
	it.each(['backlogrun #0', 'backlogrun #05', 'backlogrun #17a9', 'backlogrun #'])(
		REFUSES,
		(invocation) => {
			expect(run_invocation.rebuild(invocation)).toBeUndefined()
		},
	)

	// The repository prefix is `SKILL.md` → §2c's, and this grammar does not carry it: the record's
	// `done` holds numbers. `backlogrun.md` → "The session cut is inside the invocation" is why such a
	// run begins no carry record at all, rather than beginning one the supervisor then refuses.
	it('refuses a repository-qualified reference', () => {
		expect(run_invocation.rebuild(QUALIFIED)).toBeUndefined()
		expect(run_invocation.issue_numbers(QUALIFIED)).toBeUndefined()
	})

	// The digit pattern bounds nothing, so a number past the safe range would rebuild as a *different*
	// number through precision loss — and the record would then carry a `done` entry that never matches
	// anything in `remaining`.
	it('refuses a number past the safe integer range rather than rewriting it', () => {
		expect(run_invocation.rebuild('backlogrun #99999999999999999999')).toBeUndefined()
	})
})

// joshuafolkken/kit#1984: `--only` runs the named list and stops rather than draining the pool. It is
// a valueless flag, so it must survive the cut without swallowing the token after it, and a resumed
// session must be able to read it back — else it would silently start draining the backlog.
describe('a backlogrun invocation with --only', () => {
	it('rebuilds --only after the named list', () => {
		expect(run_invocation.rebuild(NAMED_ONLY)).toBe(NAMED_ONLY)
	})

	// The order typed is the order carried, so a resumed session hands back exactly the recorded text.
	it('carries --only alongside a budget in the order it was typed', () => {
		expect(run_invocation.rebuild(ONLY_WITH_BUDGET)).toBe(ONLY_WITH_BUDGET)
	})

	it('leaves the named list unchanged by --only', () => {
		expect(run_invocation.issue_numbers(NAMED_ONLY)).toStrictEqual([1762, 1749])
	})

	it('answers whether the invocation carries --only', () => {
		expect(run_invocation.has_only(NAMED_ONLY)).toBe(true)
		expect(run_invocation.has_only(NAMED)).toBe(false)
		expect(run_invocation.has_only(BARE_BACKLOG)).toBe(false)
	})

	// A stray `--only` on another keyword carries nothing — the grammar is `backlogrun`'s alone.
	it('carries no --only for an invocation that is not a backlogrun', () => {
		expect(run_invocation.has_only('epicrun #1 --only')).toBe(false)
	})
})

describe('an invocation that is neither', () => {
	// `queue` was removed by joshuafolkken/kit#1984, so it is now just an unknown command word.
	it.each(['queue #1749', 'epicrun #1761', 'fullrun #1774', '', '  '])(REFUSES, (invocation) => {
		expect(run_invocation.rebuild(invocation)).toBeUndefined()
	})
})
