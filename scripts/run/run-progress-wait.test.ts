import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchOptions } from './run-progress-cli'
import type { ObservationRead } from './run-progress-read'

// joshuafolkken/kit#1576. `--wait` exists because a harness that only delivers a background command's
// standard output **when that command exits** relays nothing at all from a watcher that never exits —
// `epicrun #1474` was measured at 2h36m of silence with children in flight. So what is pinned here is
// the exit: one interval of silence, exactly one line, and a return. The interval is set in
// milliseconds so the wait is real without the suite waiting out a real one.

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

const { run_progress_read } = await import('./run-progress-read')
const { run_progress_cli } = await import('./run-progress-cli')

const mark = vi.mocked(run_progress_read.mark)
const read_last_report = vi.mocked(run_progress_read.read_last_report)
const read_observations = vi.mocked(run_progress_read.read_observations)
const stamp_target = vi.mocked(run_progress_read.stamp_target)

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-progress-wait-'))
const STAMP = path.join(TEMPORARY, 'stamp.json')
const MINUTE_MS = 60_000
const INTERVAL_MS = 20
const TICK_MS = 1
const MAX_MS = 5000
const BOUND_MS = 50
const QUIET_MINUTES = 21
const NOTHING = 0
const ONE_LINE = 1
const SUCCESS = 0

const OBSERVED: ObservationRead = {
	kind: 'observed',
	observations: {
		children: [{ issue: '1576', labels: ['in-progress'], pr_state: 'open' }],
		lanes: [],
		load_average: 1.5,
		record_age_ms: undefined,
	},
}

const output: { printed: Array<string>; warned: Array<string> } = { printed: [], warned: [] }

function options_of(overrides: Partial<WatchOptions> = {}): WatchOptions {
	return {
		interval_ms: INTERVAL_MS,
		max_ms: MAX_MS,
		output_paths: [],
		repo: 'joshuafolkken/kit',
		tick_ms: TICK_MS,
		...overrides,
	}
}

// A wait short enough to end on its own bound, for the two cases about what does *not* end it.
async function wait_bounded(): Promise<number> {
	return await run_progress_cli.wait_once(options_of({ max_ms: BOUND_MS }))
}

beforeEach(() => {
	output.printed = []
	output.warned = []
	vi.spyOn(console, 'info').mockImplementation((...args) => {
		output.printed.push(args.join(' '))
	})
	vi.spyOn(console, 'error').mockImplementation((...args) => {
		output.warned.push(args.join(' '))
	})
	stamp_target.mockResolvedValue(STAMP)
	read_last_report.mockReturnValue(undefined)
	read_observations.mockResolvedValue(OBSERVED)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('--wait — one interval, one line, and then it exits', () => {
	it('prints straight away when the run is already overdue', async () => {
		read_last_report.mockReturnValue(Date.now() - INTERVAL_MS)

		await expect(run_progress_cli.wait_once(options_of())).resolves.toBe(SUCCESS)
		expect(output.printed).toHaveLength(ONE_LINE)
	})

	// The regression the Issue was filed on: the caller needs the command to *end*, and to end having
	// said exactly one thing — a second line would be the double report joshuafolkken/kit#1570 removed.
	it('waits the interval out, then prints exactly one line and returns', async () => {
		await expect(run_progress_cli.wait_once(options_of())).resolves.toBe(SUCCESS)
		expect(output.printed).toHaveLength(ONE_LINE)
	})

	// The clock stays this command's: the line it printed is recorded, so the next `--wait` measures a
	// full interval from it and the caller never has to time anything itself.
	it('records the report it made', async () => {
		await expect(run_progress_cli.wait_once(options_of())).resolves.toBe(SUCCESS)
		expect(mark).toHaveBeenCalledTimes(ONE_LINE)
	})

	it('measures the silence from the last report on record', async () => {
		read_last_report.mockReturnValue(Date.now() - QUIET_MINUTES * MINUTE_MS)

		await expect(run_progress_cli.wait_once(options_of())).resolves.toBe(SUCCESS)
		expect(output.printed[0]).toContain(`quiet ${String(QUIET_MINUTES)}m`)
	})
})

describe('--wait — nothing to report is not something to exit on', () => {
	// Returning on a decline would hand the caller an instant answer, and the documented restart turns
	// that into a poll: `epicrun.md` says to start the next one in the same turn.
	it('keeps waiting while no child is in flight, and reports nothing', async () => {
		read_observations.mockResolvedValue({ kind: 'idle' })

		await expect(wait_bounded()).resolves.toBe(SUCCESS)
		expect(output.printed).toHaveLength(NOTHING)
		expect(mark).not.toHaveBeenCalled()
		// It ran to the bound rather than returning on the idle decline: the expiry notice is printed
		// only when the loop exhausts, so its presence is what rules out the last watcher's twin — the
		// first, started before any `in-progress` label, dying the instant the repository reads idle
		// (joshuafolkken/kit#1802).
		expect(output.warned).toContain(run_progress_cli.WAIT_EXPIRED_NOTICE)
	})

	it('ends on the watch bound when the run never goes quiet for a whole interval', async () => {
		read_last_report.mockImplementation(() => Date.now())

		await expect(wait_bounded()).resolves.toBe(SUCCESS)
		expect(output.printed).toHaveLength(NOTHING)
		expect(output.warned).toContain(run_progress_cli.WAIT_EXPIRED_NOTICE)
	})
})
