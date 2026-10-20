import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// joshuafolkken/kit#3974: three unanswered ship stops ended a run as `environment` though every child
// reached the API. Such a stop is re-dispatched like an outage but left out of the run-wide streak.

const unmark_mock = vi.hoisted(() => vi.fn())
const reap_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: unmark_mock } }))
vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: reap_mock } }))

const { run_merge_steps } = await import('./run-merge-steps')

const TARGET = '/stub'
const CONTEXT = {
	child: '3974',
	epic: undefined,
	repo: undefined,
	over: undefined,
	owner: run_carry.NO_OWNER,
}
const CHILD_LANE = { issue: CONTEXT.child, directory: `/w/.kit-lanes/${CONTEXT.child}` }
const UNANSWERED = { ...CONTEXT, is_unanswered: true }
const OWNED_CARRY: RunCarry = {
	invocation: 'backlogrun #3964 #3936 #3961',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 2,
}
const HANDED_OFF_CARRY: RunCarry = { ...OWNED_CARRY, is_handed_off: true }

function carried(carry: RunCarry): MockInstance<typeof run_carry.apply_change> {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(TARGET)
	vi.spyOn(run_carry, 'carry_path').mockReturnValue(TARGET)
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry })

	return vi.spyOn(run_carry, 'apply_change').mockReturnValue({ ...carry, outages: 3 })
}

beforeEach(() => {
	vi.restoreAllMocks()
	unmark_mock.mockReset().mockResolvedValue(true)
	reap_mock.mockReset().mockReturnValue([])
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	vi.spyOn(lane_registry, 'lane_location').mockResolvedValue(CHILD_LANE)
})

describe('run_merge_steps.do_outage — an unanswered ship stop', () => {
	it('re-dispatches the child without adding to the outage streak', async () => {
		const apply = carried(OWNED_CARRY)

		expect(await run_merge_steps.do_outage(UNANSWERED)).toStrictEqual({
			carry: undefined,
			is_refused: false,
		})
		expect(apply).not.toHaveBeenCalled()
		expect(reap_mock).toHaveBeenCalledWith(CHILD_LANE)
		expect(unmark_mock).toHaveBeenCalledOnce()
	})

	it('still refuses a session that does not own the record', async () => {
		carried(HANDED_OFF_CARRY)
		const result = await run_merge_steps.do_outage(UNANSWERED)

		expect(result.is_refused).toBe(true)
		expect(unmark_mock).not.toHaveBeenCalled()
	})

	it('adds an API outage to the streak', async () => {
		const apply = carried(OWNED_CARRY)

		await run_merge_steps.do_outage(CONTEXT)

		expect(apply).toHaveBeenCalledWith(TARGET, expect.anything(), { outages: 1 })
	})
})
