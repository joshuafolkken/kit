import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_run_rerun } from './followup-run-rerun'

// joshuafolkken/kit#5778: a partial rerun dropped the required `Checks` job from its run's latest
// attempt, and no failed job was left for `rerun-failed-jobs` to retry.

vi.mock(import('#scripts/gh/git-gh-exec'), async (import_original) => {
	const actual = await import_original()

	return { ...actual, git_gh_exec: { ...actual.git_gh_exec, exec_gh_api: vi.fn() } }
})

vi.mock('#scripts/lib/poll', () => ({
	poll: { poll_until: vi.fn(async (check: () => Promise<boolean>) => await check()) },
}))

const { git_gh_exec } = await import('#scripts/gh/git-gh-exec')

const api = vi.mocked(git_gh_exec.exec_gh_api)

const ACTIONS = 'repos/{owner}/{repo}/actions/'
const HEAD_SHA = 'abc123'
const RUN_ID = 7
const CHECKS = 'Checks'
const UNIT = { name: 'Unit Tests', conclusion: 'success' }
const CHECKS_JOB = { name: CHECKS, conclusion: 'success' }
const RERUN_PATH = `${ACTIONS}runs/${String(RUN_ID)}/rerun`
const MISSING = { contexts: [CHECKS], head_sha: HEAD_SHA }

interface World {
	latest: Array<{ name: string; conclusion: string }>
	is_rerun?: boolean
}

function answer_actions(world: World): void {
	api.mockImplementation(async ({ path, method }) => {
		if (method === 'POST') world.is_rerun = true
		if (path.includes('runs?head_sha=')) return JSON.stringify({ workflow_runs: [{ id: RUN_ID }] })
		if (path.includes('filter=all')) return JSON.stringify({ jobs: [UNIT, CHECKS_JOB] })
		const latest = world.is_rerun === true ? [UNIT, CHECKS_JOB] : world.latest

		return JSON.stringify({ jobs: latest })
	})
}

function posts(): Array<string> {
	const requests = api.mock.calls.map(([request]) => request)

	return requests.filter((request) => request.method === 'POST').map((request) => request.path)
}

beforeEach(() => {
	api.mockReset()
	vi.spyOn(console, 'info').mockReturnValue()
})

describe('recover_missing — the whole run that lost a required job', () => {
	it('reruns the whole run once and confirms the job is back in its latest attempt', async () => {
		answer_actions({ latest: [UNIT] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('rerun')
		expect(posts()).toStrictEqual([RERUN_PATH])
		expect(api.mock.calls.at(-1)?.[0].path).toContain('filter=latest')
	})

	it('waits again without a rerun when the job is already in the latest attempt', async () => {
		answer_actions({ latest: [UNIT, CHECKS_JOB] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('present')
		expect(posts()).toStrictEqual([])
	})
})

describe('recover_missing — nothing to recover', () => {
	it('leaves a context no job of the head ever had', async () => {
		answer_actions({ latest: [UNIT] })

		const outcome = followup_run_rerun.recover_missing({ ...MISSING, contexts: ['SonarCloud'] })

		await expect(outcome).resolves.toBe('none')
		expect(posts()).toStrictEqual([])
	})

	it('does not rerun a run whose latest attempt holds a failed job', async () => {
		answer_actions({ latest: [{ name: UNIT.name, conclusion: 'failure' }] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
		expect(posts()).toStrictEqual([])
	})

	it('answers none when a read fails, so the original failure stands', async () => {
		api.mockRejectedValue(new Error('HTTP 502'))

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
	})
})
