import { describe, expect, it } from 'vitest'
import { lane_await, type AwaitState, type CheckConfig } from './lane-await'

// joshuafolkken/kit#2113. The re-confirm guard is the invariant being tested: a process that
// briefly disappears (the pre-gate boundary handoff) must not be declared done, while one that
// stays gone past the window must be.

const ISSUE = '2113'
const OTHER = '2114'
const { RECONFIRM_MS, NEVER_APPEARED_TIMEOUT_MS } = lane_await
const SHORT_RECONFIRM_MS = 10
const POLL_MS = 1
const NOW = 1_000_000

function make_state(overrides: Partial<AwaitState> = {}): AwaitState {
	return { appeared: false, disappeared_at: undefined, first_polled_at: undefined, ...overrides }
}

// Helper: builds a minimal CheckConfig for tests that do not exercise the never-appeared timeout.
function config(is_running: () => boolean): CheckConfig {
	return {
		is_running,
		reconfirm_ms: RECONFIRM_MS,
		never_appeared_timeout_ms: Number.MAX_SAFE_INTEGER,
	}
}

describe('check_issue -- running / disappearance states', () => {
	it('returns undefined while the process is running', () => {
		const state = make_state({ appeared: true })

		expect(
			lane_await.check_issue(
				ISSUE,
				state,
				NOW,
				config(() => true),
			),
		).toBeUndefined()
	})

	it('clears disappeared_at when the process reappears', () => {
		const state = make_state({ appeared: true, disappeared_at: NOW - 1000 })

		lane_await.check_issue(
			ISSUE,
			state,
			NOW,
			config(() => true),
		)

		expect(state.disappeared_at).toBeUndefined()
	})
})

describe('check_issue -- not yet appeared', () => {
	it('returns undefined when process not yet seen (appeared = false)', () => {
		const state = make_state({ appeared: false })

		expect(
			lane_await.check_issue(
				ISSUE,
				state,
				NOW,
				config(() => false),
			),
		).toBeUndefined()
	})

	it('records first_polled_at on first call with appeared = false', () => {
		const state = make_state({ appeared: false })

		lane_await.check_issue(
			ISSUE,
			state,
			NOW,
			config(() => false),
		)

		expect(state.first_polled_at).toBe(NOW)
	})

	it('throws when process never appeared past the timeout', () => {
		const state = make_state({ appeared: false, first_polled_at: NOW - SHORT_RECONFIRM_MS })

		expect(() =>
			lane_await.check_issue(ISSUE, state, NOW, {
				is_running: () => false,
				reconfirm_ms: RECONFIRM_MS,
				never_appeared_timeout_ms: SHORT_RECONFIRM_MS,
			}),
		).toThrow('never appeared')
	})
})

describe('check_issue -- re-confirm guard', () => {
	it('records first disappearance but does not confirm yet', () => {
		const state = make_state({ appeared: true })

		const result = lane_await.check_issue(
			ISSUE,
			state,
			NOW,
			config(() => false),
		)

		expect(result).toBeUndefined()
		expect(state.disappeared_at).toBe(NOW)
	})

	it('does not confirm before the re-confirm window', () => {
		const state = make_state({ appeared: true, disappeared_at: NOW - RECONFIRM_MS + 1 })

		expect(
			lane_await.check_issue(
				ISSUE,
				state,
				NOW,
				config(() => false),
			),
		).toBeUndefined()
	})

	it('confirms completion after the re-confirm window', () => {
		const state = make_state({ appeared: true, disappeared_at: NOW - RECONFIRM_MS })

		expect(
			lane_await.check_issue(
				ISSUE,
				state,
				NOW,
				config(() => false),
			),
		).toBe(ISSUE)
	})
})

describe('wait_for_any -- exits when a child confirms-complete', () => {
	it('returns the issue that confirmed-completed', async () => {
		let calls = 0

		const is_running = (): boolean => {
			calls += 1

			return calls === 1
		}

		const result = await lane_await.wait_for_any([ISSUE], {
			is_running,
			poll_ms: POLL_MS,
			reconfirm_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
	})
})

// The check_issue unit tests pin the re-confirm invariant at the logical level; this
// integration test ensures wait_for_any routes through that logic correctly on a handoff.
describe('wait_for_any -- pre-gate boundary does not trigger early return', () => {
	it('does not return during a brief gap when the process resumes', async () => {
		let tick = 0

		// Appears -> briefly gone -> resumes -> finally done
		const is_running = (): boolean => {
			tick += 1
			if (tick === 1) return true
			if (tick <= 3) return false

			return tick <= 5
		}

		const result = await lane_await.wait_for_any([ISSUE], {
			is_running,
			poll_ms: POLL_MS,
			reconfirm_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
		// Tick count > 5 proves we went through the resume phase before returning.
		expect(tick).toBeGreaterThan(5)
	})
})

describe('wait_for_any -- first to complete wins', () => {
	it('returns the first of two issues to confirm-complete', async () => {
		const running_state: Record<string, boolean> = { [ISSUE]: true, [OTHER]: true }
		let ticks = 0

		const is_running = (issue: string): boolean => {
			ticks += 1
			if (issue === ISSUE && ticks > 3) return false

			return running_state[issue] ?? false
		}

		const result = await lane_await.wait_for_any([ISSUE, OTHER], {
			is_running,
			poll_ms: POLL_MS,
			reconfirm_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
	})
})

it('NEVER_APPEARED_TIMEOUT_MS is exported for use in the CLI', () => {
	expect(NEVER_APPEARED_TIMEOUT_MS).toBeGreaterThan(0)
})
