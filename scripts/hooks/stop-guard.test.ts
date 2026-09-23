import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { stop_rules } from '#scripts/rules/stop-rules'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stop_guard, write_stop_decision } from './stop-guard'

const SWITCH_KEY = stop_rules.SWITCH_ENV_KEY

afterEach(() => {
	Reflect.deleteProperty(process.env, SWITCH_KEY)
	vi.restoreAllMocks()
})

describe('stop_guard — fail open', () => {
	it('returns no outcome on a payload that is not JSON', async () => {
		expect(await stop_guard.outcome_of('not json')).toEqual(stop_rules.NO_OUTCOME)
	})

	it('returns no outcome when the guard switch is off, before any world read', async () => {
		process.env[SWITCH_KEY] = 'off'
		const payload = JSON.stringify({
			transcript_path: 'transcript-not-read',
			stop_hook_active: true,
		})

		expect(await stop_guard.stop_outcome_for_payload(payload, backlog_ready.DEFAULT_PORTS)).toEqual(
			stop_rules.NO_OUTCOME,
		)
	})
})

describe('write_stop_decision — the stall check is wired', () => {
	it('runs the stall detector on every stop', async () => {
		const check = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)

		await write_stop_decision('not json')

		expect(check).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#2472: two `backlog:next` reads per stop could outrun the hook's timeout.
	it('hands the stall detector the one reading the pick-up check reuses', async () => {
		const check = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
		const shared = vi.spyOn(backlog_ready, 'shared_ports')

		await write_stop_decision('not json')

		expect(shared).toHaveBeenCalledOnce()
		expect(check).toHaveBeenCalledWith(shared.mock.results[0]?.value)
	})
})
