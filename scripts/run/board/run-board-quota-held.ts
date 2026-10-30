import { run_board_held } from './run-board-held'
import {
	run_board_quota_read,
	type QuotaFile,
	type QuotaProvider,
	type QuotaReading,
	type Quotas,
} from './run-board-quota-read'

// The usage-limit gauges' readings as the board holds them (joshuafolkken/kit#5395): a redraw draws
// the held readings and reads no file; once a minute one read runs in the background
// (`run-board-held.ts`), and a provider's newest file it finds unchanged since the last read — the same
// path and `mtime` — is not opened again. A provider's newest file may hold no reading (a Codex child's
// lane log, a rollout of an API-key session), so the next newest are tried in turn.

const QUOTA_INTERVAL_MS = 60_000
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']
const NO_QUOTAS: Quotas = { claude: undefined, codex: undefined }

// Where a provider's readings come from: its newest files, newest first, and the windows a tail of
// one holds.
interface QuotaSource {
	find: () => Promise<Array<QuotaFile>>
	reading_of: (text: string) => QuotaReading | undefined
}

interface QuotaPorts {
	sources: Readonly<Record<QuotaProvider, QuotaSource>>
	read_tail: (file: string, bytes: number) => Promise<string>
	now: () => number
}

// The file a provider was last read off, and what it read.
interface QuotaMark {
	file: QuotaFile
	reading: QuotaReading
}

type QuotaMarks = Map<QuotaProvider, QuotaMark>

function is_unchanged(marked: QuotaFile, file: QuotaFile): boolean {
	return marked.path === file.path && marked.mtime_ms === file.mtime_ms
}

async function file_reading(
	file: QuotaFile,
	source: QuotaSource,
	ports: QuotaPorts,
	mark: QuotaMark | undefined,
): Promise<QuotaReading | undefined> {
	if (mark !== undefined && is_unchanged(mark.file, file)) return mark.reading

	return await run_board_quota_read.reading_in(
		async (bytes) => await ports.read_tail(file.path, bytes),
		source.reading_of,
	)
}

// The first of the files, newest first, that holds a reading; only that one is marked.
async function first_reading(
	files: ReadonlyArray<QuotaFile>,
	provider: QuotaProvider,
	ports: QuotaPorts,
	marks: QuotaMarks,
): Promise<QuotaReading | undefined> {
	const [file, ...older] = files

	if (file === undefined) return undefined

	const reading = await file_reading(file, ports.sources[provider], ports, marks.get(provider))

	if (reading === undefined || reading.windows.length === 0) {
		return await first_reading(older, provider, ports, marks)
	}

	marks.set(provider, { file, reading })

	return reading
}

async function fresh_reading(
	provider: QuotaProvider,
	ports: QuotaPorts,
	marks: QuotaMarks,
): Promise<QuotaReading | undefined> {
	const files = await ports.sources[provider].find()

	return await first_reading(files, provider, ports, marks)
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
	const { claude_files, claude_reading, codex_files, codex_reading, read_tail } =
		run_board_quota_read

	return quota_reader({
		sources: {
			claude: { find: async () => await claude_files(), reading_of: claude_reading },
			codex: { find: async () => await codex_files(Date.now()), reading_of: codex_reading },
		},
		read_tail,
		now: Date.now,
	})
}

const run_board_quota_held = { QUOTA_INTERVAL_MS, live_quota_reader, quota_reader }

export { run_board_quota_held }
export type { QuotaPorts, QuotaSource }
