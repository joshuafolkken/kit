import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { error_text } from '#scripts/lib/error-message'
import { stop_rules } from '#scripts/rules/stop-rules'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stop_guard, write_stop_decision } from './stop-guard'

// joshuafolkken/kit#9043: the Stop hook fails open, and the failure it swallows leaves a trace.

afterEach(() => {
	vi.restoreAllMocks()
})

describe('stop_guard — a swallowed failure is traced', () => {
	it('returns no outcome and traces once when deciding the stop throws', async () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		vi.spyOn(stop_rules, 'parse_stop_payload').mockImplementation(() => {
			throw new Error('boom')
		})

		expect(await stop_guard.outcome_of('{}')).toEqual(stop_rules.NO_OUTCOME)
		expect(trace).toHaveBeenCalledOnce()
		expect(trace).toHaveBeenCalledWith('stop_guard.outcome_of', expect.any(Error))
	})

	it('reads no run and traces once when the git read fails', async () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('not a git repository'))
		const stall = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)

		await write_stop_decision('not json')

		expect(stall).not.toHaveBeenCalled()
		expect(trace).toHaveBeenCalledOnce()
		expect(trace).toHaveBeenCalledWith('stop_guard.carried_owner_live', expect.any(Error))
	})
})
