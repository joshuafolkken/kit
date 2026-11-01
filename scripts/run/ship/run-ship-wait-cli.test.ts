import { beforeEach, describe, expect, it, vi } from 'vitest'

const take_mock = vi.hoisted(() => vi.fn<() => string | undefined>())
const beat_mock = vi.hoisted(() => vi.fn())
const leave_mock = vi.hoisted(() => vi.fn())
const result_mock = vi.hoisted(() => vi.fn<() => { result: string } | undefined>())
const done_mock = vi.hoisted(() => vi.fn<() => ReadonlySet<string>>())
const started_mock = vi.hoisted(() => vi.fn<() => ReadonlyArray<string>>())
const repository_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())

vi.mock('node:timers/promises', () => ({ setTimeout: async (): Promise<void> => undefined }))
vi.mock('./run-ship-waiter', () => ({
	run_ship_waiter: { take: take_mock, beat: beat_mock, leave: leave_mock },
}))
vi.mock('./run-ship-detach', () => ({ run_ship_detach: { read_result: result_mock } }))
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: { repository_directory: repository_mock },
}))
vi.mock('./run-ship-stage', () => ({
	run_ship_stage: {
		STAGE: { COMMIT: 'commit', ROUND_TWO: 'round-2', FOLLOWUP: 'followup', REPORT: 'report' },
		record_path: (): string => '/stamps/record',
		read_done: done_mock,
		read_started: started_mock,
	},
}))

const { run_ship_wait_cli } = await import('./run-ship-wait-cli')

// joshuafolkken/kit#4711: the lane session waits on its detached ship through round 1, so a stop there
// comes back to it instead of to a fresh session.

const ISSUE = '4711'
const ROOT = '/repository'
const NOTE = 'fix the review failure, then ship again'
const { VERDICT } = run_ship_wait_cli
// Long enough for `poll` to read the stage record at least once (the sleep is mocked), short enough to end fast.
const SHORT_CHUNK_MS = 20

beforeEach(() => {
	vi.clearAllMocks()
	take_mock.mockReturnValue(undefined)
	result_mock.mockReturnValue({ result: 'running' })
	done_mock.mockReturnValue(new Set())
	started_mock.mockReturnValue([])
	repository_mock.mockResolvedValue(ROOT)
})

describe('run_ship_wait_cli.wait_for', () => {
	it('does not beat or consume a note when the chunk has no time left', async () => {
		take_mock.mockReturnValue(NOTE)

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE, 0)).resolves.toStrictEqual({
			verdict: VERDICT.PENDING,
		})
		expect(beat_mock).not.toHaveBeenCalled()
		expect(take_mock).not.toHaveBeenCalled()
	})

	it('returns the stop the supervisor handed back, and stops waiting', async () => {
		take_mock.mockReturnValueOnce(undefined).mockReturnValueOnce(NOTE)

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE)).resolves.toStrictEqual({
			verdict: VERDICT.RETURNED,
			note: NOTE,
		})
		expect(beat_mock).toHaveBeenCalledWith(ROOT, ISSUE)
		expect(leave_mock).toHaveBeenCalledWith(ROOT, ISSUE)
	})

	it('passes once the ship committed, so a later stop relaunches a fresh session', async () => {
		done_mock.mockReturnValue(new Set(['review', 'gate', 'commit']))
		started_mock.mockReturnValue(['review', 'gate', 'commit'])

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE)).resolves.toStrictEqual({
			verdict: VERDICT.PASSED,
		})
		expect(leave_mock).toHaveBeenCalledWith(ROOT, ISSUE)
	})
})

describe('run_ship_wait_cli.wait_for — the current attempt', () => {
	it('keeps waiting where only an earlier attempt committed', async () => {
		done_mock.mockReturnValue(new Set(['review', 'gate', 'commit']))
		started_mock.mockReturnValue(['gate'])

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE, SHORT_CHUNK_MS)).resolves.toStrictEqual({
			verdict: VERDICT.PENDING,
		})
		expect(started_mock).toHaveBeenCalled()
	})

	it('passes once the attempt is past a commit it skipped as already shipped', async () => {
		started_mock.mockReturnValue(['followup'])

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE)).resolves.toStrictEqual({
			verdict: VERDICT.PASSED,
		})
	})

	it('ends where the supervisor ended with no note for this session', async () => {
		result_mock.mockReturnValue({ result: 'failed' })

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE)).resolves.toStrictEqual({
			verdict: VERDICT.ENDED,
		})
	})

	it('keeps the heartbeat past a chunk that ran out, so the next wait is still seen', async () => {
		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE, SHORT_CHUNK_MS)).resolves.toStrictEqual({
			verdict: VERDICT.PENDING,
		})
		expect(beat_mock).toHaveBeenCalledWith(ROOT, ISSUE)
		expect(leave_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_wait_cli.CHUNK_MS — the wait is the keep-alive (#5344)', () => {
	it('ends a chunk inside the five-minute prompt-cache TTL, so the next wait reads the cache back', () => {
		const prompt_cache_ttl_ms = 300_000

		expect(run_ship_wait_cli.CHUNK_MS).toBeLessThan(prompt_cache_ttl_ms)
	})
})

describe('run_ship_wait_cli.wait_for — a commit in progress', () => {
	it('keeps the heartbeat while gate and round 2 run before a new commit', async () => {
		done_mock.mockReturnValue(new Set(['commit']))
		started_mock.mockReturnValue(['gate', 'round-2'])

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE, SHORT_CHUNK_MS)).resolves.toStrictEqual({
			verdict: VERDICT.PENDING,
		})
		expect(beat_mock).toHaveBeenCalledWith(ROOT, ISSUE)
		expect(leave_mock).not.toHaveBeenCalled()
	})

	it('keeps waiting while the attempt has started its commit but not finished it', async () => {
		done_mock.mockReturnValue(new Set(['review', 'gate']))
		started_mock.mockReturnValue(['review', 'gate', 'commit'])

		await expect(run_ship_wait_cli.wait_for(ROOT, ISSUE, SHORT_CHUNK_MS)).resolves.toStrictEqual({
			verdict: VERDICT.PENDING,
		})
		expect(done_mock).toHaveBeenCalled()
	})
})

describe('run_ship_wait_cli.run', () => {
	it('prints the verdict line, then the note', async () => {
		take_mock.mockReturnValue(NOTE)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(run_ship_wait_cli.run([ISSUE])).resolves.toBe(0)
		expect(info.mock.calls).toStrictEqual([
			[`${VERDICT.RETURNED} — the ship stopped: fix what the note below says, then ship again`],
			[NOTE],
		])
	})

	it('asks the session boundary again before a pending wait is re-issued', async () => {
		vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(Number.MAX_SAFE_INTEGER)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(run_ship_wait_cli.run([ISSUE])).resolves.toBe(0)
		expect(String(info.mock.calls[0]?.[0])).toMatch(
			/^pending — .*`pnpm josh cost --cut` `under`.*; else end the turn$/u,
		)
	})

	it('counts the chunk from the process start, so a long preflight leaves it no wait', async () => {
		vi.spyOn(performance, 'now').mockReturnValue(run_ship_wait_cli.CHUNK_MS)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(run_ship_wait_cli.run([ISSUE])).resolves.toBe(0)
		expect(beat_mock).not.toHaveBeenCalled()
		expect(String(info.mock.calls[0]?.[0])).toMatch(/^pending — /u)
	})

	it('refuses anything but one issue number', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(run_ship_wait_cli.run([ISSUE, '1'])).resolves.toBe(1)
		expect(error).toHaveBeenCalledOnce()
	})
})
