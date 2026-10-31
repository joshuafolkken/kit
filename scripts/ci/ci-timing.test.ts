import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ci_timing } from './ci-timing'

vi.mock('#scripts/gh/git-gh-exec')

const RUN_ID = 18_912_345_678
const REPO = 'repos/{owner}/{repo}'
const HEAD_SHA = 'abc123'
const RUN = {
	id: RUN_ID,
	name: 'CI',
	conclusion: 'success',
	head_sha: HEAD_SHA,
	html_url: 'https://example.test/run',
}
const JOBS_PAGE = {
	jobs: [
		{
			name: 'unit',
			conclusion: 'success',
			started_at: '2026-10-31T00:00:00Z',
			completed_at: '2026-10-31T00:00:30Z',
			steps: [],
		},
	],
}
const UNIT = { name: 'unit', seconds: 30, conclusion: 'success', steps: [] }
const TIMED = { kind: 'timed', runs: [{ run: RUN, jobs: [UNIT] }] }

const api = vi.mocked(git_gh_exec.exec_gh_api)

// One Actions world keyed by request path; a path it does not know is a test error.
function answer(responses: Record<string, object>): void {
	api.mockImplementation(async (request: GhApiRequest) => {
		const response = responses[request.path]

		if (response === undefined) throw new Error(`unexpected path ${request.path}`)

		return JSON.stringify(response)
	})
}

const JOBS_PATH = `${REPO}/actions/runs/${String(RUN_ID)}/jobs?per_page=100`

beforeEach(() => {
	api.mockReset()
})

describe('ci_timing.target_of', () => {
	it('reads a run id, a pull request number and a branch name apart', () => {
		expect(ci_timing.target_of(String(RUN_ID))).toStrictEqual({ kind: 'run', run_id: RUN_ID })
		expect(ci_timing.target_of('5544')).toStrictEqual({ kind: 'pr', pr: 5544 })
		expect(ci_timing.target_of('5544-lane')).toStrictEqual({ kind: 'branch', branch: '5544-lane' })
	})
})

describe('ci_timing.timing_of a run id', () => {
	it('times the run a run id names', async () => {
		answer({ [`${REPO}/actions/runs/${String(RUN_ID)}`]: RUN, [JOBS_PATH]: JOBS_PAGE })

		await expect(ci_timing.timing_of(String(RUN_ID))).resolves.toStrictEqual(TIMED)
	})

	it("drops the REST run's other fields, so --json carries the trimmed run alone", async () => {
		const rest_run = { ...RUN, repository: { full_name: 'o/r' }, actor: { login: 'a' } }

		answer({ [`${REPO}/actions/runs/${String(RUN_ID)}`]: rest_run, [JOBS_PATH]: JOBS_PAGE })

		await expect(ci_timing.timing_of(String(RUN_ID))).resolves.toStrictEqual(TIMED)
	})
})

describe('ci_timing.timing_of a branch or a pull request', () => {
	it("times every run on the branch's latest commit, not an older one", async () => {
		const side = { ...RUN, id: RUN_ID + 1, name: 'Release classification' }
		const older = { ...RUN, id: RUN_ID - 1, head_sha: 'older' }

		answer({
			[`${REPO}/actions/runs?branch=feature%2Fx&per_page=20`]: {
				workflow_runs: [side, RUN, older],
			},
			[`${REPO}/actions/runs/${String(side.id)}/jobs?per_page=100`]: JOBS_PAGE,
			[JOBS_PATH]: JOBS_PAGE,
		})

		await expect(ci_timing.timing_of('feature/x')).resolves.toStrictEqual({
			kind: 'timed',
			runs: [
				{ run: side, jobs: [UNIT] },
				{ run: RUN, jobs: [UNIT] },
			],
		})
	})

	it("times the latest runs of a pull request's head branch", async () => {
		answer({
			[`${REPO}/pulls/5544`]: { head: { ref: '5544-lane' } },
			[`${REPO}/actions/runs?branch=5544-lane&per_page=20`]: { workflow_runs: [RUN] },
			[JOBS_PATH]: JOBS_PAGE,
		})

		await expect(ci_timing.timing_of('5544')).resolves.toStrictEqual(TIMED)
	})

	it('answers none with the target when the branch has no run', async () => {
		answer({ [`${REPO}/actions/runs?branch=empty&per_page=20`]: { workflow_runs: [] } })

		await expect(ci_timing.timing_of('empty')).resolves.toStrictEqual({
			kind: 'none',
			target: 'empty',
		})
	})
})
