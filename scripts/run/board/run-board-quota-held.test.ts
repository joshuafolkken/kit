import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_held, type QuotaPorts, type QuotaSource } from './run-board-quota-held'
import { run_board_quota_read, type QuotaFile, type QuotaReading } from './run-board-quota-read'
import { run_board_quota_status } from './run-board-quota-status'

const { QUOTA_INTERVAL_MS, quota_reader } = run_board_quota_held
const WINDOW = { minutes: 300, used_percent: 42, resets_ms: 1000 }
const FAILED = new Error('unreadable')
const CODEX_FILE = 'codex.jsonl'
const CLAUDE_FILE = 'claude.log'
const EMPTY_FILE = 'empty.log'
const TAKEN_MS = 5
const TAKEN = '2026-10-29T03:00:00Z'
const LATER = '2026-10-30T03:00:00Z'
const SPENT_FILES: Readonly<Record<string, readonly [number, number]>> = {
	a_log: [40, 46],
	b_log: [30, 32],
	c_log: [20, 23],
	running_log: [10, 30],
}
const RUNNING_FILE = 'running_log'

type Found = QuotaFile | Array<QuotaFile> | Error | undefined

interface Fixture {
	clock: { ms: number }
	files: { claude: Found; codex: Found }
	read_tail: ReturnType<typeof vi.fn<(file: string) => Promise<string>>>
	ports: QuotaPorts
}

function listed(found: Exclude<Found, Error>): Array<QuotaFile> {
	if (found === undefined) return []

	return Array.isArray(found) ? found : [found]
}

function reading_at(used_percent: number): QuotaReading {
	return { windows: [{ ...WINDOW, used_percent }], taken_ms: TAKEN_MS }
}

// read_tail and read_head return the path, so a file named EMPTY_FILE holds no reading, and a file
// SPENT_FILES names held its first percent at the head and its second at the tail; every file but
// RUNNING_FILE is done.
function source_of(file: () => Found): QuotaSource {
	return {
		find: async () => {
			const found = file()

			if (found instanceof Error) throw found

			return listed(found)
		},
		reading_of: (text) =>
			text === EMPTY_FILE ? undefined : reading_at(SPENT_FILES[text]?.[1] ?? WINDOW.used_percent),
		heads_of: (text) => [reading_at(SPENT_FILES[text]?.[0] ?? WINDOW.used_percent)],
		is_done: (tail) => tail !== RUNNING_FILE,
	}
}

function fixture_of(): Fixture {
	const clock = { ms: 0 }
	const files: Fixture['files'] = {
		claude: { path: CLAUDE_FILE, mtime_ms: 10 },
		codex: { path: CODEX_FILE, mtime_ms: 20 },
	}
	const read_tail = vi.fn(async (file: string): Promise<string> => file)
	const read_head = vi.fn(async (file: string): Promise<string> => file)
	const sources = { claude: source_of(() => files.claude), codex: source_of(() => files.codex) }

	return { clock, files, read_tail, ports: { sources, read_tail, read_head, now: () => clock.ms } }
}

function codex_event(timestamp?: string): string {
	const rate_limits = { primary: { used_percent: 42, window_minutes: 300, resets_at: 100 } }

	return JSON.stringify({ timestamp, payload: { rate_limits } })
}

function event_fixture(): Fixture {
	const fixture = fixture_of()

	fixture.ports.sources.codex.reading_of = run_board_quota_read.codex_reading
	fixture.read_tail.mockResolvedValue(codex_event(TAKEN))

	return fixture
}

describe('run_board_quota_held event time', () => {
	it('preserves event time on redraws and periodic reads after an unrelated append', async () => {
		const { clock, files, read_tail, ports } = event_fixture()
		const read = quota_reader(ports)
		const first = await read()

		read_tail.mockResolvedValue(`${codex_event(TAKEN)}\n${JSON.stringify({ timestamp: LATER })}`)
		files.codex = { path: CODEX_FILE, mtime_ms: 30 }
		clock.ms = QUOTA_INTERVAL_MS
		await read()
		await vi.waitFor(async () => {
			const refreshed = await read()

			expect(read_tail).toHaveBeenCalledTimes(3)
			expect(refreshed).not.toBe(first)
			expect(refreshed.codex).toEqual(first.codex)
		})
	})
})

