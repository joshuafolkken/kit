import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'
import { git_pr_checks } from './git-pr-checks'
import { REQUIRED_CHECKS } from './git-pr-checks-eval'
import type { PrStateSnapshot } from './git-pr-checks-parse'
import { CHECKS_FAILED_MESSAGE, git_pr_checks_watch } from './git-pr-checks-watch'

// joshuafolkken/kit#3770. `followup` reports each poll's checks to the run's event stream through the
// observer the wait is handed, so every snapshot the wait reads must reach it.
vi.mock('./git-gh-pr-snapshot', () => ({
	git_gh_pr_snapshot: {
		pr_get_checks_snapshot: vi.fn(),
		pr_get_review_decision: vi.fn(),
	},
}))

const fetch_checks = vi.mocked(git_gh_pr_snapshot.pr_get_checks_snapshot)

const BRANCH = '3770-lane'
const PR_NUMBER = 3770
const GREEN_STATE = {
	mergeStateStatus: 'CLEAN',
	statusCheckRollup: REQUIRED_CHECKS.map(function green(name: string): Record<string, string> {
		return { name, status: 'COMPLETED', conclusion: 'SUCCESS' }
	}),
}
const FAILING_CHECK = { name: 'E2E', status: 'COMPLETED', conclusion: 'FAILURE' }

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(git_gh_pr_snapshot.pr_get_review_decision).mockResolvedValue('APPROVED')
	fetch_checks.mockResolvedValue({
		pr_number: PR_NUMBER,
		snapshot_json: JSON.stringify(GREEN_STATE),
	})
})

describe('git_pr_checks.wait_for_pr_success — observer', () => {
	it('hands each polled snapshot to the observer', async () => {
		const observed: Array<PrStateSnapshot> = []

		async function observe(snapshot: PrStateSnapshot): Promise<void> {
			observed.push(snapshot)
		}

		const result = await git_pr_checks.wait_for_pr_success(BRANCH, 1, observe)

		expect(observed).toStrictEqual([result])
	})
})

// The watch polls for up to two minutes before the wait above, so a row re-entering followup after a
// red wait must see the new CI's pending checks from the watch rather than keep the old red line.
describe('git_pr_checks_watch.pr_checks_watch — observer', () => {
	it('hands the watch poll snapshot to the observer', async () => {
		fetch_checks.mockResolvedValue({
			pr_number: PR_NUMBER,
			snapshot_json: JSON.stringify({ statusCheckRollup: [FAILING_CHECK] }),
		})
		const observed: Array<PrStateSnapshot> = []

		async function observe(snapshot: PrStateSnapshot): Promise<void> {
			observed.push(snapshot)
		}

		await expect(git_pr_checks_watch.pr_checks_watch(BRANCH, observe)).rejects.toThrow(
			CHECKS_FAILED_MESSAGE,
		)
		expect(observed).toHaveLength(1)
		expect(observed[0]?.rollup).toHaveLength(1)
	})
})
