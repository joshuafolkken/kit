import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { agent_provider } from '#scripts/agent/agent-provider'
import { codex_home_source } from '#scripts/agent/codex-home-source'
import { durable_state } from '#scripts/josh/durable-state'
import { figure_format } from '#scripts/lib/figure-format'
import { json_value } from '#scripts/lib/json-value'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_instant } from '#scripts/time-runtime/time-instant'
import { z } from 'zod'

// The usage-limit windows Claude Code and Codex last reported, read off files they already write — no
// API is asked (joshuafolkken/kit#5395). Claude's come from a lane child's stream-json log, the last
// `rate_limit_event`; Codex's from its newest rollout, the last `rate_limits`. Each is read off the
// newest file's tail, widened until it holds such a line or reaches its limit, and a file that is
// missing, unreadable or holds no such line reads as none.

const MS_PER_SECOND = 1000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY
const SHORT_WINDOW_HOURS = 5
const FIVE_HOURS_MINUTES = SHORT_WINDOW_HOURS * MINUTES_PER_HOUR
const DAYS_PER_WEEK = 7
const SEVEN_DAYS_MINUTES = DAYS_PER_WEEK * MINUTES_PER_DAY
const PERCENT = 100
// The tail first read, widened by `TAIL_GROWTH` up to `TAIL_LIMIT_BYTES`: Claude writes a
// `rate_limit_event` only now and then, and a lane log runs megabytes of tool output past its last.
const TAIL_BYTES = 262_144
const TAIL_GROWTH = 8
const TAIL_LIMIT_BYTES = TAIL_BYTES * TAIL_GROWTH * TAIL_GROWTH
// The done files a provider's spend per task is averaged over (joshuafolkken/kit#5618), and the newest
// files looked through for them, newest first — bounding the reads when few are done or Claude's.
const SAMPLE_SIZE = 10
const SCAN_FACTOR = 3
const FILES_SCANNED = SAMPLE_SIZE * SCAN_FACTOR
const MS_PER_DAY = MINUTES_PER_DAY * MINUTES_PER_HOUR * MS_PER_SECOND
const CLAUDE_MARK = '"rate_limit_event"'
const CODEX_MARK = '"rate_limits":{'
const CODEX_PREFIX = 'rollout-'
const CODEX_SUFFIX = '.jsonl'
const LOG_SUFFIX = '.log'
const TIMESTAMP_MARK = '"timestamp"'
// `detached_launch.log_header`'s shape — `=== <time> · started by process <pid> · <command>[ · <profile>] ===`.
const LAUNCH_HEADER = /^=== (?<stamp>\S+) · started by process /u
// Every launch header of a log, and the `provider=<p>` of the profile suffix a header may carry.
const LAUNCH_HEADERS = /^=== \S+ · started by process .*$/gmu
const HEADER_PROVIDER = / · provider=(?<provider>\S+)/u
const { two_digits } = figure_format

type QuotaProvider = 'claude' | 'codex'

interface QuotaWindow {
	minutes: number
	used_percent: number
	resets_ms: number
}

// A provider's windows and when they were observed; `per_task` is each window's recent spend per task
// by its length in minutes, where one could be told. Codex's event carries its own `timestamp`; Claude
// Code's `rate_limit_event` carries none, so its time is the nearest timed line before it.
interface QuotaReading {
	windows: ReadonlyArray<QuotaWindow>
	taken_ms: number | undefined
	per_task?: Readonly<Record<number, number>> | undefined
}

// Each provider's reading, `undefined` where none could be read.
type Quotas = Readonly<Record<QuotaProvider, QuotaReading | undefined>>

// A provider's newest file and when it was last written.
interface QuotaFile {
	path: string
	mtime_ms: number
}

const CLAUDE_WINDOW = z.looseObject({ utilization: z.number(), resetsAt: z.number() })
const CLAUDE_WINDOWS = z.looseObject({
	five_hour: CLAUDE_WINDOW.optional(),
	seven_day: CLAUDE_WINDOW.optional(),
})
const CLAUDE_INFO = z.looseObject({ unifiedWindows: CLAUDE_WINDOWS })
const CLAUDE_EVENT = z.looseObject({
	type: z.literal('rate_limit_event'),
	rate_limit_info: CLAUDE_INFO,
	timestamp: z.string().nullish().catch(undefined),
})
const CODEX_WINDOW = z.looseObject({
	used_percent: z.number(),
	window_minutes: z.number(),
	resets_at: z.number(),
})
const CODEX_LIMITS = z.looseObject({
	primary: CODEX_WINDOW.nullish(),
	secondary: CODEX_WINDOW.nullish(),
})
// `rate_limits: null` fails it, so a rollout holding only those reads as none.
const CODEX_EVENT = z.looseObject({
	payload: z.looseObject({ rate_limits: CODEX_LIMITS }),
	timestamp: z.string().nullish().catch(undefined),
})
const TIMED_LINE = z.looseObject({ timestamp: z.string() })

