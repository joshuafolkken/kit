import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_await, type AwaitState, type CheckConfig } from './lane-await'

// joshuafolkken/kit#4395. A child whose detached ship succeeded merged its work, so no cut hand-off can
// follow its disappearance: it is collected at once rather than after the re-confirm window.

const ISSUE = '4395'
const NOW = 1_000_000

beforeEach(() => {
	vi.restoreAllMocks()
})

const ALIVE_SINCE = NOW - 1

function appeared(): AwaitState {
	return {
		appeared: true,
		alive_since: ALIVE_SINCE,
		disappeared_at: undefined,
		first_polled_at: undefined,
	}
}

// Shipped only for a ship no older than the run of the child it is asked about.
function config(is_running: boolean, is_shipped: boolean): CheckConfig {
	return {
		is_running: () => is_running,
		is_shipped: (_issue, since_ms) => is_shipped && since_ms === ALIVE_SINCE,
		reconfirm_ms: lane_await.RECONFIRM_MS,
		never_appeared_timeout_ms: Number.MAX_SAFE_INTEGER,
	}
}

describe('check_issue -- a succeeded ship', () => {
	it('confirms a child whose ship succeeded on its first disappearance', () => {
		expect(lane_await.check_issue(ISSUE, appeared(), NOW, config(false, true))).toBe(ISSUE)
	})

	it('keeps the re-confirm window for a child whose ship did not succeed', () => {
		const state = appeared()

		expect(lane_await.check_issue(ISSUE, state, NOW, config(false, false))).toBeUndefined()
		expect(state.disappeared_at).toBe(NOW)
	})

	it('never confirms a running child on a succeeded ship record', () => {
		expect(lane_await.check_issue(ISSUE, appeared(), NOW, config(true, true))).toBeUndefined()
	})

	it('keeps the re-confirm window for a child already alive when the watch began', () => {
		const state = { ...appeared(), alive_since: undefined }

		expect(lane_await.check_issue(ISSUE, state, NOW, config(false, true))).toBeUndefined()
	})

	it('asks for a ship no older than the run of the child that came back', () => {
		const state = { ...appeared(), disappeared_at: NOW - 2 }

		expect(lane_await.check_issue(ISSUE, state, ALIVE_SINCE, config(true, true))).toBeUndefined()
		expect(lane_await.check_issue(ISSUE, state, NOW, config(false, true))).toBe(ISSUE)
	})

	it('never reads a ship from before the child came back as its own', () => {
		const state = { ...appeared(), disappeared_at: NOW - 2 }

		expect(lane_await.check_issue(ISSUE, state, NOW, config(true, true))).toBeUndefined()
		expect(state.alive_since).toBe(NOW)
		expect(lane_await.check_issue(ISSUE, state, NOW + 1, config(false, true))).toBeUndefined()
	})
})

function record(result: 'success' | 'failed', launched_at: number | undefined): void {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(process.cwd())
	vi.spyOn(run_ship_detach, 'read_result').mockReturnValue({
		launch_id: 'done',
		launched_at,
		result,
	})
}

describe('is_shipped_default', () => {
	it('reads a detached ship that succeeded after the wait started as shipped', () => {
		record('success', NOW)

		expect(lane_await.is_shipped_default(ISSUE, NOW)).toBe(true)
	})

	it('reads a failed detached ship as not shipped', () => {
		record('failed', NOW)

		expect(lane_await.is_shipped_default(ISSUE, NOW)).toBe(false)
	})

	it('reads a success left by a past dispatch of the issue as not shipped', () => {
		record('success', NOW - 1)

		expect(lane_await.is_shipped_default(ISSUE, NOW)).toBe(false)
	})

	it('reads a success with no launch time as not shipped', () => {
		record('success', undefined)

		expect(lane_await.is_shipped_default(ISSUE, NOW)).toBe(false)
	})
})
