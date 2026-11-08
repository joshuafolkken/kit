import { describe, expect, it } from 'vitest'
import { run_board_quota_held, type QuotaPorts, type QuotaSource } from './run-board-quota-held'
import type { QuotaFile, QuotaProvider, QuotaReading } from './run-board-quota-read'
import { run_board_quota_spent } from './run-board-quota-spent'

// joshuafolkken/kit#6692: the usage row draws the reading taken last across the sampled files, not the
// newest file's — a lane log's mtime moves with every line while its `rate_limit_event` stays old.

const STALE_FILE = 'stale.log'
const FRESH_FILE = 'fresh.log'
const NEWER_MTIME = 20
const OLDER_MTIME = 10
const RESETS_MS = 1000
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']

interface Logged {
	head: QuotaReading
	tail: QuotaReading
}

// The newer-mtime file's log first, then the older-mtime file's.
type Logs = readonly [stale: Logged, fresh: Logged]

function reading_at(used_percent: number, taken_ms: number | undefined): QuotaReading {
	return { windows: [{ minutes: 300, used_percent, resets_ms: RESETS_MS }], taken_ms }
}

// The newer-mtime file's event is older than the older-mtime file's.
const STALE: Logged = { head: reading_at(40, 50), tail: reading_at(50, 100) }
const FRESH: Logged = { head: reading_at(45, 150), tail: reading_at(60, 200) }

const FILES: ReadonlyArray<QuotaFile> = [
	{ path: STALE_FILE, mtime_ms: NEWER_MTIME },
	{ path: FRESH_FILE, mtime_ms: OLDER_MTIME },
]

function logged_in(logs: Logs, path: string): Logged {
	return path === STALE_FILE ? logs[0] : logs[1]
}

// read_tail and read_head return the path; every file is done.
function source_of(logs: Logs): QuotaSource {
	return {
		find: async () => [...FILES],
		reading_of: (text) => logged_in(logs, text).tail,
		heads_of: (text) => [logged_in(logs, text).head],
		is_done: () => true,
	}
}

function ports_of(logs: Logs): QuotaPorts {
	const source = source_of(logs)

	return {
		sources: { claude: source, codex: source },
		read_tail: async (file) => file,
		read_head: async (file) => file,
		now: () => 0,
	}
}

async function read_of(provider: QuotaProvider, logs: Logs): Promise<QuotaReading | undefined> {
	const quotas = await run_board_quota_held.quota_reader(ports_of(logs))()

	return quotas[provider]
}

function untimed(logged: Logged): Logged {
	return {
		head: { ...logged.head, taken_ms: undefined },
		tail: { ...logged.tail, taken_ms: undefined },
	}
}

describe.each(PROVIDERS)('run_board_quota_held — the freshest %s reading', (provider) => {
	it('draws an older file holding a newer event over a newer file holding an older one', async () => {
		const reading = await read_of(provider, [STALE, FRESH])

		expect(reading?.windows).toStrictEqual(FRESH.tail.windows)
		expect(reading?.taken_ms).toBe(FRESH.tail.taken_ms)
	})

	it('keeps the spend per task the files tell, whichever reading is drawn', async () => {
		const logs: Logs = [STALE, FRESH]
		const tasks = logs.map((log) => ({ span: [log.head, log.tail], lane: undefined }))
		const ends = logs.map((log) => ({ end_ms: log.tail.taken_ms ?? 0, lane: undefined }))
		const expected = run_board_quota_spent.per_lane_of(tasks, ends)
		const reading = await read_of(provider, logs)

		expect(Object.keys(expected)).not.toHaveLength(0)
		expect(reading?.per_task).toStrictEqual(expected)
	})

	it('draws the newest file where no reading is timed', async () => {
		const reading = await read_of(provider, [untimed(STALE), untimed(FRESH)])

		expect(reading?.windows).toStrictEqual(STALE.tail.windows)
	})

	it('draws the newest file of two readings taken at the same time', async () => {
		const tied: Logged = { ...FRESH, tail: { ...FRESH.tail, taken_ms: STALE.tail.taken_ms } }
		const reading = await read_of(provider, [STALE, tied])

		expect(reading?.windows).toStrictEqual(STALE.tail.windows)
	})

	it('draws a timed reading over a newer file whose reading is untimed', async () => {
		const reading = await read_of(provider, [untimed(STALE), FRESH])

		expect(reading?.windows).toStrictEqual(FRESH.tail.windows)
	})
})
