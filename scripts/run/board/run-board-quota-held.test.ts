import { describe, expect, it, vi } from 'vitest'
import { run_board_quota_held, type QuotaPorts, type QuotaSource } from './run-board-quota-held'
import { run_board_quota_read, type QuotaFile } from './run-board-quota-read'

const { QUOTA_INTERVAL_MS, quota_reader } = run_board_quota_held
const WINDOW = { minutes: 300, used_percent: 42, resets_ms: 1000 }
const FAILED = new Error('unreadable')
const CODEX_FILE = 'codex.jsonl'
const CLAUDE_FILE = 'claude.log'
const EMPTY_FILE = 'empty.log'

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

// read_tail returns the path, so a file named EMPTY_FILE holds no reading.
function source_of(file: () => Found): QuotaSource {
	return {
		find: async () => {
			const found = file()

			if (found instanceof Error) throw found

			return listed(found)
		},
		windows_of: (text) => (text === EMPTY_FILE ? [] : [WINDOW]),
	}
}

function fixture_of(): Fixture {
	const clock = { ms: 0 }
	const files: Fixture['files'] = {
		claude: { path: CLAUDE_FILE, mtime_ms: 10 },
		codex: { path: CODEX_FILE, mtime_ms: 20 },
	}
	const read_tail = vi.fn(async (file: string): Promise<string> => file)
	const sources = { claude: source_of(() => files.claude), codex: source_of(() => files.codex) }

	return { clock, files, read_tail, ports: { sources, read_tail, now: () => clock.ms } }
}

describe('run_board_quota_held.quota_reader', () => {
	it('reads each provider once and draws the held readings on a redraw before the interval', async () => {
		const { clock, read_tail, ports } = fixture_of()
		const read = quota_reader(ports)

		expect(await read()).toEqual({
			claude: { windows: [WINDOW], taken_ms: 10 },
			codex: { windows: [WINDOW], taken_ms: 20 },
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

		expect(quotas.claude?.taken_ms).toBe(10)
	})
})

describe('run_board_quota_held.quota_reader — a newest file holding no reading', () => {
	it('reads an older file when the newest holds no reading, and marks the older one', async () => {
		const { clock, files, read_tail, ports } = fixture_of()

		files.claude = [
			{ path: EMPTY_FILE, mtime_ms: 50 },
			{ path: CLAUDE_FILE, mtime_ms: 10 },
		]

		const read = quota_reader(ports)
		const first = await read()

		expect(first.claude).toEqual({ windows: [WINDOW], taken_ms: 10 })

		read_tail.mockClear()
		clock.ms = QUOTA_INTERVAL_MS
		await read()

		await vi.waitFor(() => {
			expect(read_tail).toHaveBeenCalledWith(EMPTY_FILE, run_board_quota_read.TAIL_BYTES)
		})
		expect(read_tail).not.toHaveBeenCalledWith(CLAUDE_FILE, expect.any(Number))
	})

	it('reads a provider none of whose files holds a reading as no windows at the newest mtime', async () => {
		const { files, ports } = fixture_of()

		files.claude = [{ path: EMPTY_FILE, mtime_ms: 50 }]

		const quotas = await quota_reader(ports)()

		expect(quotas.claude).toEqual({ windows: [], taken_ms: 50 })
	})
})
