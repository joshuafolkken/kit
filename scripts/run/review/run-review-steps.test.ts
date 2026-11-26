import { core_priority } from '#scripts/gate/core-priority'
import { gate_owner_watch } from '#scripts/gate/gate-owner-watch'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_mark_keys } from '#scripts/lane/lane-child-mark-keys'
import { lane_reap } from '#scripts/lane/lane-reap'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_steps } from './run-review-steps'

// The environment `launch_gate` hands its background launch, which is stubbed out.
function launched_environment(): Record<string, string | undefined> | undefined {
	const launch = vi
		.spyOn(detached_launch, 'launch')
		.mockReturnValue({ kind: 'failed', note: 'not launched' })

	run_review_steps.launch_gate('run-review-steps-test-launch')

	return launch.mock.calls[0]?.[0].env
}

// joshuafolkken/kit#5819: the review stage's children carry the core-budget priority mark, and the gate
// they open in the background must not inherit it, or its heavy checks jump other lanes' queue.
describe('run_review_steps.launch_josh — the core-budget priority mark', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('clears the priority mark on the background launch', () => {
		expect(launched_environment()).toHaveProperty(core_priority.PRIORITY_KEY, undefined)
	})
})

// joshuafolkken/kit#8845: `run:review` exits before its gate does, so the gate's owner is the lane child
// session it runs under, named by pid in the gate's environment.
describe('run_review_steps.launch_gate — the gate owner', () => {
	const LANE_CHILD_PID = 48_848

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	it('names the lane child session it runs under as the owner', () => {
		vi.stubEnv(lane_child_mark_keys.KEY, '8845')
		const own_child = vi.spyOn(lane_reap, 'own_child').mockReturnValue(LANE_CHILD_PID)

		expect(launched_environment()).toHaveProperty(
			gate_owner_watch.OWNER_PID_KEY,
			String(LANE_CHILD_PID),
		)
		expect(own_child).toHaveBeenCalledWith('8845')
	})

	it('names no owner outside a lane child', () => {
		vi.stubEnv(lane_child_mark_keys.KEY, '')

		expect(launched_environment()).not.toHaveProperty(gate_owner_watch.OWNER_PID_KEY)
	})
})

// joshuafolkken/kit#2179: the timing record `josh run:review` opens at the start and closes at the
// join, exercised over an isolated target so it never touches the record a real run relies on. The
// four timestamps this round-trips are the ones the overlap in the PR body is measured from.

const START_TARGET = 'run-review-steps-test-start'
const MISSING_TARGET = 'run-review-steps-test-missing'
const ENDED = {
	gate_ended_at: '2026-09-20T10:00:30.000Z',
	review_ended_at: '2026-09-20T10:02:12.000Z',
}
const START = {
	gate_started_at: '2026-09-20T10:00:00.000Z',
	review_started_at: '2026-09-20T10:00:02.000Z',
}

afterEach(() => {
	for (const target of [START_TARGET, MISSING_TARGET]) {
		stamp_file.remove_stamp(run_review_steps.timing_path(target))
	}
})

describe('the timing record round-trip', () => {
	it('reads back the start it was written', () => {
		run_review_steps.write_timing_start(START, START_TARGET)

		expect(run_review_steps.read_timing_start(START_TARGET)).toStrictEqual(START)
	})

	it('completes the start into the full four-timestamp timing', () => {
		run_review_steps.write_timing_start(START, START_TARGET)

		expect(run_review_steps.complete_timing(ENDED, START_TARGET)).toStrictEqual({
			...START,
			...ENDED,
		})
	})

	it('reads no record as undefined rather than an empty timing', () => {
		expect(run_review_steps.read_timing_start(MISSING_TARGET)).toBeUndefined()
	})

	it('cannot complete a timing whose start was never opened', () => {
		expect(run_review_steps.complete_timing(ENDED, MISSING_TARGET)).toBeUndefined()
	})
})
