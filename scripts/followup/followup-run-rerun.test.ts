import { POLL_BACKOFF } from '#scripts/lib/poll'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CHECK_RERUNS } from './followup-job-rerun'
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
const PASSED_RUN = { status: 'completed', conclusion: 'success', run_attempt: 1 }
const TRUNCATED_RUN = { ...PASSED_RUN, conclusion: 'failure' }

interface World {
	latest: Array<{ name: string; conclusion: string }>
	all: World['latest']
	run: typeof PASSED_RUN
	is_rerun?: boolean
	after_rerun?: Array<World['latest']>
}

type WorldInput = Pick<World, 'latest'> & Partial<World>

// After the rerun, each read takes the next of `after_rerun`; the lost job is back once they run out.
function latest_of(world: World): World['latest'] {
	if (world.is_rerun !== true) return world.latest

	return world.after_rerun?.shift() ?? [UNIT, CHECKS_JOB]
}

function read_of(world: World, path: string): unknown {
	if (path.includes('runs?head_sha=')) return { workflow_runs: [{ id: RUN_ID, ...world.run }] }
	if (path.includes('filter=all')) return { jobs: world.all }
	if (path.includes(LATEST_FILTER)) return { jobs: latest_of(world) }

	return undefined
}

function answer_actions(input: WorldInput): void {
	const world: World = { all: [UNIT, CHECKS_JOB], run: PASSED_RUN, ...input }

	api.mockImplementation(async ({ path, method }) => {
		if (method === 'POST') world.is_rerun = true
		const read = read_of(world, path)

		return read === undefined ? '' : JSON.stringify(read)
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

// joshuafolkken/kit#6922: GitHub ended run 42673194882 as a failure before it created `Checks`.
describe('recover_missing — a run that ended before it created the required jobs', () => {
	it('reruns a failed run with no failed job whose required job was never created', async () => {
		answer_actions({ latest: [UNIT], all: [UNIT], run: TRUNCATED_RUN })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('rerun')
		expect(posts()).toStrictEqual([RERUN_PATH])
	})

	it('does not rerun such a run when it holds a failed job', async () => {
		const failed = [{ name: UNIT.name, conclusion: 'failure' }]

		answer_actions({ latest: failed, all: failed, run: TRUNCATED_RUN })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
		expect(posts()).toStrictEqual([])
	})

	it.each([
		{ attempt: MAX_CHECK_RERUNS, outcome: 'rerun', rerun: [RERUN_PATH] },
		{ attempt: MAX_CHECK_RERUNS + 1, outcome: 'none', rerun: [] },
	])('reruns attempt $attempt only within the rerun cap', async ({ attempt, outcome, rerun }) => {
		const run = { ...TRUNCATED_RUN, run_attempt: attempt }

		answer_actions({ latest: [UNIT], all: [UNIT], run })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe(outcome)
		expect(posts()).toStrictEqual(rerun)
	})

	// A superseded run the concurrency group cancelled before it created any job.
	it('does not rerun a cancelled run', async () => {
		answer_actions({ latest: [], all: [], run: { ...TRUNCATED_RUN, conclusion: 'cancelled' } })

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
		answer_actions({ latest: [{ name: UNIT.name, conclusion: 'failure' }] })

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
		expect(posts()).toStrictEqual([])
	})

	it('answers none when a read fails, so the original failure stands', async () => {
		api.mockRejectedValue(new Error('HTTP 502'))

		await expect(followup_run_rerun.recover_missing(MISSING)).resolves.toBe('none')
	})
})
