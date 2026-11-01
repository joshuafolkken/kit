import { run_board_held } from './run-board-held'
import {
	run_board_quota_read,
	type QuotaFile,
	type QuotaProvider,
	type QuotaReading,
	type Quotas,
} from './run-board-quota-read'
import { run_board_quota_spent, type QuotaSpan } from './run-board-quota-spent'

// The usage-limit gauges' readings as the board holds them (joshuafolkken/kit#5395): a redraw draws
// the held readings and reads no file; once a minute one read runs in the background
// (`run-board-held.ts`), and a provider's newest file it finds unchanged since the last read — the same
// path and `mtime` — is not opened again. A provider's newest file may hold no reading (a Codex child's
// lane log, a rollout of an API-key session), so the reading is the newest that holds one. A done
// file's head is read too, for the spend per task of `run-board-quota-spent.ts`, and files are read
// newest first until enough done ones tell it.

const QUOTA_INTERVAL_MS = 60_000
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']
const NO_QUOTAS: Quotas = { claude: undefined, codex: undefined }

// Where a provider's readings come from: its newest files, newest first, the windows a tail of one
// holds, those each event of its head held, and whether a tail ends a done file.
interface QuotaSource {
	find: () => Promise<Array<QuotaFile>>
	reading_of: (text: string) => QuotaReading | undefined
	heads_of: (text: string) => Array<QuotaReading>
	is_done: (tail: string) => boolean
}

interface QuotaPorts {
	sources: Readonly<Record<QuotaProvider, QuotaSource>>
	read_tail: (file: string, bytes: number) => Promise<string>
	read_head: (file: string, bytes: number) => Promise<string>
	now: () => number
}

// A file a provider was last read off, what its tail read and, once done, the readings it holds.
interface QuotaMark {
	file: QuotaFile
	reading: QuotaReading | undefined
	span: QuotaSpan
}

type QuotaMarks = Map<QuotaProvider, ReadonlyArray<QuotaMark>>

function is_unchanged(marked: QuotaFile, file: QuotaFile): boolean {
	return marked.path === file.path && marked.mtime_ms === file.mtime_ms
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
	const mark = marked.find((candidate) => is_unchanged(candidate.file, file))

	if (mark !== undefined) return mark

	const { reading, is_done } = await tail_of(file, source, ports)

	if (!is_done) return { file, reading, span: [] }

	const head = await ports.read_head(file.path, run_board_quota_read.TAIL_BYTES)

	return { file, reading, span: run_board_quota_spent.span_of(source.heads_of(head), reading) }
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

// The newest file's reading that holds windows, with each window's spend per task where told.
function reading_with(marks: ReadonlyArray<QuotaMark>): QuotaReading | undefined {
	const reading = marks.find((mark) => (mark.reading?.windows.length ?? 0) > 0)?.reading

	if (reading === undefined) return undefined

	const per_task = run_board_quota_spent.per_task_of(marks.map((mark) => mark.span))

	return Object.keys(per_task).length === 0 ? reading : { ...reading, per_task }
}

async function fresh_reading(
	provider: QuotaProvider,
	ports: QuotaPorts,
	marks: QuotaMarks,
): Promise<QuotaReading | undefined> {
	const source = ports.sources[provider]
	const files = await source.find()
	const marked = marks.get(provider) ?? []
	const fresh = await sampled(files, async (file) => await file_mark(file, source, ports, marked))

	marks.set(provider, fresh)

	return reading_with(fresh)
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

	return { claude, codex }
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

// The production reader: the run-state directory's newest lane logs and Codex's newest rollout files.
function live_quota_reader(): () => Promise<Quotas> {
	const { claude_files, claude_heads, claude_reading, codex_files, codex_heads, codex_reading } =
		run_board_quota_read

	return quota_reader({
		sources: {
			claude: {
				find: async () => await claude_files(),
				reading_of: claude_reading,
				heads_of: claude_heads,
				is_done: run_board_quota_spent.claude_done,
			},
			codex: {
				find: async () => await codex_files(Date.now()),
				reading_of: codex_reading,
				heads_of: codex_heads,
				is_done: run_board_quota_spent.codex_done,
			},
		},
		read_tail: run_board_quota_read.read_tail,
		read_head: run_board_quota_read.read_head,
		now: Date.now,
	})
}

const run_board_quota_held = { QUOTA_INTERVAL_MS, live_quota_reader, quota_reader }

export { run_board_quota_held }
export type { QuotaPorts, QuotaSource }
