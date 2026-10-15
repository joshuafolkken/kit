import type { PrStateSnapshot, RollupCheck } from '#scripts/gh/git-pr-checks-parse'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followup_checks_event } from './followup-checks-event'

// joshuafolkken/kit#3770: followup's check wait writes the CI counts and CodeRabbit's state to the run's
// stream, once per change, so `run:board` draws a followup row without asking GitHub.

const PR_URL = 'https://github.com/joshuafolkken/kit/pull/3765'
const ISSUE = '3754'
const CODERABBIT_RUNNING: RollupCheck = {
	name: 'CodeRabbit',
	status: 'pending',
	description: 'Review in progress',
}
const CODERABBIT_RATE_LIMITED: RollupCheck = {
	name: 'CodeRabbit',
	status: 'pass',
	description: 'Review rate limited',
}

function snapshot(...rollup: Array<RollupCheck>): PrStateSnapshot {
	return { rollup, merge_state_status: undefined, review_decision: undefined }
}

const CI: Array<RollupCheck> = [
	{ name: 'lint', status: 'pass' },
	{ name: 'test', status: 'pass' },
	{ name: 'e2e', status: 'pending' },
	{ name: 'SonarQube', status: 'fail' },
]

afterEach(() => {
	vi.restoreAllMocks()
})

describe('followup_checks_event.summary_of', () => {
	it('counts the CI checks by how they stand, CodeRabbit apart', () => {
		expect(followup_checks_event.summary_of(snapshot(...CI, CODERABBIT_RUNNING), 1)).toStrictEqual({
			pr: 1,
			pass: 2,
			pending: 1,
			fail: 1,
			coderabbit: 'running',
		})
	})

	it('reads a passing CodeRabbit status that says it was rate limited as rate-limited', () => {
		const summary = followup_checks_event.summary_of(snapshot(CODERABBIT_RATE_LIMITED), 1)

		expect(summary.coderabbit).toBe('rate-limited')
	})

	it('reads CodeRabbit as done, failed or absent from its status', () => {
		const done = { name: 'CodeRabbit', status: 'pass', description: 'Review completed' }
		const failed = { name: 'CodeRabbit', status: 'fail' }

		expect(followup_checks_event.summary_of(snapshot(done), 1).coderabbit).toBe('done')
		expect(followup_checks_event.summary_of(snapshot(failed), 1).coderabbit).toBe('failed')
		expect(followup_checks_event.summary_of(snapshot(...CI), 1).coderabbit).toBe('none')
	})
})

describe('followup_checks_event.observer_of', () => {
	it('writes a line on the first poll and again only when the checks change', async () => {
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
		const observe = followup_checks_event.observer_of(ISSUE, PR_URL)

		await observe(snapshot(...CI, CODERABBIT_RUNNING))
		await observe(snapshot(...CI, CODERABBIT_RUNNING))
		await observe(snapshot(...CI, CODERABBIT_RATE_LIMITED))

		expect(emit.mock.calls).toStrictEqual([
			['pr-checks', '#3754 PR 3765 pass 2 pending 1 fail 1 coderabbit running'],
			['pr-checks', '#3754 PR 3765 pass 2 pending 1 fail 1 coderabbit rate-limited'],
		])
	})

	it('writes nothing where the issue or the pull request is unknown', async () => {
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()

		await followup_checks_event.observer_of(undefined, PR_URL)(snapshot(...CI))
		await followup_checks_event.observer_of(ISSUE, undefined)(snapshot(...CI))

		expect(emit).not.toHaveBeenCalled()
	})
})
