import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { atomic_write } from '#scripts/lib/atomic-write'
import { JOSH_TMP_DIRECTORY } from '#scripts/lib/josh-temporary-directory'

// Where the live `josh run:board` keeps why it ended (`run-board-exit-record.ts`): one per-checkout
// file holding one record, written whole and read back once.

const RECORD_FILE = 'run-board-exit.json'

// `redraw` is a failed redraw the board survived (joshuafolkken/kit#8381), recorded with how many times
// it failed in a row and when last; every other kind ended the board.
type ExitKind = 'tick' | 'redraw' | 'uncaught' | 'rejection' | 'signal' | 'stdout'

interface ExitRecord {
	kind: ExitKind
	reason: string
	stack?: string | undefined
	at: string
	uptime_ms: number
	pid?: number | undefined
	count?: number | undefined
	last_at?: string | undefined
}

interface RecordStore {
	read: () => string | undefined
	write: (text: string) => void
	remove: () => void
}

const KINDS: ReadonlyArray<ExitKind> = [
	'tick',
	'redraw',
	'uncaught',
	'rejection',
	'signal',
	'stdout',
]

function text_of(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function number_of(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined
}

function quietly(action: () => void): void {
	try {
		action()
	} catch {
		// The board is on its way out; a record it cannot keep is lost, never a second failure.
	}
}

function read_text(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return undefined
	}
}

function file_store(root = PROJECT_ROOT): RecordStore {
	const file = path.join(root, JOSH_TMP_DIRECTORY, RECORD_FILE)

	return {
		read: () => read_text(file),
		write: (text) => {
			quietly(() => {
				atomic_write.replace_file(file, text)
			})
		},
		remove: () => {
			quietly(() => {
				rmSync(file, { force: true })
			})
		},
	}
}

function fields(text: string): Readonly<Record<string, unknown>> {
	try {
		const value: unknown = JSON.parse(text)

		return typeof value === 'object' && value !== null ? { ...value } : {}
	} catch {
		return {}
	}
}

// The fields a record says, or none where the file is broken or written by something else.
function record_in(value: Readonly<Record<string, unknown>>): ExitRecord | undefined {
	const kind = KINDS.find((name) => name === value['kind'])
	const reason = text_of(value['reason'])
	const at = text_of(value['at'])
	const uptime_ms = number_of(value['uptime_ms'])

	if (kind === undefined || reason === undefined || at === undefined || uptime_ms === undefined) {
		return undefined
	}

	return {
		kind,
		reason,
		stack: text_of(value['stack']),
		at,
		uptime_ms,
		pid: number_of(value['pid']),
		count: number_of(value['count']),
		last_at: text_of(value['last_at']),
	}
}

// The last abnormal exit, removed as it is read, so the launch after the next says nothing.
function take(store: RecordStore): ExitRecord | undefined {
	const text = store.read()

	if (text === undefined) return undefined
	store.remove()

	return record_in(fields(text))
}

// The record, replacing the one before it.
function write_record(store: RecordStore, record: ExitRecord): void {
	quietly(() => {
		store.write(`${JSON.stringify(record)}\n`)
	})
}

const run_board_exit_store = { file_store, take, write_record }

export { run_board_exit_store }
export type { ExitKind, ExitRecord, RecordStore }
