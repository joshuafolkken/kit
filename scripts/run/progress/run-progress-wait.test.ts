import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchOptions } from './run-progress-cli'
import type { ObservationRead } from './run-progress-read'

// joshuafolkken/kit#3102. `--wait` once ended at its first line so the session would relay it, which
// woke the orchestrating session once per heartbeat for a relay it could not change. What is pinned
// here is the opposite: a report goes to the event stream and the ambient log and **not** to standard
// output, and it does not end the wait — only an arrival, `josh followup` or the bound does. The
// interval is set in milliseconds so the wait is real without the suite waiting out a real one.

vi.mock('#scripts/gh/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: vi.fn(), get_repo_name_with_owner_within: vi.fn() },
}))
vi.mock('./run-progress-read', () => ({
	run_progress_read: {
		live_target: vi.fn(),
		mark: vi.fn(),
		read_last_report: vi.fn(),
		read_observations: vi.fn(),
		stamp_target: vi.fn(),
	},
}))
// The liveness record is mocked to stay present, so the bound is what ends these `--wait` cases rather
// than a `josh followup` that never ran; the record itself is exercised in `run-progress-clock.test.ts`.
vi.mock('./run-progress-clock', () => ({
	run_progress_clock: {
		begin_life: vi.fn(),
		is_life_ended: vi.fn(),
		ping_life: vi.fn(),
	},
}))

// The pick-up reading is mocked so a wait never reads the carry record or the backlog for real; the
// reading itself is exercised in `backlog-ready.test.ts`.
vi.mock('#scripts/backlog/backlog-ready', () => ({
	backlog_ready: { print_ready_line: vi.fn() },
}))
// The arrival probe's own reading is `backlog-arrival.test.ts`'s; here only its answer matters.
vi.mock('#scripts/backlog/backlog-arrival', () => ({
	backlog_arrival: { start: vi.fn() },
}))
// The stream append is the delivery path under test; the stream file itself is `run-event-stream`'s.
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit_heartbeat: vi.fn() },
}))

const { backlog_arrival } = await import('#scripts/backlog/backlog-arrival')
const { backlog_ready } = await import('#scripts/backlog/backlog-ready')
const { run_event_stream_emit } = await import('#scripts/run/event/run-event-stream-emit')
const { run_progress_read } = await import('./run-progress-read')
const { run_progress_clock } = await import('./run-progress-clock')
const { run_progress_cli } = await import('./run-progress-cli')

const mark = vi.mocked(run_progress_read.mark)
const read_last_report = vi.mocked(run_progress_read.read_last_report)
const read_observations = vi.mocked(run_progress_read.read_observations)
const stamp_target = vi.mocked(run_progress_read.stamp_target)
const live_target = vi.mocked(run_progress_read.live_target)
const is_life_ended = vi.mocked(run_progress_clock.is_life_ended)

const REPO = 'joshuafolkken/kit'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-progress-wait-'))
const STAMP = path.join(TEMPORARY, 'stamp.json')
const LIFE_STAMP = path.join(TEMPORARY, 'life.json')
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
		repo: REPO,
		children: [{ issue: '1576', title: 'Child title', labels: ['in-progress'], pr_state: 'open' }],
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
		repo: REPO,
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
	live_target.mockResolvedValue(LIFE_STAMP)
	is_life_ended.mockReturnValue(false)
	read_last_report.mockReturnValue(undefined)
	read_observations.mockResolvedValue(OBSERVED)
	vi.mocked(backlog_arrival.start).mockResolvedValue({ has_arrived: async () => false })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

// One report due at the first tick and none after: the seed and the first tick read a silence of
// `quiet_ms`, and every later tick reads a report just made, the way the real recorded clock would.
function report_once(quiet_ms: number): void {
	const last_ms = Date.now() - quiet_ms

	read_last_report
		.mockReturnValueOnce(last_ms)
		.mockReturnValueOnce(last_ms)
		.mockImplementation(() => Date.now())
}

// The line a report recorded — what the stream and the ambient log carry in place of standard output.
function recorded_line(): string | undefined {
	return mark.mock.calls[0]?.[2]
}

describe('--wait — a report reaches the stream without waking the caller', () => {
	// The regression the Issue was filed on: a report used to end the wait, and the exit was the wake.
	it('reports to the event stream and keeps waiting rather than exiting', async () => {
		report_once(INTERVAL_MS)

		await expect(wait_bounded()).resolves.toBe(SUCCESS)
		expect(run_event_stream_emit.emit_heartbeat).toHaveBeenCalledTimes(ONE_LINE)
		expect(output.warned).toContain(run_progress_cli.WAIT_EXPIRED_NOTICE)
	})

	// Standard output is what a background command hands the session on exit; a line there is one the
	// session would be tempted to relay, and the stream already carries it.
	it('keeps the report off standard output', async () => {
		report_once(INTERVAL_MS)

		await wait_bounded()

		expect(output.printed).toHaveLength(NOTHING)
	})

	// The clock stays this command's: the line it reported is recorded, so the next report waits a full
	// interval from it and the caller never has to time anything itself.
	it('records the report it made and streams that same line', async () => {
		report_once(QUIET_MINUTES * MINUTE_MS)

		await wait_bounded()

		expect(mark).toHaveBeenCalledTimes(ONE_LINE)
		expect(recorded_line()).toContain(`quiet ${String(QUIET_MINUTES)}m`)
		expect(run_event_stream_emit.emit_heartbeat).toHaveBeenCalledWith(recorded_line())
	})

	// joshuafolkken/kit#2452: every wake carries the pick-up reading, whether it arrived or ran out.
	it('prints the pick-up reading on every exit', async () => {
		await wait_bounded()
		await wait_bounded()

		expect(backlog_ready.print_ready_line).toHaveBeenCalledTimes(2)
	})

	it('builds the expiry notice from the `--wait` default rather than a hardcoded number', () => {
		expect(run_progress_cli.WAIT_EXPIRED_NOTICE).toContain(
			`${String(run_progress_cli.DEFAULT_WAIT_MAX_HOURS)} by default`,
		)
	})
})

describe('--wait — nothing to report is not something to exit on', () => {
	// Returning on a decline would hand the caller an instant answer, and the documented restart turns
	// that into a poll: `backlogrun-progress.md` restarts the watcher in the turn it exits.
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

// joshuafolkken/kit#2503: an issue opted in while children are in flight waited out the stall
// detector's ten minutes; the probe ends the wait instead, so the parent is woken to dispatch it.
describe('--wait — newly runnable work ends the wait early', () => {
	it('exits on an arrival before the interval, printing the pick-up reading and no progress line', async () => {
		read_last_report.mockImplementation(() => Date.now())
		vi.mocked(backlog_arrival.start).mockResolvedValue({ has_arrived: async () => true })

		await expect(run_progress_cli.wait_once(options_of())).resolves.toBe(SUCCESS)
		expect(output.printed).toHaveLength(NOTHING)
		expect(output.warned).not.toContain(run_progress_cli.WAIT_EXPIRED_NOTICE)
		expect(backlog_ready.print_ready_line).toHaveBeenCalledTimes(ONE_LINE)
	})

	it('keeps waiting while the probe sees nothing new', async () => {
		read_last_report.mockImplementation(() => Date.now())

		await expect(wait_bounded()).resolves.toBe(SUCCESS)
		expect(output.warned).toContain(run_progress_cli.WAIT_EXPIRED_NOTICE)
	})
})
