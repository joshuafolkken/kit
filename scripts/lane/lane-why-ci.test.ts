import type { TimingAnswer } from '#scripts/ci/ci-timing'
import type { TimingRow } from '#scripts/ci/ci-timing-table'
import { git_gh_issue_merged_pull } from '#scripts/gh/git-gh-issue-merged-pull'
import { git_gh_pr_auto_merge } from '#scripts/gh/git-gh-pr-auto-merge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_registry } from './lane-registry'
import { lane_why_ci } from './lane-why-ci'

// joshuafolkken/kit#6124: `josh lane:why`'s followup CI cell names the longest job of the lane's runs
// and that job's longest step, blank when `ci:timing` is unreadable.

const mocks = vi.hoisted(() => ({ timing_of: vi.fn() }))
const find_lane = vi.spyOn(lane_registry, 'find_open_lane')
const SLUG = '6050-legacy-implementation'

beforeEach(() => {
	find_lane.mockResolvedValue(undefined)
	vi.spyOn(git_gh_pr_auto_merge, 'pr_list_open_with_head_prefix').mockResolvedValue([])
	vi.spyOn(git_gh_issue_merged_pull, 'pr_merged_head_of_issue').mockResolvedValue(undefined)
})

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
	it('keeps measuring the merged slug PR after the lane is closed (ac-8429)', async () => {
		vi.mocked(git_gh_issue_merged_pull.pr_merged_head_of_issue).mockResolvedValue(SLUG)
		mocks.timing_of.mockResolvedValue(TIMED)

		await expect(lane_why_ci.read(6050)).resolves.toBe(TIMED)
		expect(mocks.timing_of).toHaveBeenCalledWith(SLUG)
	})

	it('reads CI for the registered slug branch (ac-8429)', async () => {
		find_lane.mockResolvedValue(
			lane_registry.parse_block(`worktree /lanes/6050\nbranch refs/heads/${SLUG}`, '/lanes'),
		)
		mocks.timing_of.mockResolvedValue(TIMED)

		await expect(lane_why_ci.read(6050)).resolves.toBe(TIMED)
		expect(mocks.timing_of).toHaveBeenCalledWith(SLUG)
	})

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
