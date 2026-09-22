import { describe, expect, it } from 'vitest'
import { early_heartbeat } from './early-heartbeat'
import { poll_loop } from './poll-loop'

// joshuafolkken/kit#2371: the hand-written wait loop a lane child improvises over a backgrounded
// command's output. The refused set is the two shapes the Issue measured; the silent set is the
// ordinary work — a stream reader, a bare clock timer `early-heartbeat` owns, a plain command, and a
// loop quoted inside an Issue body — that a poll loop must never be confused with.

// The two shapes the Issue's reproduce block measured, named once because each is both a refused
// spelling and a marker the tests below reuse.
const GREP_POLL = 'until grep -qiE "merged|error|fail|done" out.txt; do sleep 30; done'
const WC_POLL = 'until [ "$(wc -l < out.txt)" -ge 40 ]; do sleep 30; done'
// A bare clock timer — `early-heartbeat`'s territory, never this rule's — named once so the
// disjointness assertion reads it the same both times.
const BARE_SLEEP = 'sleep 1200'

describe('poll_loop.is_poll_loop — refuses the output-file wait loop', () => {
	it.each([
		GREP_POLL,
		WC_POLL,
		'while ! grep -q done out.txt; do sleep 5; done',
		'until test -s out.txt; do sleep 2m; done',
		// A configurable interval is still a poll — the argument is a variable, not a literal
		// (joshuafolkken/kit#2371, review round 1).
		'until grep -q done out.txt; do sleep "$INTERVAL"; done',
	])('refuses %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(true)
	})

	it.each([
		'grep -q done out.txt',
		'while read line; do echo "$line"; done < out.txt',
		// A throttled stream reader sleeps but consumes input rather than probing — not a poll
		// (joshuafolkken/kit#2371, review round 1).
		'while read line; do sleep 0.1; echo "$line"; done < out.txt',
		// The bare word "until" inside a command body does not turn a stream reader into a poll — the
		// exclusion holds unless an `until` *header* is present (joshuafolkken/kit#2371, review round 2).
		'while read line; do grep until out.txt; sleep 1; done < in.txt',
		'sleep 30',
		'for i in $(seq 1 5); do build; done',
		'cat until.txt',
		'gh issue comment 1 --body "until grep -q done out.txt; do sleep 30; done"',
	])('is silent on %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(false)
	})
})

// **Disjoint from `early-heartbeat` by construction, asserted rather than assumed.** That rule stands
// down on any loop keyword, and this one fires only on a loop — so neither reproduce shape is a wait
// timer, and a bare `sleep` this rule leaves alone is exactly what that rule takes.
describe('poll_loop and early_heartbeat claim disjoint commands', () => {
	it.each([GREP_POLL, WC_POLL])(
		'a poll loop is not an early-heartbeat wait timer: %j',
		(command) => {
			expect(early_heartbeat.is_wait_timer(command)).toBe(false)
		},
	)

	it('a bare sleep is a wait timer, not a poll loop', () => {
		expect(poll_loop.is_poll_loop(BARE_SLEEP)).toBe(false)
		expect(early_heartbeat.is_wait_timer(BARE_SLEEP)).toBe(true)
	})
})

describe('poll_loop.POLL_LOOP_REASON', () => {
	it.each([
		'output poll loop',
		'run_in_background',
		'completion notification',
		'background-commands.md',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(poll_loop.POLL_LOOP_REASON).toContain(marker)
	})
})