type ClaudeWindow = z.infer<typeof CLAUDE_WINDOW>
type CodexWindow = z.infer<typeof CODEX_WINDOW>

function claude_window(minutes: number, window: ClaudeWindow | undefined): Array<QuotaWindow> {
	if (window === undefined) return []

	const resets_ms = window.resetsAt * MS_PER_SECOND

	// A whole percent, as Claude reports it: `0.07 * 100` reads 7.000000000000001 otherwise.
	return [{ minutes, used_percent: Math.round(window.utilization * PERCENT), resets_ms }]
}

function claude_line(line: string): QuotaReading | undefined {
	if (!line.includes(CLAUDE_MARK)) return undefined

	const event = json_value.parse_with(line, CLAUDE_EVENT)

	if (event === undefined) return undefined

	const { five_hour, seven_day } = event.rate_limit_info.unifiedWindows

	return {
		windows: [
			...claude_window(FIVE_HOURS_MINUTES, five_hour),
			...claude_window(SEVEN_DAYS_MINUTES, seven_day),
		],
		taken_ms: time_instant.parse_instant(event.timestamp),
	}
}

function codex_window(window: CodexWindow | null | undefined): Array<QuotaWindow> {
	if (window === undefined || window === null) return []

	const { used_percent, window_minutes, resets_at } = window

	return [{ minutes: window_minutes, used_percent, resets_ms: resets_at * MS_PER_SECOND }]
}

function codex_line(line: string): QuotaReading | undefined {
	if (!line.includes(CODEX_MARK)) return undefined

	const event = json_value.parse_with(line, CODEX_EVENT)

	if (event === undefined) return undefined

	const { primary, secondary } = event.payload.rate_limits

	return {
		windows: [...codex_window(primary), ...codex_window(secondary)],
		taken_ms: time_instant.parse_instant(event.timestamp),
	}
}

function readings_in(
	text: string,
	line_of: (line: string) => QuotaReading | undefined,
): Array<QuotaReading> {
	return text
		.split('\n')
		.map((line) => line_of(line))
		.filter((reading) => reading !== undefined)
}

function json_ms(line: string): number | undefined {
	if (!line.includes(TIMESTAMP_MARK)) return undefined

	return time_instant.parse_instant(json_value.parse_with(line, TIMED_LINE)?.timestamp)
}

// The time a line carries: the launcher's header's, or a JSON line's own `timestamp`.
function line_ms(line: string): number | undefined {
	const stamp = LAUNCH_HEADER.exec(line)?.groups?.['stamp']

	return stamp === undefined ? json_ms(line) : time_instant.parse_instant(stamp)
}

// The nearest time among `lines` before `index`; the header heads the log, so it is reached last.
function time_before(lines: ReadonlyArray<string>, index: number): number | undefined {
	const timed = lines.slice(0, index).findLast((line) => line_ms(line) !== undefined)

	return timed === undefined ? undefined : line_ms(timed)
}

// Windows and time from the same last event; unrelated later lines never refresh its age.
function claude_reading(text: string): QuotaReading | undefined {
	const lines = text.split('\n')
	const index = lines.findLastIndex((line) => claude_line(line) !== undefined)
	const reading = claude_line(lines[index] ?? '')

	if (reading === undefined || reading.taken_ms !== undefined) return reading

	return { ...reading, taken_ms: time_before(lines, index) }
}

function codex_reading(text: string): QuotaReading | undefined {
	return readings_in(text, codex_line).at(-1)
}

// Every event's reading, oldest first, which a file's head is read for.
function claude_heads(text: string): Array<QuotaReading> {
	return readings_in(text, claude_line)
}

function codex_heads(text: string): Array<QuotaReading> {
	return readings_in(text, codex_line)
}

async function names_in(directory: string): Promise<Array<string>> {
	try {
		return await readdir(directory)
	} catch {
		return []
	}
}

async function file_of(file: string): Promise<Array<QuotaFile>> {
	try {
		const { mtimeMs: mtime_ms } = await stat(file)

		return [{ path: file, mtime_ms }]
	} catch {
		return []
	}
}

// The files of `directory` that `is_wanted`, each with when it was written; none where unreadable.
async function files_in(
	directory: string,
	is_wanted: (name: string) => boolean,
): Promise<Array<QuotaFile>> {
	const names = await names_in(directory)
	const wanted = names.filter((name) => is_wanted(name))
	const files = await Promise.all(
		wanted.map(async (name) => await file_of(path.join(directory, name))),
	)

	return files.flat()
}

function sorted(files: ReadonlyArray<QuotaFile>): Array<QuotaFile> {
	return files.toSorted((left, right) => right.mtime_ms - left.mtime_ms)
}

// The `FILES_SCANNED` newest of `files`, newest first.
function newest(files: ReadonlyArray<QuotaFile>): Array<QuotaFile> {
	return sorted(files).slice(0, FILES_SCANNED)
}

function is_lane_log(name: string): boolean {
	return name.startsWith(durable_state.PREFIX.LANE_DISPATCH) && name.endsWith(LOG_SUFFIX)
}

