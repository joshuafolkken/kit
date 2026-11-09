import { POLL_BACKOFF } from '#scripts/lib/poll'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_run_rerun, LATEST_ATTEMPTS, LATEST_INTERVAL_MS } from './followup-run-rerun'

// joshuafolkken/kit#5778: a partial rerun dropped the required `Checks` job from its run's latest
// attempt, and no failed job was left for `rerun-failed-jobs` to retry.

vi.mock(import('#scripts/gh/git-gh-exec'), async (import_original) => {
	const actual = await import_original()

	return { ...actual, git_gh_exec: { ...actual.git_gh_exec, exec_gh_api: vi.fn() } }
})

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
const LATEST_FILTER = 'filter=latest'

interface World {
	latest: Array<{ name: string; conclusion: string }>
	all?: World['latest']
	run?: { conclusion: string; event: string }
	is_rerun?: boolean
	after_rerun?: Array<World['latest']>
}

// After the rerun, each read takes the next of `after_rerun`; the lost job is back once they run out.
function latest_of(world: World): World['latest'] {
	if (world.is_rerun !== true) return world.latest

	return world.after_rerun?.shift() ?? [UNIT, CHECKS_JOB]
}

function all_of(world: World): World['latest'] {
	return world.all ?? [UNIT, CHECKS_JOB]
}

function answer_actions(world: World): void {
	api.mockImplementation(async ({ path, method }) => {
		if (method === 'POST') world.is_rerun = true

		if (path.includes('runs?head_sha=')) {
			return JSON.stringify({ workflow_runs: [{ id: RUN_ID, ...world.run }] })
		}

		if (path.includes('filter=all')) return JSON.stringify({ jobs: all_of(world) })

		if (path.includes(LATEST_FILTER)) return JSON.stringify({ jobs: latest_of(world) })

		return ''
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

afterEach(() => {
	vi.useRealTimers()
})

async function recover_waited_ms(): Promise<number> {
	vi.useFakeTimers()
	const started = Date.now()
	const outcome = followup_run_rerun.recover_missing(MISSING)

	await vi.runAllTimersAsync()
	expect(await outcome).toBe('rerun')

	return Date.now() - started
}

function latest_reads(): number {
	return api.mock.calls.filter(([request]) => request.path.includes(LATEST_FILTER)).length
}

describe('recover_missing — the whole run that lost a required job', () => {
	it('reruns the whole run once and confirms the job is back in its latest attempt', async () => {
		answer_actions({ latest: [UNIT] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('rerun')
		expect(posts()).toStrictEqual([RERUN_PATH])
		expect(api.mock.calls.at(-1)?.[0].path).toContain(LATEST_FILTER)
	})

	it('waits again without a rerun when the job is already in the latest attempt', async () => {
		answer_actions({ latest: [UNIT, CHECKS_JOB] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('present')
		expect(posts()).toStrictEqual([])
	})

	// joshuafolkken/kit#6725: fewer reads than the fixed cadence, over the same total wait.
	it('backs off over the whole wait when the job never comes back', async () => {
		const after_rerun = Array.from({ length: LATEST_ATTEMPTS }, () => [UNIT])

		answer_actions({ latest: [UNIT], after_rerun })

		await expect(recover_waited_ms()).resolves.toBe((LATEST_ATTEMPTS - 1) * LATEST_INTERVAL_MS)
		expect(after_rerun.length).toBeGreaterThan(0)
		expect(latest_reads()).toBeLessThan(1 + LATEST_ATTEMPTS)
	})

	// The backoff watches the latest jobs: a job whose conclusion moved starts the next wait over.
	it('waits from the first interval again once a latest job moved', async () => {
		answer_actions({ latest: [UNIT], after_rerun: [[{ ...UNIT, conclusion: 'neutral' }], [UNIT]] })

		await expect(recover_waited_ms()).resolves.toBe(
			POLL_BACKOFF.initial_ms + POLL_BACKOFF.initial_ms,
		)
	})
})

// joshuafolkken/kit#6677: the run ended `failure` with every created job green, and its `Checks`
// job was never created in any attempt.
describe('recover_missing — a run that ended failed before creating its jobs', () => {
	it('reruns the whole run although no attempt ever held the context', async () => {
		answer_actions({
			latest: [UNIT],
			all: [UNIT],
			run: { conclusion: 'failure', event: 'pull_request' },
		})

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('rerun')
		expect(posts()).toStrictEqual([RERUN_PATH])
	})

	it('leaves a failed dynamic run, which holds none of the required jobs', async () => {
		answer_actions({
			latest: [UNIT],
			all: [UNIT],
			run: { conclusion: 'failure', event: 'dynamic' },
		})

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
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
		const run = { conclusion: 'failure', event: 'pull_request' }

		answer_actions({ latest: [{ name: UNIT.name, conclusion: 'failure' }], run })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
		expect(posts()).toStrictEqual([])
	})

	it('answers none when a read fails, so the original failure stands', async () => {
		api.mockRejectedValue(new Error('HTTP 502'))

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
	})
})
