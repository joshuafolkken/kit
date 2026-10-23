import type { PrStateSnapshot, RollupCheck } from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followup_coderabbit_wait, type CodeRabbitWait } from './followup-coderabbit-wait'

// joshuafolkken/kit#4574: followup's check waits time CodeRabbit apart — how long it was still running
// or rate-limited — and hand both to the lane ledger, where `lane:stats` reads them.

const RUNNING: RollupCheck = { name: 'CodeRabbit', status: 'pending', description: 'In progress' }
const RATE_LIMITED: RollupCheck = {
	name: 'CodeRabbit',
	status: 'pass',
	description: 'Rate limited',
}
const DONE: RollupCheck = { name: 'CodeRabbit', status: 'pass', description: 'Review completed' }
const CI: RollupCheck = { name: 'test', status: 'pending' }
const SECONDS = 1000

function snapshot(...rollup: Array<RollupCheck>): PrStateSnapshot {
	return { rollup, merge_state_status: undefined, review_decision: undefined }
}

// One poll per `[seconds, checks]` pair, the clock reading `seconds` at it.
function polled(polls: ReadonlyArray<[number, Array<RollupCheck>]>): CodeRabbitWait {
	const wait = followup_coderabbit_wait.new_wait()

	for (const [seconds, checks] of polls) {
		followup_coderabbit_wait.observe(wait, snapshot(...checks), seconds * SECONDS)
	}

	return wait
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('followup_coderabbit_wait.observer_of — the time between polls', () => {
	it('charges each interval to the state the earlier poll saw', () => {
		const wait = polled([
			[0, [CI, RUNNING]],
			[10, [CI, RATE_LIMITED]],
			[40, [CI, DONE]],
			[50, [CI, DONE]],
		])

		expect(wait).toMatchObject({ wait_ms: 40 * SECONDS, rate_limited_ms: 30 * SECONDS })
	})

	it('charges nothing while CodeRabbit is done or absent', () => {
		const wait = polled([
			[0, [CI]],
			[10, [CI, DONE]],
			[20, [CI, DONE]],
		])

		expect(wait).toMatchObject({ wait_ms: 0, rate_limited_ms: 0 })
	})
})

describe('followup_coderabbit_wait.observer_of', () => {
	it('adds what the wait polls to the run’s CodeRabbit time', async () => {
		const wait = followup_coderabbit_wait.new_wait()

		await followup_coderabbit_wait.observer_of(wait)(snapshot(CI, RATE_LIMITED))

		expect(wait.last?.state).toBe('rate-limited')
	})

	it('charges nothing for the time between two waits', async () => {
		const wait = followup_coderabbit_wait.new_wait()
		let now_ms = 0

		vi.spyOn(performance, 'now').mockImplementation(() => now_ms)
		await followup_coderabbit_wait.observer_of(wait)(snapshot(CI, RATE_LIMITED))
		now_ms = 60 * SECONDS
		await followup_coderabbit_wait.observer_of(wait)(snapshot(CI, RATE_LIMITED))

		expect(wait).toMatchObject({ wait_ms: 0, rate_limited_ms: 0 })
	})
})

describe('followup_coderabbit_wait.both', () => {
	it('hands every poll to both observers, in order', async () => {
		const seen: Array<string> = []
		const observe = followup_coderabbit_wait.both(
			async () => {
				seen.push('first')
			},
			async () => {
				seen.push('second')
			},
		)

		await observe(snapshot(CI))

		expect(seen).toStrictEqual(['first', 'second'])
	})
})

describe('followup_coderabbit_wait.record — the lane ledger', () => {
	it('records the wait and its rate-limited part as stages of their own', async () => {
		const record = vi.spyOn(lane_ledger, 'record_stage').mockResolvedValue()

		await followup_coderabbit_wait.record({ wait_ms: 40 * SECONDS, rate_limited_ms: 30 * SECONDS })

		expect(record.mock.calls.map(([stage]) => stage)).toStrictEqual([
			{ stage: lane_ledger.CODERABBIT_WAIT_STAGE, elapsed_ms: 40 * SECONDS },
			{ stage: lane_ledger.CODERABBIT_RATE_LIMIT_STAGE, elapsed_ms: 30 * SECONDS },
		])
	})

	it('records no rate-limit stage for a wait CodeRabbit was never rate-limited in', async () => {
		const record = vi.spyOn(lane_ledger, 'record_stage').mockResolvedValue()

		await followup_coderabbit_wait.record({ wait_ms: 40 * SECONDS, rate_limited_ms: 0 })

		expect(record.mock.calls.map(([stage]) => stage.stage)).toStrictEqual([
			lane_ledger.CODERABBIT_WAIT_STAGE,
		])
	})

	it('records nothing for a run that never saw CodeRabbit waiting', async () => {
		const record = vi.spyOn(lane_ledger, 'record_stage').mockResolvedValue()

		await followup_coderabbit_wait.record(followup_coderabbit_wait.new_wait())

		expect(record).not.toHaveBeenCalled()
	})
})
