import type { TimingAnswer } from '#scripts/ci/ci-timing'
import type { TimingRow } from '#scripts/ci/ci-timing-table'
import { describe, expect, it, vi } from 'vitest'
import { lane_why_ci } from './lane-why-ci'

// joshuafolkken/kit#6124: `josh lane:why`'s followup CI cell names the longest job of the lane's runs
// and that job's longest step, blank when `ci:timing` is unreadable.

const mocks = vi.hoisted(() => ({ timing_of: vi.fn() }))

vi.mock(import('#scripts/ci/ci-timing'), async (import_original) => {
	const { ci_timing } = await import_original()

	return { ci_timing: { ...ci_timing, timing_of: mocks.timing_of } }
})

const RUN = { id: 1, head_sha: 'abc', html_url: 'https://example.test/run/1' }

function step(name: string, seconds: number | undefined): TimingRow {
	return { name, seconds, conclusion: 'success' }
}

const TIMED: TimingAnswer = {
	kind: 'timed',
	runs: [
		{ run: RUN, jobs: [{ ...step('lint', 40), steps: [step('eslint', 30)] }] },
		{
			run: { ...RUN, id: 2 },
			jobs: [
				{ ...step('e2e', 300), steps: [step('setup', 20), step('playwright', 250)] },
				{ ...step('queued', undefined), steps: [] },
			],
		},
	],
}

describe('lane_why_ci.cell', () => {
	it('names the longest job across the runs and its longest step', () => {
		expect(lane_why_ci.cell(TIMED)).toBe('longest job: e2e 300s, step: playwright 250s')
	})

	it('omits the step part when the longest job has no measured step', () => {
		const answer: TimingAnswer = {
			kind: 'timed',
			runs: [{ run: RUN, jobs: [{ ...step('unit', 60), steps: [step('wait', undefined)] }] }],
		}

		expect(lane_why_ci.cell(answer)).toBe('longest job: unit 60s')
	})

	it('answers blank for an unreadable timing, no runs or no measured job', () => {
		const unmeasured: TimingAnswer = {
			kind: 'timed',
			runs: [{ run: RUN, jobs: [{ ...step('queued', undefined), steps: [] }] }],
		}

		expect(lane_why_ci.cell(undefined)).toBe('')
		expect(lane_why_ci.cell({ kind: 'none', target: 'branch 6050-lane' })).toBe('')
		expect(lane_why_ci.cell(unmeasured)).toBe('')
	})
})

describe('lane_why_ci.read', () => {
	it('reads the lane branch through ci_timing.timing_of', async () => {
		mocks.timing_of.mockResolvedValue(TIMED)

		await expect(lane_why_ci.read(6050)).resolves.toBe(TIMED)
		expect(mocks.timing_of).toHaveBeenCalledWith('6050-lane')
	})

	it('answers undefined when ci:timing throws', async () => {
		mocks.timing_of.mockRejectedValue(new Error('gh failed'))

		await expect(lane_why_ci.read(6050)).resolves.toBeUndefined()
	})
})
