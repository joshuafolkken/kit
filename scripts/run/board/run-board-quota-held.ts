import { run_board_held } from './run-board-held'
import {
	run_board_quota_read,
	type QuotaFile,
	type QuotaProvider,
	type QuotaReading,
	type Quotas,
} from './run-board-quota-read'
import { run_board_quota_spent, type QuotaEnd, type QuotaSpan } from './run-board-quota-spent'
import { run_board_quota_status } from './run-board-quota-status'

// The usage-limit gauges' readings as the board holds them (joshuafolkken/kit#5395): a redraw draws
// the held readings and reads no file; once a minute one read runs in the background
// (`run-board-held.ts`), and a provider's newest file it finds unchanged since the last read — the same
// path and `mtime` — is not opened again. A provider's newest file may hold no reading (a Codex child's
// lane log, a rollout of an API-key session), so the reading is the one taken last among those that
// hold one. A done file's head is read too, for the spend per task of `run-board-quota-spent.ts`, and
// files are read newest first until enough done ones tell it, then back for the tasks done across
// their rise.

const QUOTA_INTERVAL_MS = 60_000
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']
const NO_QUOTAS: Quotas = { claude: undefined, codex: undefined }

// Where a provider's readings come from: its newest files, newest first, the windows a tail of one
// holds, those each event of its head held, and whether a tail ends a done file.
interface QuotaSource {
	find: (limit: number) => Promise<Array<QuotaFile>>
	reading_of: (text: string) => QuotaReading | undefined
	heads_of: (text: string) => Array<QuotaReading>
	is_done: (tail: string) => boolean
	lane_of?: (head: string) => string | undefined
}

interface QuotaPorts {
	sources: Readonly<Record<QuotaProvider, QuotaSource>>
	read_tail: (file: string, bytes: number) => Promise<string>
	read_head: (file: string, bytes: number) => Promise<string>
	now: () => number
	read_status?: () => Promise<QuotaReading | undefined>
}

// A file a provider was last read off, what its tail read and, once done, the readings it holds.
interface QuotaMark {
	file: QuotaFile
	reading: QuotaReading | undefined
	span: QuotaSpan
	lane: string | undefined
}

type QuotaMarks = Map<QuotaProvider, ReadonlyArray<QuotaMark>>

function is_unchanged(marked: QuotaFile, file: QuotaFile): boolean {
	return marked.path === file.path && marked.mtime_ms === file.mtime_ms
}

function known_mark(marked: ReadonlyArray<QuotaMark>, file: QuotaFile): QuotaMark | undefined {
	return marked.find((candidate) => is_unchanged(candidate.file, file))
}

// The reading off the widest tail needed, and whether the file is done by its first tail's last line.
async function tail_of(
	file: QuotaFile,
	source: QuotaSource,
	ports: QuotaPorts,
): Promise<{ reading: QuotaReading | undefined; is_done: boolean }> {
	const tails: Array<string> = []
	const reading = await run_board_quota_read.reading_in(async (bytes) => {
		const tail = await ports.read_tail(file.path, bytes)

		tails.push(tail)

		return tail
	}, source.reading_of)

	return { reading, is_done: source.is_done(tails[0] ?? '') }
}

async function file_mark(
	file: QuotaFile,
	source: QuotaSource,
	ports: QuotaPorts,
	marked: ReadonlyArray<QuotaMark>,
): Promise<QuotaMark> {
	const mark = known_mark(marked, file)

	if (mark !== undefined) return mark

	const { reading, is_done } = await tail_of(file, source, ports)

	if (!is_done) return { file, reading, span: [], lane: undefined }

	const head = await ports.read_head(file.path, run_board_quota_read.TAIL_BYTES)

	return {
		file,
		reading,
		span: run_board_quota_spent.span_of(source.heads_of(head), reading),
		lane: source.lane_of?.(head),
	}
}

function is_told(mark: QuotaMark): boolean {
	return (mark.span.at(-1)?.windows.length ?? 0) > 0
}

// The marks of `files`, newest first, read one by one until `SAMPLE_SIZE` of them tell a spend: a
// file not done, or holding no reading, is passed over (joshuafolkken/kit#5618).
async function sampled(
	files: ReadonlyArray<QuotaFile>,
	mark_of: (file: QuotaFile) => Promise<QuotaMark>,
	told = 0,
): Promise<Array<QuotaMark>> {
	const [file, ...rest] = files

	if (file === undefined || told >= run_board_quota_read.SAMPLE_SIZE) return []

	const mark = await mark_of(file)

	return [mark, ...(await sampled(rest, mark_of, is_told(mark) ? told + 1 : told))]
}

// The time a done file's last reading was taken.
function end_of(mark: QuotaMark): Array<QuotaEnd> {
	const end_ms = mark.span.at(-1)?.taken_ms

	return end_ms === undefined ? [] : [{ end_ms, lane: mark.lane }]
}

// The oldest time the sample's done files were read at, where any was timed.
function since_of(marks: ReadonlyArray<QuotaMark>): number | undefined {
	const times = marks.flatMap((mark) => mark.span.flatMap((reading) => reading.taken_ms ?? []))

	return times.length === 0 ? undefined : Math.min(...times)
}

// The marks of `files`, newest first, up to and including the first done one that ended before `since`.
async function marks_back(
	files: ReadonlyArray<QuotaFile>,
	mark_of: (file: QuotaFile) => Promise<QuotaMark>,
	since: number,
): Promise<Array<QuotaMark>> {
	const [file, ...rest] = files

	if (file === undefined) return []

	const mark = await mark_of(file)
	const is_before = end_of(mark).some((end) => end.end_ms < since)

	return [mark, ...(is_before ? [] : await marks_back(rest, mark_of, since))]
}

