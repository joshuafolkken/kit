import { spawnSync } from 'node:child_process'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { run_liveness } from '#scripts/run/run-liveness'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_await, type AwaitState, type CheckConfig } from './lane-await'

vi.mock('node:child_process', async (original) => {
	const actual = await original<{ spawnSync: typeof spawnSync }>()

	return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

// joshuafolkken/kit#2113. The re-confirm guard is the invariant being tested: a process that
// briefly disappears (the pre-gate boundary handoff) must not be declared done, while one that
// stays gone past the window must be.

const ISSUE = '2113'
const OTHER = '2114'
const { RECONFIRM_MS, NEVER_APPEARED_TIMEOUT_MS } = lane_await
const SHORT_RECONFIRM_MS = 10
const POLL_MS = 1
const NOW = 1_000_000
const NEVER_APPEARED_MESSAGE = 'never appeared'

// The default settled read asks GitHub; every test answers "not settled" unless it says otherwise.
beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(run_liveness, 'read_child_settled').mockResolvedValue(false)
})

function make_state(overrides: Partial<AwaitState> = {}): AwaitState {
	return { appeared: false, disappeared_at: undefined, first_polled_at: undefined, ...overrides }
}

// joshuafolkken/kit#3491. A clock that moves only when the wait sleeps, so a loaded machine cannot
// stretch one poll past the re-confirm window.
function virtual_clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
	let time = NOW

	function now(): number {
		return time
	}

	async function sleep(ms: number): Promise<void> {
		time += ms
		await Promise.resolve()
	}

	return { now, sleep }
}

// Helper: builds a minimal CheckConfig for tests that do not exercise the never-appeared timeout.
function config(is_running: () => boolean): CheckConfig {
	return {
		is_running,
		reconfirm_ms: RECONFIRM_MS,
		never_appeared_timeout_ms: Number.MAX_SAFE_INTEGER,
	}
}

describe('is_process_running_default', () => {
	it('bounds the pgrep probe with the probe timeout', () => {
		const mocked = vi.mocked(spawnSync)

		mocked.mockClear()
		lane_await.is_process_running_default(ISSUE)

		expect(mocked).toHaveBeenCalledWith(
			'pgrep',
			expect.any(Array),
			expect.objectContaining({ timeout: PROBE_TIMEOUT_MS }),
		)
	})
})

