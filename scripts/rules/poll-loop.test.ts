import { read_unwrapped } from '#scripts/document/ai-document-fixture'
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
// The counted wait a lane child armed over a backgrounded reviewer (joshuafolkken/kit#4800).
const SEQ_SLEEP = 'for i in $(seq 1 30); do sleep 10; done'

describe('poll_loop.is_poll_loop — refuses the output-file wait loop', () => {
	it.each([
		GREP_POLL,
		WC_POLL,
		'while ! grep -q done out.txt; do sleep 5; done',
		'until test -s out.txt; do sleep 2m; done',
		// A configurable interval is still a poll — the argument is a variable, not a literal
		// (joshuafolkken/kit#2371, review round 1).
		'until grep -q done out.txt; do sleep "$INTERVAL"; done',
		// joshuafolkken/kit#2421: the two loops lane children hung on for hours. The first is a busy-wait
		// with no `sleep` at all; the second polls a backgrounded task's output file.
		'until [ -f /tmp/gate-done ]; do if ! kill -0 %1 2>/dev/null; then break; fi; done',
		"while ! grep -qE 'ELIFECYCLE|Done in|push|fatal|error' /tmp/tasks/b1.output; do sleep 2; done",
		// The same busy-wait spelled as a `while` over a process or file probe.
		'while kill -0 4242 2>/dev/null; do :; done',
		'while [ ! -f /tmp/gate-done ]; do :; done',
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
		// A `while` that counts rather than probes is ordinary work, not a wait (joshuafolkken/kit#2421).
		'i=0; while [ "$i" -lt 5 ]; do build; i=$((i+1)); done',
		// The word in an argument is not a loop header — only a command position is (review round 1).
		'git log --since=1.week --until yesterday',
		'gh run list --until today',
		'echo until done',
		'cat until.txt',
		'gh issue comment 1 --body "until grep -q done out.txt; do sleep 30; done"',
	])('is silent on %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(false)
	})
})

// joshuafolkken/kit#4800: a counted `for` that sleeps waits on the clock with nothing to work through,
// with or without a probe in its body; a `for` over a real list is ordinary work, sleep or not.
describe('poll_loop.is_poll_loop — a counted for loop that sleeps', () => {
	it.each([
		SEQ_SLEEP,
		'for i in $(seq 1 55); do s=$(stat -f %z out.txt); echo "size=$s"; sleep 10; done',
		'for i in {1..30}; do sleep 10; done',
		'for ((i = 0; i < 30; i++)); do sleep 10; done',
	])('refuses the counted wait %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(true)
	})

	it.each([
		'for i in $(seq 1 5); do build; done',
		'for f in *.ts; do pnpm josh lint "$f"; done',
		'for f in a.txt b.txt; do cat "$f"; sleep 1; done',
		'pnpm josh issue:comment 1 --body "for i in $(seq 1 30); do sleep 10; done"',
		// A `sleep` outside the counted loop's body is not its wait (review round 1).
		'sleep 5; for i in $(seq 1 3); do echo "$i"; done',
		'for i in $(seq 1 3); do echo "$i"; done; sleep 5',
		'formula in {1..3} x; sleep 2',
	])('passes the list loop %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(false)
	})
})

// joshuafolkken/kit#5115: a sleep chain before a read of a task's output or a process is the poll
// unrolled; a short settle wait and a read with no sleep are ordinary work.
const TAIL_CHAIN = 'sleep 20; sleep 20; sleep 20; tail -c 1500 /tmp/tasks/x.output'
const PS_CHAIN = 'sleep 20; ps -p 123 -o etime='

describe('poll_loop.is_poll_loop — a sleep chain before a read', () => {
	it.each([
		TAIL_CHAIN,
		PS_CHAIN,
		'sleep 20; ps -p 123 >/dev/null && echo running || cat /tmp/tasks/x.output',
		'sleep 30 && tail -5 /tmp/tasks/x.output 2>&1 | grep -c done',
		'sleep 1m; stat -f %z /tmp/tasks/x.output',
	])('refuses the unrolled poll %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(true)
	})

	it.each([
		'sleep 3; tail -5 /tmp/x.log',
		'tail -c 1500 /tmp/tasks/x.output',
		'sleep 20; pnpm josh ship:wait 5115',
		'sleep 20; tail -5 /tmp/x.log; pnpm build',
		// The sleep after the read is not a wait for it (review round 1).
		'tail -5 /tmp/x.log; sleep 20',
		'gh issue comment 1 --body "sleep 20; tail -c 1500 x.output"',
	])('passes the settle wait or plain read %j', (command) => {
		expect(poll_loop.is_poll_loop(command)).toBe(false)
	})
})

// **Disjoint from `early-heartbeat` by construction, asserted rather than assumed.** That rule stands
// down on any loop keyword and refuses only an all-sleep call, and this one fires only on a loop or
// on a sleep chain with a read after it — so no refused shape here is a wait
// timer, and a bare `sleep` this rule leaves alone is exactly what that rule takes.
describe('poll_loop and early_heartbeat claim disjoint commands', () => {
	it.each([GREP_POLL, WC_POLL, SEQ_SLEEP, TAIL_CHAIN, PS_CHAIN])(
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
		'its exit re-invokes you',
		'counted `for`',
		'a `sleep` chain before a read',
		'pnpm josh run:liveness',
		'a background `Agent` is waited on by its completion notification',
		'background-commands.md',
		'Fires on every occurrence',
	])('carries %j', (marker) => {
		expect(poll_loop.POLL_LOOP_REASON).toContain(marker)
	})

	// The topic file the refusal points at states that the task's completion notification, not a
	// regex over the output, is what ends the wait.
	it('points at a topic file that names the completion notification as the end of the wait', () => {
		const topic = read_unwrapped('.claude/skills/workflow-commands/background-commands.md')

		expect(topic).toContain('that completion notification is what ends the wait')
	})
})