// The provider a log's last launch header names; `undefined` where it names none.
function last_provider(text: string): string | undefined {
	const header = text.match(LAUNCH_HEADERS)?.at(-1) ?? ''

	return HEADER_PROVIDER.exec(header)?.groups?.['provider']
}

// Whether a log's last launch ran Claude: a header naming no provider predates the profile suffix,
// when every lane child was Claude's.
function is_claude_launch(text: string): boolean {
	const provider = last_provider(text)

	return provider === undefined || provider === agent_provider.ANTHROPIC_PROVIDER
}

// Whether a log's last launch ran Claude, by its path and `mtime`: a log is read whole once per write.
const CLAUDE_LAUNCHES = new Map<string, { mtime_ms: number; is_claude: boolean }>()

async function read_claude_launch(file: QuotaFile): Promise<boolean> {
	const known = CLAUDE_LAUNCHES.get(file.path)

	if (known?.mtime_ms === file.mtime_ms) return known.is_claude

	const is_claude = is_claude_launch(await readFile(file.path, 'utf8'))

	CLAUDE_LAUNCHES.set(file.path, { mtime_ms: file.mtime_ms, is_claude })

	return is_claude
}

async function claude_log(file: QuotaFile): Promise<Array<QuotaFile>> {
	try {
		return (await read_claude_launch(file)) ? [file] : []
	} catch {
		return []
	}
}

// The newest logs of lane children Claude ran, in the run-state directory. A Codex child logs under
// the same name and writes no `rate_limit_event`, so its logs are passed over by their last header.
async function claude_files(root: string = durable_state.root()): Promise<Array<QuotaFile>> {
	const scanned = newest(await files_in(root, is_lane_log))
	const claude = await Promise.all(scanned.map(async (file) => await claude_log(file)))

	return claude.flat()
}

function is_rollout(name: string): boolean {
	return name.startsWith(CODEX_PREFIX) && name.endsWith(CODEX_SUFFIX)
}

// Codex's `sessions/YYYY/MM/DD` directory for the local day `ms` falls on.
function day_directory(sessions: string, ms: number): string {
	const date = new Date(ms)
	const month = two_digits(date.getMonth() + 1)

	return path.join(sessions, String(date.getFullYear()), month, two_digits(date.getDate()))
}

function codex_home(): string {
	return process.env['CODEX_HOME'] ?? codex_home_source.default_home()
}

// The newest rollout files of the last `DAYS_PER_WEEK` days — never the whole `sessions` tree. A session
// signed in with an API key writes only `rate_limits: null`, so the newest alone may hold no reading.
async function codex_files(now_ms: number, home = codex_home()): Promise<Array<QuotaFile>> {
	const sessions = path.join(home, 'sessions')
	const back = Array.from({ length: DAYS_PER_WEEK }, (_, day) => now_ms - day * MS_PER_DAY)
	const days = back.map((ms) => day_directory(sessions, ms))
	const found = await Promise.all(days.map(async (day) => await files_in(day, is_rollout)))

	return newest(found.flat())
}

async function read_tail(file: string, bytes: number = TAIL_BYTES): Promise<string> {
	return time_density_hook.read_tail(file, bytes)
}

// The first `bytes` of `file`; only the bytes read are decoded.
async function read_head(file: string, bytes: number = TAIL_BYTES): Promise<string> {
	const handle = await open(file, 'r')

	try {
		const buffer = Buffer.alloc(bytes)
		const { bytesRead: read } = await handle.read(buffer, 0, bytes, 0)

		return buffer.subarray(0, read).toString('utf8')
	} finally {
		await handle.close()
	}
}

// Whether a tail of `bytes` ends the widening: it found a reading, held the whole file, or reached the limit.
function is_last_tail(reading: QuotaReading | undefined, text: string, bytes: number): boolean {
	return (
		(reading?.windows.length ?? 0) > 0 ||
		Buffer.byteLength(text) < bytes ||
		bytes >= TAIL_LIMIT_BYTES
	)
}

// The reading off the widest tail needed to find an event with windows.
async function reading_in(
	tail_of: (bytes: number) => Promise<string>,
	reading_of: (text: string) => QuotaReading | undefined,
	bytes = TAIL_BYTES,
): Promise<QuotaReading | undefined> {
	const text = await tail_of(bytes)
	const reading = reading_of(text)

	if (is_last_tail(reading, text, bytes)) return reading

	return await reading_in(tail_of, reading_of, bytes * TAIL_GROWTH)
}

const run_board_quota_read = {
	FILES_SCANNED,
	FIVE_HOURS_MINUTES,
	SAMPLE_SIZE,
	SEVEN_DAYS_MINUTES,
	TAIL_BYTES,
	TAIL_LIMIT_BYTES,
	claude_files,
	claude_heads,
	claude_reading,
	codex_files,
	codex_heads,
	codex_reading,
	read_head,
	read_tail,
	reading_in,
}

export { run_board_quota_read }
export type { QuotaFile, QuotaProvider, QuotaReading, QuotaWindow, Quotas }