interface ReadBack {
	find: (limit: number) => Promise<Array<QuotaFile>>
	mark_of: (file: QuotaFile) => Promise<QuotaMark>
	since: number
}

// The files done since the sample's oldest reading, which its rise was spent by
// (joshuafolkken/kit#5826): the list is widened until a file ended before it, every file is listed, or
// `FILES_LIMIT` is reached. A wider list goes on past the files the narrower one read; every file is
// listed once widening adds none; a source may return a short page without exhausting its results.
async function read_back(
	back: ReadBack,
	limit: number,
	read: ReadonlyArray<QuotaMark> = [],
): Promise<Array<QuotaMark>> {
	const files = await back.find(limit)
	const all = [...read, ...(await marks_back(files.slice(read.length), back.mark_of, back.since))]
	const is_reached = all.length < files.length || files.length === read.length

	if (is_reached || limit >= run_board_quota_read.FILES_LIMIT) return all

	return await read_back(back, limit * run_board_quota_read.SCAN_FACTOR, all)
}

function taken_of(reading: QuotaReading): number {
	return reading.taken_ms ?? -Infinity
}

// The reading holding windows that was taken last, not the newest file's: a lane log's mtime moves with
// every line, while Claude writes a `rate_limit_event` only now and then (joshuafolkken/kit#6692). An
// untimed reading loses to a timed one; a tie keeps the newer file's.
function freshest(marks: ReadonlyArray<QuotaMark>): QuotaReading | undefined {
	const readings = marks.flatMap(({ reading }) =>
		reading !== undefined && reading.windows.length > 0 ? [reading] : [],
	)
	const latest = Math.max(...readings.map((reading) => taken_of(reading)))

	return readings.find((reading) => taken_of(reading) === latest)
}

// The freshest reading that holds windows, with each window's spend per task where told.
function reading_with(
	marks: ReadonlyArray<QuotaMark>,
	ends: ReadonlyArray<QuotaEnd>,
): QuotaReading | undefined {
	const reading = freshest(marks)

	if (reading === undefined) return undefined

	const per_task = run_board_quota_spent.per_lane_of(marks, ends)

	return Object.keys(per_task).length === 0 ? reading : { ...reading, per_task }
}

function unique(marks: ReadonlyArray<QuotaMark>): Array<QuotaMark> {
	return [...new Map(marks.map((mark) => [mark.file.path, mark])).values()]
}

// The sample's marks, and every mark read for it, the files read back included.
async function marks_of(
	source: QuotaSource,
	mark_of: (file: QuotaFile) => Promise<QuotaMark>,
): Promise<{ sample: Array<QuotaMark>; read: Array<QuotaMark> }> {
	const { FILES_SCANNED } = run_board_quota_read
	const sample = await sampled(await source.find(FILES_SCANNED), mark_of)
	const since = since_of(sample)

	if (since === undefined) return { sample, read: sample }

	const back = await read_back(
		{
			find: source.find,
			mark_of: async (file) => known_mark(sample, file) ?? (await mark_of(file)),
			since,
		},
		FILES_SCANNED,
	)

	return { sample, read: unique([...sample, ...back]) }
}

async function fresh_reading(
	provider: QuotaProvider,
	ports: QuotaPorts,
	marks: QuotaMarks,
): Promise<QuotaReading | undefined> {
	const source = ports.sources[provider]
	const marked = marks.get(provider) ?? []
	const { sample, read } = await marks_of(
		source,
		async (file) => await file_mark(file, source, ports, marked),
	)

	marks.set(provider, read)

	return reading_with(
		sample,
		read.flatMap((mark) => end_of(mark)),
	)
}

// A provider whose file cannot be read reads as none; the other is read all the same.
async function reading_of(
	provider: QuotaProvider,
	ports: QuotaPorts,
	marks: QuotaMarks,
): Promise<QuotaReading | undefined> {
	try {
		return await fresh_reading(provider, ports, marks)
	} catch {
		return undefined
	}
}

async function quotas_of(ports: QuotaPorts, marks: QuotaMarks): Promise<Quotas> {
	const [claude, codex] = await Promise.all(
		PROVIDERS.map(async (provider) => await reading_of(provider, ports, marks)),
	)

	const status = await ports.read_status?.()

	return { claude: run_board_quota_status.newest(claude, status), codex }
}

function quota_reader(ports: QuotaPorts): () => Promise<Quotas> {
	const marks: QuotaMarks = new Map()

	return run_board_held.held_reader({
		read: async () => await quotas_of(ports, marks),
		now: ports.now,
		interval_ms: QUOTA_INTERVAL_MS,
		fallback: NO_QUOTAS,
	})
}

// The production reader: Claude's status record, lane/handoff logs and Codex's newest rollout files.
function live_quota_reader(): () => Promise<Quotas> {
	const { claude_files, claude_heads, claude_reading, codex_files, codex_heads, codex_reading } =
		run_board_quota_read

	return quota_reader({
		sources: {
			claude: {
				find: async (limit) => await claude_files(undefined, limit),
				reading_of: claude_reading,
				heads_of: claude_heads,
				is_done: run_board_quota_spent.claude_done,
			},
			codex: {
				find: async (limit) => await codex_files(Date.now(), undefined, limit),
				reading_of: codex_reading,
				heads_of: codex_heads,
				is_done: run_board_quota_spent.codex_done,
				lane_of: run_board_quota_read.codex_lane,
			},
		},
		read_tail: run_board_quota_read.read_tail,
		read_head: run_board_quota_read.read_head,
		read_status: run_board_quota_status.read,
		now: Date.now,
	})
}

const run_board_quota_held = { QUOTA_INTERVAL_MS, live_quota_reader, quota_reader }

export { run_board_quota_held }
export type { QuotaPorts, QuotaSource }