describe('run_board_quota_held updated and missing event time', () => {
	it('updates observation time when a new usage event is appended', async () => {
		const { clock, files, read_tail, ports } = event_fixture()
		const read = quota_reader(ports)

		await read()
		read_tail.mockResolvedValue(codex_event(LATER))
		files.codex = { path: CODEX_FILE, mtime_ms: 30 }
		clock.ms = QUOTA_INTERVAL_MS
		await read()
		await vi.waitFor(async () => {
			const refreshed = await read()

			expect(refreshed.codex?.taken_ms).toBe(Date.parse(LATER))
		})
	})

	it('does not substitute file mtime for a missing event time', async () => {
		const { read_tail, ports } = event_fixture()

		read_tail.mockResolvedValue(codex_event())

		const quotas = await quota_reader(ports)()

		expect(quotas.codex).toMatchObject({ taken_ms: undefined })
	})
})

describe('run_board_quota_held live status source', () => {
	afterEach(() => vi.restoreAllMocks())

	it('connects a completed production rollout to the lane parser', async () => {
		const head = JSON.stringify({ type: 'session_meta', payload: { cwd: '/work/.kit-lanes/6375' } })

		vi.spyOn(run_board_quota_read, 'claude_files').mockResolvedValue([])
		vi.spyOn(run_board_quota_read, 'codex_files').mockResolvedValue([
			{ path: CODEX_FILE, mtime_ms: 0 },
		])
		vi.spyOn(run_board_quota_read, 'read_tail').mockResolvedValue(
			`${codex_event(TAKEN)}\n{"payload":{"type":"task_complete"}}`,
		)
		vi.spyOn(run_board_quota_read, 'read_head').mockResolvedValue(head)
		vi.spyOn(run_board_quota_status, 'read').mockResolvedValue(undefined)
		const lane = vi.spyOn(run_board_quota_read, 'codex_lane')

		await run_board_quota_held.live_quota_reader()()

		expect(lane).toHaveBeenCalledWith(head)
	})

	it('connects the shared status record to the production reader', async () => {
		const status = reading_at(WINDOW.used_percent)

		vi.spyOn(run_board_quota_read, 'claude_files').mockResolvedValue([])
		vi.spyOn(run_board_quota_read, 'codex_files').mockResolvedValue([])
		vi.spyOn(run_board_quota_status, 'read').mockResolvedValue(status)
		const quotas = await run_board_quota_held.live_quota_reader()()

		expect(quotas).toEqual({ claude: status, codex: undefined })
	})
})

describe('run_board_quota_held status record', () => {
	it('uses a newer status reading while keeping Codex independent', async () => {
		const { ports } = fixture_of()
		const status = { windows: [{ ...WINDOW, used_percent: 68 }], taken_ms: TAKEN_MS + 1 }

		ports.read_status = async () => status
		const quotas = await quota_reader(ports)()

		expect(quotas.claude).toEqual(status)
		expect(quotas.codex?.windows).toEqual([WINDOW])
	})

	it('reads status without a lane log and falls back when status is missing', async () => {
		const { files, ports } = fixture_of()

		files.claude = undefined
		ports.read_status = async () => reading_at(WINDOW.used_percent)
		const with_status = await quota_reader(ports)()

		expect(with_status.claude?.windows).toEqual([WINDOW])
		ports.read_status = async () => undefined
		const without_status = await quota_reader(ports)()

		expect(without_status.claude).toBeUndefined()
	})
})

describe('run_board_quota_held.quota_reader', () => {
	it('reads each provider once and draws the held readings on a redraw before the interval', async () => {
		const { clock, read_tail, ports } = fixture_of()
		const read = quota_reader(ports)

		expect(await read()).toEqual({
			claude: { windows: [WINDOW], taken_ms: TAKEN_MS },
			codex: { windows: [WINDOW], taken_ms: TAKEN_MS },
		})

		clock.ms = QUOTA_INTERVAL_MS - 1
		await read()

		expect(read_tail).toHaveBeenCalledTimes(2)
	})

	it('does not open a file again whose path and mtime are unchanged', async () => {
		const { clock, files, read_tail, ports } = fixture_of()
		const read = quota_reader(ports)

		await read()
		files.codex = { path: CODEX_FILE, mtime_ms: 30 }
		clock.ms = QUOTA_INTERVAL_MS
		await read()

		await vi.waitFor(() => {
			expect(read_tail).toHaveBeenCalledTimes(3)
		})
		expect(read_tail).toHaveBeenLastCalledWith(CODEX_FILE, run_board_quota_read.TAIL_BYTES)
	})

	it('reads a provider whose file cannot be found or read as none, the other all the same', async () => {
		const { files, ports } = fixture_of()

		files.claude = undefined
		files.codex = FAILED

		expect(await quota_reader(ports)()).toEqual({ claude: undefined, codex: undefined })

		const other = fixture_of()

		other.files.codex = FAILED

		const quotas = await quota_reader(other.ports)()

		expect(quotas.claude?.taken_ms).toBe(TAKEN_MS)
	})
})