describe('check_issue -- running / disappearance states', () => {
	it('counts the detached ship as running after its child command disappears', () => {
		const repository = vi.spyOn(git_common_directory, 'repository').mockReturnValue(process.cwd())
		const ship = vi.spyOn(run_ship_detach, 'read_result').mockReturnValue({
			launch_id: 'active',
			result: 'running',
		})

		expect(lane_await.is_process_running_default(ISSUE)).toBe(true)
		expect(ship).toHaveBeenCalledWith(process.cwd(), ISSUE)
		repository.mockRestore()
		ship.mockRestore()
	})
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
		).toThrow(NEVER_APPEARED_MESSAGE)
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

		function is_running(): boolean {
			calls += 1

			return calls === 1
		}

		const result = await lane_await.wait_for_any([ISSUE], {
			is_running,
			poll_ms: POLL_MS,
			...virtual_clock(),
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
		function is_running(): boolean {
			tick += 1
			if (tick === 1) return true
			if (tick <= 3) return false

			return tick <= 5
		}

		const result = await lane_await.wait_for_any([ISSUE], {
			is_running,
			poll_ms: POLL_MS,
			...virtual_clock(),
			reconfirm_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
		// Tick count > 5 proves we went through the resume phase before returning.
		expect(tick).toBeGreaterThan(5)
	})
})

describe('wait_for_any -- injected clock', () => {
	it('measures the gap on the injected clock, one poll interval per sleep', async () => {
		const clock = virtual_clock()
		const slept: Array<number> = []
		let tick = 0

		function is_running(): boolean {
			tick += 1

			return tick === 1
		}

		async function sleep(ms: number): Promise<void> {
			slept.push(ms)
			await clock.sleep(ms)
		}

		await lane_await.wait_for_any([ISSUE], {
			is_running,
			poll_ms: POLL_MS,
			reconfirm_ms: SHORT_RECONFIRM_MS,
			now: clock.now,
			sleep,
		})

		expect(clock.now() - NOW).toBe(SHORT_RECONFIRM_MS + POLL_MS)
		expect(new Set(slept)).toStrictEqual(new Set([POLL_MS]))
	})
})

describe('wait_for_any -- first to complete wins', () => {
	it('returns the first of two issues to confirm-complete', async () => {
		const running_state: Record<string, boolean> = { [ISSUE]: true, [OTHER]: true }
		let ticks = 0

		function is_running(issue: string): boolean {
			ticks += 1
			if (issue === ISSUE && ticks > 3) return false

			return running_state[issue] ?? false
		}

		const result = await lane_await.wait_for_any([ISSUE, OTHER], {
			is_running,
			poll_ms: POLL_MS,
			...virtual_clock(),
			reconfirm_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
	})
})

// joshuafolkken/kit#3133. A child that ended between two `lane:await` calls never appears in the
// second one; its settled issue is what separates it from a child not yet launched.
describe('wait_for_any -- a child that ended before the call', () => {
	it('returns a closed child with no process without waiting', async () => {
		const read = vi.spyOn(run_liveness, 'read_child_settled').mockResolvedValue(true)

		const result = await lane_await.wait_for_any([ISSUE], {
			is_running: () => false,
			poll_ms: POLL_MS,
			...virtual_clock(),
			never_appeared_timeout_ms: SHORT_RECONFIRM_MS,
		})

		expect(result).toBe(ISSUE)
		expect(read).toHaveBeenCalledWith(ISSUE)
	})

	it('keeps waiting on an open child with no process until the never-appeared timeout', async () => {
		await expect(
			lane_await.wait_for_any([ISSUE], {
				is_running: () => false,
				is_settled: async () => false,
				poll_ms: POLL_MS,
				...virtual_clock(),
				never_appeared_timeout_ms: SHORT_RECONFIRM_MS,
			}),
		).rejects.toThrow(NEVER_APPEARED_MESSAGE)
	})

	it('returns the settled child while another is still running', async () => {
		const result = await lane_await.wait_for_any([ISSUE, OTHER], {
			is_running: (issue: string) => issue === ISSUE,
			is_settled: async (issue: string) => issue === OTHER,
			poll_ms: POLL_MS,
			...virtual_clock(),
		})

		expect(result).toBe(OTHER)
	})
})

it('NEVER_APPEARED_TIMEOUT_MS is exported for use in the CLI', () => {
	expect(NEVER_APPEARED_TIMEOUT_MS).toBeGreaterThan(0)
})

// joshuafolkken/kit#3137: `--owner` is how a resumed parent reclaims its carry record before waiting.
describe('parse_arguments', () => {
	it('reads the issues and the waiting session’s pid', () => {
		expect(lane_await.parse_arguments([ISSUE, OTHER, '--owner', '55250'])).toStrictEqual({
			issues: [ISSUE, OTHER],
			owner: 55_250,
		})
	})

	it('reads issues alone with no owner', () => {
		expect(lane_await.parse_arguments([ISSUE])).toStrictEqual({ issues: [ISSUE], owner: undefined })
	})

	it.each([
		['no issue', ['--owner', '55250']],
		['a non-number issue', [ISSUE, 'abc']],
		['a malformed pid', [ISSUE, '--owner', 'abc']],
		['an owner flag without its value', [ISSUE, '--owner']],
		['an unknown flag', [ISSUE, '--max', '3']],
	])('refuses %s', (_label, rest) => {
		expect(lane_await.parse_arguments(rest)).toBeUndefined()
	})
})
