import { poll } from '#scripts/lib/poll'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { poll_turns } from './poll-turns'

// An interval no test could wait out: a wait that honoured it would time the case out.
const HOUR_MS = 3_600_000
const PASSES = 3

afterEach(() => {
	vi.restoreAllMocks()
})

function counting_read(answer_at: number): { read: () => number | undefined; calls: () => number } {
	const state = { calls: 0 }

	function read(): number | undefined {
		state.calls += 1

		return state.calls >= answer_at ? state.calls : undefined
	}

	return { read, calls: () => state.calls }
}

describe('poll_turns.install', () => {
	it('answers a wait_for without spending its interval', async () => {
		poll_turns.install()
		const { read } = counting_read(PASSES)

		expect(await poll.wait_for(read, { interval_ms: HOUR_MS })).toBe(PASSES)
	})

	it('is taken back by restoreAllMocks', () => {
		const original = poll.wait_for

		poll_turns.install()
		expect(poll.wait_for).not.toBe(original)
		vi.restoreAllMocks()
		expect(poll.wait_for).toBe(original)
	})
})

describe('poll_turns.after_passes', () => {
	it('resolves only after the running loop waited the given number of times', async () => {
		poll_turns.install()
		const { read, calls } = counting_read(Infinity)
		const stop = { is_stopped: false }
		const looping = poll.wait_for(() => (stop.is_stopped ? 0 : read()), { interval_ms: HOUR_MS })

		await poll_turns.after_passes(PASSES)
		stop.is_stopped = true
		await looping

		expect(calls()).toBeGreaterThanOrEqual(PASSES)
	})
})
