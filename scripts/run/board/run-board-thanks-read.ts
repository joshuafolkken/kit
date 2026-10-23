import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { timed_fetch } from '#scripts/lib/timed-fetch'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { z } from 'zod'
import { run_board_thanks_csv, type Thanks } from './run-board-thanks-csv'

// The roster `run:board` thanks its reviewers from: a Google spreadsheet published as CSV, changed
// apart from any build or release, so it is read at run time. Its answer is kept in the project's
// record beside the board's other state and reused for five minutes — Google's own cache holds it as
// long — so neither a redraw nor a fresh `--once` asks again inside that window. A read that fails
// keeps the last answer, and with none draws no line; nothing about the failure reaches the screen.

const ROSTER_URL =
	'https://docs.google.com/spreadsheets/d/e/2PACX-1vR8Ia38Wiw6Kfyk9Or594J8ZRS8okynV30CpOtq5B6_GyJG7A1-t8Au64jTYvmzgIOlbafcKKgrNFVJ/pub?gid=0&single=true&output=csv'
const RECORD_PREFIX = 'josh-run-board-thanks-'
const TTL_MINUTES = 5
const TTL_MS = TTL_MINUTES * MS_PER_MINUTE

const thanker_schema = z.object({ name: z.string(), url: z.string().optional() })
const record_schema = z.object({ checked_ms: z.number(), thanks: z.array(thanker_schema) })

interface ThanksRecord {
	checked_ms: number
	thanks: Thanks
}

// What the read works through, injected in tests.
interface ThanksDependencies {
	fetch_text: () => Promise<string>
	record_path: string
	now: () => number
}

function read_record(record_path: string): ThanksRecord | undefined {
	const raw = stamp_file.read_stamp_text(record_path)
	const parsed = raw === undefined ? undefined : json_value.parse_with(raw, record_schema)

	if (parsed === undefined) return undefined

	return {
		checked_ms: parsed.checked_ms,
		thanks: parsed.thanks.map(({ name, url }) => ({ name, url })),
	}
}

// A record that cannot be written leaves the next read to ask again — never a reason to fail the board.
function write_record(record_path: string, record: ThanksRecord): void {
	try {
		stamp_file.replace_stamp(record_path, record)
	} catch {
		// The board draws what it read either way.
	}
}

async function fetch_roster(read: () => Promise<string>): Promise<Thanks | undefined> {
	try {
		return run_board_thanks_csv.thanks_of(await read())
	} catch {
		return undefined
	}
}

// The recorded roster while it is younger than the record's life; `undefined` once it is stale. A
// record dated after now — the clock stepped back — is stale too, or it would hold until the clock
// caught up with it.
function fresh_thanks(record: ThanksRecord | undefined, now_ms: number): Thanks | undefined {
	if (record === undefined) return undefined

	const age_ms = now_ms - record.checked_ms

	return age_ms >= 0 && age_ms < TTL_MS ? record.thanks : undefined
}

// A response that is not a success is a failed read, so its body is never taken for the roster.
async function fetch_text(): Promise<string> {
	const response = await timed_fetch(ROSTER_URL)

	if (!response.ok) throw new Error(`roster read answered ${String(response.status)}`)

	return await response.text()
}

const LIVE_DEPS: ThanksDependencies = {
	fetch_text,
	record_path: stamp_file.stamp_path(RECORD_PREFIX, PROJECT_ROOT),
	now: () => Date.now(),
}

async function read_with(deps: ThanksDependencies): Promise<Thanks> {
	const now_ms = deps.now()
	const record = read_record(deps.record_path)
	const fresh = fresh_thanks(record, now_ms)

	if (fresh !== undefined) return fresh

	const thanks = (await fetch_roster(deps.fetch_text)) ?? record?.thanks ?? []

	write_record(deps.record_path, { checked_ms: now_ms, thanks })

	return thanks
}

async function read_thanks(deps: ThanksDependencies = LIVE_DEPS): Promise<Thanks> {
	return await read_with(deps)
}

const run_board_thanks_read = { TTL_MS, read_thanks }

export { run_board_thanks_read }
export type { ThanksDependencies }