describe('run_board_quota_held.quota_reader — a newest file holding no reading', () => {
	it('reads an older file when the newest holds no reading, opening neither again unchanged', async () => {
		const { clock, files, read_tail, ports } = fixture_of()

		files.claude = [
			{ path: EMPTY_FILE, mtime_ms: 50 },
			{ path: CLAUDE_FILE, mtime_ms: 10 },
		]

		const read = quota_reader(ports)
		const first = await read()

		expect(first.claude).toEqual({ windows: [WINDOW], taken_ms: TAKEN_MS })

		files.codex = { path: CODEX_FILE, mtime_ms: 30 }
		clock.ms = QUOTA_INTERVAL_MS
		await read()

		await vi.waitFor(() => {
			expect(read_tail).toHaveBeenCalledTimes(4)
		})
		expect(read_tail).toHaveBeenLastCalledWith(CODEX_FILE, run_board_quota_read.TAIL_BYTES)
	})

	it('reads a provider none of whose files holds a reading as none', async () => {
		const { files, ports } = fixture_of()

		files.claude = [{ path: EMPTY_FILE, mtime_ms: 50 }]

		const quotas = await quota_reader(ports)()

		expect(quotas.claude).toBeUndefined()
	})
})

describe('run_board_quota_held.quota_reader — lane metadata', () => {
	it('reads done heads for lane metadata and shares the spend per lane', async () => {
		const { files, ports } = fixture_of()
		const lane_of = vi.fn(() => '6375')

		ports.sources.codex.lane_of = lane_of
		files.codex = ['a_log', 'b_log', RUNNING_FILE].map((file, index) => ({
			path: file,
			mtime_ms: 50 - index,
		}))

		const { codex } = await quota_reader(ports)()

		expect(lane_of.mock.calls).toEqual([['a_log'], ['b_log']])
		expect(codex?.per_task).toEqual({ [WINDOW.minutes]: 16 })
	})
})

describe('run_board_quota_held.quota_reader — spend per task', () => {
	it("carries the newest files' shared rise per done file on the newest reading", async () => {
		const { files, ports } = fixture_of()

		files.claude = ['a_log', 'b_log', 'c_log', EMPTY_FILE].map((file, index) => ({
			path: file,
			mtime_ms: 50 - index,
		}))

		const { claude, codex } = await quota_reader(ports)()

		expect(claude).toEqual({ ...reading_at(46), per_task: { [WINDOW.minutes]: 26 / 3 } })
		expect(codex).not.toHaveProperty('per_task')
	})

	it('counts a done file whose readings did not rise among the files the rise is shared by', async () => {
		const { files, ports } = fixture_of()

		files.claude = [CLAUDE_FILE, CLAUDE_FILE, 'b_log'].map((file, index) => ({
			path: file,
			mtime_ms: 50 - index,
		}))

		const { claude } = await quota_reader(ports)()

		expect(claude?.per_task).toEqual({ [WINDOW.minutes]: 4 })
	})

	it('leaves out the spend of a file still being written', async () => {
		const { files, ports } = fixture_of()

		files.claude = [
			{ path: RUNNING_FILE, mtime_ms: 50 },
			{ path: 'a_log', mtime_ms: 40 },
		]

		const { claude } = await quota_reader(ports)()

		expect(claude?.per_task).toEqual({ [WINDOW.minutes]: 6 })
	})
})

describe('run_board_quota_held.quota_reader — the sample of done files', () => {
	it('reads past the newest files still being written to the done ones after them', async () => {
		const { files, ports } = fixture_of()

		files.claude = [RUNNING_FILE, RUNNING_FILE, RUNNING_FILE, 'a_log'].map((file, index) => ({
			path: file,
			mtime_ms: 50 - index,
		}))

		const { claude } = await quota_reader(ports)()

		expect(claude?.per_task).toEqual({ [WINDOW.minutes]: 6 })
	})

	it('shares an untimed rise by the SAMPLE_SIZE done files that tell it, not the ones after', async () => {
		const { files, ports } = fixture_of()
		const { SAMPLE_SIZE } = run_board_quota_read

		files.claude = Array.from({ length: SAMPLE_SIZE + 2 }, (_, index) => ({
			path: 'a_log',
			mtime_ms: 50 - index,
		}))
		files.codex = undefined

		const { claude } = await quota_reader(ports)()

		expect(claude?.per_task).toEqual({ [WINDOW.minutes]: 6 / SAMPLE_SIZE })
	})
})
