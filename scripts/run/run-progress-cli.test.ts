import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchLoop, WatchOptions } from './run-progress-cli'
// joshuafolkken/kit#1520. The command's surface: the interval is configurable and disable-able, a
// real report is recorded with `--mark`, and a repository with nothing in flight is told apart from
// one whose listing could not be read. The watch loop is driven a tick at a time through `step`,
// which is what makes the guard around a failed reading, the once-per-streak notice and the read
// cooldown testable without waiting out a real interval.

import type { ObservationRead } from './run-progress-read'

vi.mock('#scripts/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: vi.fn(), get_repo_name_with_owner_within: vi.fn() },
}))
vi.mock('./run-progress-read', () => ({
	run_progress_read: {
		mark: vi.fn(),
		read_last_report: vi.fn(),
		read_observations: vi.fn(),
		stamp_target: vi.fn(),
	},
}))

const { gh_spawn } = await import('#scripts/gh-spawn')
const { PROJECT_ROOT: REPO_ROOT } = await import('#scripts/init/init-paths')
const { run_progress_read } = await import('./run-progress-read')
const { run_progress } = await import('./run-progress')
const { run_progress_cli } = await import('./run-progress-cli')

const repo_name = vi.mocked(gh_spawn.get_repo_name_with_owner_within)
const mark = vi.mocked(run_progress_read.mark)
const read_last_report = vi.mocked(run_progress_read.read_last_report)
const read_observations = vi.mocked(run_progress_read.read_observations)
const stamp_target = vi.mocked(run_progress_read.stamp_target)

const REPO = 'joshuafolkken/kit'
// A directory of this suite's own. A fixed name under the temp directory is shared by every suite
// running at once, which `scripts/shared-temporary-path.test.ts` refuses for exactly that reason.
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-progress-cli-'))
const STAMP = path.join(TEMPORARY, 'stamp.json')
const TRANSCRIPT = path.join(TEMPORARY, 'unit.jsonl')
const MINUTE = run_progress.MS_PER_MINUTE
const HOUR = 3_600_000
const IN_PROGRESS = 'in-progress'
const SPAWN_FAILURE = 'spawn git EAGAIN'
const INTERVAL_KEY = 'JOSH_PROGRESS_INTERVAL_MINUTES'
const DISABLE_KEY = 'JOSH_PROGRESS'

const output: { printed: Array<string>; warned: Array<string> } = { printed: [], warned: [] }

