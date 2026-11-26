import { poll, type WaitOptions } from '#scripts/lib/poll'
import { vi } from 'vitest'

// **A `poll.wait_for` whose waits cost one event-loop turn rather than their cadence**, for a suite
// whose subject polls on a wall-clock interval it does not assert (joshuafolkken/kit#9016). The waits
// are counted, so a test waits out whole passes of the loop rather than guessing a sleep long enough.

const passes = { count: 0 }
const { wait_for } = poll

async function next_turn(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve))
}

async function counted_turn(): Promise<void> {
	passes.count += 1
	await next_turn()
}

async function turn_wait_for<T>(
	read: () => Promise<T | undefined> | T | undefined,
	options: WaitOptions,
): Promise<T> {
	return await wait_for(read, { ...options, sleeper: counted_turn })
}

/** Spy `poll.wait_for` for the current test; `vi.restoreAllMocks` takes it back. */
function install(): void {
	vi.spyOn(poll, 'wait_for').mockImplementation(turn_wait_for)
}

/** Resolve once `count` more waits have passed, across every loop the spy runs. */
async function after_passes(count: number): Promise<void> {
	const target = passes.count + count

	await poll.poll_until(() => passes.count >= target, {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: next_turn,
	})
}

const poll_turns = { after_passes, install }

export { poll_turns }