beforeEach(() => {
	output.printed = []
	output.warned = []
	vi.spyOn(console, 'info').mockImplementation((...args) => {
		output.printed.push(args.join(' '))
	})
	vi.spyOn(console, 'error').mockImplementation((...args) => {
		output.warned.push(args.join(' '))
	})
	repo_name.mockReturnValue(REPO)
	stamp_target.mockResolvedValue(STAMP)
	read_last_report.mockReturnValue(undefined)
	vi.stubEnv(DISABLE_KEY, '')
	vi.stubEnv(INTERVAL_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('the interval is configurable and disable-able', () => {
	// The whole order — flag, environment, the repository's committed field, then twenty — is
	// `run-progress-config.test.ts`. What belongs here is only that the CLI asks for it.
	it('takes the environment variable when no flag was typed', () => {
		vi.stubEnv(INTERVAL_KEY, '25')

		expect(run_progress_cli.to_interval_ms(undefined)).toBe(25 * MINUTE)
	})

	it('lets a typed flag outrank the environment', () => {
		vi.stubEnv(INTERVAL_KEY, '25')

		expect(run_progress_cli.to_interval_ms('5')).toBe(5 * MINUTE)
	})

	it('reports nothing at all when the reporting is switched off', async () => {
		vi.stubEnv(DISABLE_KEY, '0')

		await expect(run_progress_cli.run([])).resolves.toBe(0)
		expect(output.warned).toEqual([run_progress_cli.DISABLED_NOTICE])
		expect(output.printed).toEqual([])
		expect(read_observations).not.toHaveBeenCalled()
	})
})

describe('--mark — what keeps a heartbeat off the heels of a real report', () => {
	it('records a report and reads nothing else', async () => {
		await expect(run_progress_cli.run(['--mark'])).resolves.toBe(0)
		expect(mark).toHaveBeenCalledWith(STAMP, expect.any(Number))
		expect(read_observations).not.toHaveBeenCalled()
	})

	it('is honoured even while the reporting is switched off, so the clock stays true', async () => {
		vi.stubEnv(DISABLE_KEY, '0')

		await expect(run_progress_cli.run(['--mark'])).resolves.toBe(0)
		expect(mark).toHaveBeenCalled()
	})
})

describe('--once — one line now', () => {
	it('prints the observations it read and records the report', async () => {
		read_observations.mockResolvedValue({
			kind: 'observed',
			observations: {
				children: [{ issue: '1520', labels: [IN_PROGRESS], pr_state: 'open' }],
				lanes: [],
				load_average: 1.5,
				record_age_ms: undefined,
			},
		})

		await expect(run_progress_cli.run(['--once'])).resolves.toBe(0)
		expect(output.printed).toHaveLength(1)
		expect(output.printed[0]).toContain('#1520')
		expect(mark).toHaveBeenCalledWith(STAMP, expect.any(Number))
	})

	it('prints no line and records nothing when no child is in flight', async () => {
		read_observations.mockResolvedValue({ kind: 'idle' })

		await expect(run_progress_cli.run(['--once'])).resolves.toBe(0)
		expect(output.printed).toEqual([])
		expect(output.warned).toEqual([run_progress_cli.IDLE_NOTICE])
		expect(mark).not.toHaveBeenCalled()
	})

	it('exits non-zero on a listing it could not read, which is not "nothing is running"', async () => {
		read_observations.mockResolvedValue({ kind: 'unreadable' })

		await expect(run_progress_cli.run(['--once'])).resolves.toBe(1)
		expect(output.warned).toEqual([run_progress_cli.UNREADABLE_NOTICE])
		expect(mark).not.toHaveBeenCalled()
	})
})

describe('arguments', () => {
	it('refuses an unknown flag rather than watching with a setting nobody applied', async () => {
		await expect(run_progress_cli.run(['--every', '5'])).resolves.toBe(1)
		expect(output.warned).toEqual([run_progress_cli.USAGE])
	})

	it('collects every --output it was given', () => {
		const values = run_progress_cli.read_arguments(['--output', 'a.jsonl', '--output', 'b.jsonl'])

		expect(values?.output).toEqual(['a.jsonl', 'b.jsonl'])
	})

	it('stops rather than guessing when no repository can be resolved', async () => {
		repo_name.mockReturnValue(undefined)

		await expect(run_progress_cli.run(['--once'])).resolves.toBe(1)
		expect(output.warned).toEqual([run_progress_cli.USAGE])
	})

	it('caps an abandoned watcher at one hour by default', () => {
		// The value the bound is pinned to, not just `DEFAULT_MAX_HOURS * HOUR`, which would hold for any
		// default (joshuafolkken/kit#1802): a watcher left on an already-merged run is gone within the hour.
		expect(run_progress_cli.DEFAULT_MAX_HOURS).toBe(1)
		expect(run_progress_cli.to_max_ms(undefined)).toBe(HOUR)
	})

	it('takes a hand-typed cap, and falls back for one that is not a positive number', () => {
		expect(run_progress_cli.to_max_ms('2')).toBe(2 * HOUR)
		expect(run_progress_cli.to_max_ms('none')).toBe(run_progress_cli.DEFAULT_MAX_HOURS * HOUR)
	})

	it('builds the expiry notice from the default rather than a hardcoded number', () => {
		expect(run_progress_cli.WAIT_EXPIRED_NOTICE).toContain(
			`${String(run_progress_cli.DEFAULT_MAX_HOURS)} by default`,
		)
	})

	it('passes the transcript paths through to the reading', async () => {
		read_observations.mockResolvedValue({ kind: 'idle' })

		await run_progress_cli.run(['--once', '--output', TRANSCRIPT])

		expect(read_observations).toHaveBeenCalledWith(
			expect.objectContaining({ output_paths: [TRANSCRIPT], repo: REPO }),
		)
	})
})

const OPTIONS: WatchOptions = {
	interval_ms: 10 * MINUTE,
	max_ms: 8 * HOUR,
	output_paths: [],
	repo: REPO,
	tick_ms: 30_000,
}

const OBSERVED: ObservationRead = {
	kind: 'observed',
	observations: {
		children: [{ issue: '1520', labels: [IN_PROGRESS], pr_state: 'open' }],
		lanes: [],
		load_average: 1,
		record_age_ms: undefined,
	},
}

function loop_at(last_ms: number, overrides: Partial<WatchLoop> = {}): WatchLoop {
	return { ...run_progress_cli.FRESH_LOOP, last_ms, ...overrides }
}

describe('the watch loop — one tick at a time', () => {
	it('reads nothing while the run has not been silent for the interval', async () => {
		const now = Date.now()
		const next = await run_progress_cli.step(OPTIONS, STAMP, loop_at(now))

		expect(read_observations).not.toHaveBeenCalled()
		expect(output.printed).toEqual([])
		expect(next.last_ms).toBe(now)
	})

	it('picks up a mark another process wrote, so a heartbeat cannot follow a real report', async () => {
		const now = Date.now()

		read_last_report.mockReturnValue(now)

		const next = await run_progress_cli.step(OPTIONS, STAMP, loop_at(now - 30 * MINUTE))

		expect(read_observations).not.toHaveBeenCalled()
		expect(next.last_ms).toBe(now)
	})

	it('prints and records the report once the silence has run long enough', async () => {
		read_observations.mockResolvedValue(OBSERVED)

		const next = await run_progress_cli.step(OPTIONS, STAMP, loop_at(Date.now() - 30 * MINUTE))

		expect(output.printed).toHaveLength(1)
		expect(mark).toHaveBeenCalledWith(STAMP, expect.any(Number))
		expect(next.retry_at_ms).toBe(0)
		expect(next.state).toBeDefined()
	})
})

describe('the watch loop — when a tick produces nothing', () => {
	it('says why a tick printed nothing, and leaves the report clock where it was', async () => {
		read_observations.mockResolvedValue({ kind: 'unreadable' })

		const last = Date.now() - 30 * MINUTE
		const next = await run_progress_cli.step(OPTIONS, STAMP, loop_at(last))

		expect(output.printed).toEqual([])
		expect(output.warned).toEqual([run_progress_cli.UNREADABLE_NOTICE])
		expect(mark).not.toHaveBeenCalled()
		expect(next.last_ms).toBe(last)
		expect(next.retry_at_ms).toBeGreaterThan(Date.now())
	})

	it('says a repeating reason once per streak rather than once per attempt', async () => {
		read_observations.mockResolvedValue({ kind: 'idle' })

		const first = await run_progress_cli.step(OPTIONS, STAMP, loop_at(Date.now() - 30 * MINUTE))

		await run_progress_cli.step(OPTIONS, STAMP, { ...first, retry_at_ms: 0 })

		expect(output.warned).toEqual([run_progress_cli.IDLE_NOTICE])
	})
})

describe('the watch loop — the decline streak and its cooldown', () => {
	// Two unrelated outages either side of a quiet period are two streaks, not one. Deduplicating the
	// second against the first would leave the watcher silent through a permanent failure — the state
	// the notice exists to prevent.
	it('ends a decline streak at the first tick that was not due', async () => {
		read_observations.mockResolvedValue({ kind: 'unreadable' })

		const declined = await run_progress_cli.step(OPTIONS, STAMP, loop_at(Date.now() - 30 * MINUTE))

		read_last_report.mockReturnValue(Date.now())

		const quiet = await run_progress_cli.step(OPTIONS, STAMP, { ...declined, retry_at_ms: 0 })

		expect(quiet.said).toBeUndefined()

		read_last_report.mockReturnValue(undefined)
		await run_progress_cli.step(OPTIONS, STAMP, { ...quiet, last_ms: Date.now() - 30 * MINUTE })

		expect(output.warned).toEqual([
			run_progress_cli.UNREADABLE_NOTICE,
			run_progress_cli.UNREADABLE_NOTICE,
		])
	})

	it('reads nothing at all while a cooldown is running', async () => {
		const loop = loop_at(Date.now() - 30 * MINUTE, { retry_at_ms: Date.now() + MINUTE })

		await run_progress_cli.step(OPTIONS, STAMP, loop)

		expect(read_observations).not.toHaveBeenCalled()
	})

	// The failure the guard exists for: a reading that spawns a process cannot fork under load, which
	// is the load this command is there to report. Without the guard the watcher would end here.
	it('survives a reading that threw, and says so', async () => {
		read_observations.mockRejectedValue(new Error(SPAWN_FAILURE))

		const next = await run_progress_cli.step(OPTIONS, STAMP, loop_at(Date.now() - 30 * MINUTE))

		expect(output.warned[0]).toContain(run_progress_cli.FAILED_TICK_PREFIX)
		expect(output.warned[0]).toContain(SPAWN_FAILURE)
		expect(next.retry_at_ms).toBeGreaterThan(Date.now())
	})
})

// `scripts/git/telegram-notify.ts` is the only Telegram egress there is, so "this command cannot
// notify" is a question about imports rather than a promise in prose.
//
// **What this asserts is the direct import of every module the command reaches**, its own three plus
// the four readers they pull in — not a full transitive closure, which would drag in most of
// `scripts/` and stop telling anyone anything. That set is where such an import would realistically
// appear, and it is the set a regression here would have to go through.
describe('it cannot reach Telegram', () => {
	it.each([
		'scripts/run/run-progress-cli.ts',
		'scripts/run/run-progress-read.ts',
		'scripts/run/run-progress.ts',
		'scripts/epic/epic-busy.ts',
		'scripts/lane/lane-registry.ts',
		'scripts/lane/lane-report.ts',
		'scripts/run/run-preflight.ts',
	])('%s imports no notification module', (source_path) => {
		expect(readFileSync(path.join(REPO_ROOT, source_path), 'utf8')).not.toMatch(
			/^import[^\n]*telegram/mu,
		)
	})
})
