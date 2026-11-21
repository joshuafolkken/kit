import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { atomic_write } from '#scripts/lib/atomic-write'
import { JOSH_TMP_DIRECTORY } from '#scripts/lib/josh-temporary-directory'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'

// Why the live `josh run:board` ended (joshuafolkken/kit#8380): a redraw that threw, a signal, an
// uncaught error or rejection, or a stdout that failed is written to one per-checkout file, and the next
// live board says it on stderr before it enters its screen, then forgets it. Ctrl-C is a normal exit and
// writes nothing. The first reason wins, so the error a failure causes on its way out never hides it.

const FAILURE_EXIT_CODE = 1
const SIGHUP_EXIT_CODE = 129
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143
const RECORD_FILE = 'run-board-exit.json'

type ExitKind = 'tick' | 'uncaught' | 'rejection' | 'signal' | 'stdout'

interface ExitRecord {
	kind: ExitKind
	reason: string
	stack?: string | undefined
	at: string
	uptime_ms: number
	pid?: number | undefined
}

interface RecordStore {
	read: () => string | undefined
	write: (text: string) => void
	remove: () => void
}

interface ExitTargets {
	process: NodeJS.EventEmitter
	stdout: NodeJS.EventEmitter
	exit: (code: number) => void
	error: (line: string) => void
}

interface ExitPorts {
	store: RecordStore
	now: () => number
	pid: number
	targets: ExitTargets
}

interface ExitGuard {
	on_exit: (leave: () => void) => void
	record: (kind: ExitKind, cause: unknown) => void
	release: () => void
}

type Listener = (cause?: unknown) => void

type Recorder = ExitGuard['record']

const KINDS: ReadonlyArray<ExitKind> = ['tick', 'uncaught', 'rejection', 'signal', 'stdout']

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

function record_of(
	kind: ExitKind,
	cause: unknown,
	ports: ExitPorts,
	started_ms: number,
): ExitRecord {
	const now_ms = ports.now()
	const is_error = cause instanceof Error
	const reason = is_error ? cause.message : String(cause)

	return {
		kind,
		reason,
		stack: is_error ? cause.stack : undefined,
		at: new Date(now_ms).toISOString(),
		uptime_ms: now_ms - started_ms,
		pid: ports.pid,
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
	}
}

// The last abnormal exit, removed as it is read, so the launch after the next says nothing.
function take(store: RecordStore): ExitRecord | undefined {
	const text = store.read()

	if (text === undefined) return undefined
	store.remove()

	return record_in(fields(text))
}

function line(record: ExitRecord): string {
	const seconds = String(Math.round(record.uptime_ms / MS_PER_SECOND))
	const cause = `${record.kind}: ${record.reason}`

	return `run:board: the last live board exited abnormally (${cause}) at ${record.at}, after ${seconds}s`
}

// Records once, the first reason winning.
function recorder(ports: ExitPorts, started_ms: number): ExitGuard['record'] {
	let has_recorded = false

	return (kind, cause) => {
		if (has_recorded) return
		has_recorded = true
		quietly(() => {
			ports.store.write(`${JSON.stringify(record_of(kind, cause, ports, started_ms))}\n`)
		})
	}
}

function once(action: () => void): () => void {
	let has_run = false

	return () => {
		if (has_run) return
		has_run = true
		action()
	}
}

// An uncaught failure leaves the screen before its stack is printed, so it lands on the normal one.
function failing(
	record: Recorder,
	kind: ExitKind,
	targets: ExitTargets,
	leave: () => void,
): Listener {
	return (cause) => {
		record(kind, cause)
		leave()
		targets.error(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause))
		targets.exit(FAILURE_EXIT_CODE)
	}
}

// Records `kind` with what the event carried — a signal's listener is handed the signal's name — then
// exits with `code`.
function ending(
	record: Recorder,
	kind: ExitKind,
	exit: ExitTargets['exit'],
	code: number,
): Listener {
	return (cause) => {
		record(kind, cause)
		exit(code)
	}
}

function process_listeners(
	record: Recorder,
	targets: ExitTargets,
	leave: () => void,
): Record<string, Listener> {
	const { exit } = targets

	return {
		exit: leave,
		SIGINT: () => {
			exit(SIGINT_EXIT_CODE)
		},
		SIGTERM: ending(record, 'signal', exit, SIGTERM_EXIT_CODE),
		SIGHUP: ending(record, 'signal', exit, SIGHUP_EXIT_CODE),
		uncaughtException: failing(record, 'uncaught', targets, leave),
		unhandledRejection: failing(record, 'rejection', targets, leave),
	}
}

function attach(emitter: NodeJS.EventEmitter, listeners: Record<string, Listener>): () => void {
	const entries = Object.entries(listeners)

	for (const [event, listener] of entries) emitter.on(event, listener)

	return () => {
		for (const [event, listener] of entries) emitter.off(event, listener)
	}
}

// A live board's hold on the process: its handlers go on with the screen and come off with `release`,
// so a `backlogrun` that drew the board keeps none of them.
function guard(ports: ExitPorts): ExitGuard {
	const record = recorder(ports, ports.now())
	const detached: Array<() => void> = []
	const { targets } = ports
	const stdout = { error: ending(record, 'stdout', targets.exit, FAILURE_EXIT_CODE) }

	return {
		on_exit: (leave) => {
			const listeners = process_listeners(record, targets, once(leave))

			detached.push(attach(targets.process, listeners), attach(targets.stdout, stdout))
		},
		record,
		release: () => {
			for (const detach of detached.splice(0)) detach()
		},
	}
}

function process_ports(): ExitPorts {
	return {
		store: file_store(),
		now: () => Date.now(),
		pid: process.pid,
		targets: {
			process,
			stdout: process.stdout,
			exit: (code) => process.exit(code),
			error: (text) => process.stderr.write(`${text}\n`),
		},
	}
}

// Says the last abnormal exit, then holds the process for this one.
function start(ports: ExitPorts = process_ports()): ExitGuard {
	const last = take(ports.store)

	if (last !== undefined) ports.targets.error(line(last))

	return guard(ports)
}

// A redraw that throws ends the board: its reason is recorded, then it is thrown on as before.
async function guarded(exits: ExitGuard | undefined, body: () => Promise<void>): Promise<void> {
	try {
		await body()
	} catch (error) {
		exits?.record('tick', error)
		throw error
	} finally {
		exits?.release()
	}
}

const run_board_exit_record = {
	SIGINT_EXIT_CODE,
	SIGTERM_EXIT_CODE,
	file_store,
	guarded,
	line,
	start,
	take,
}

export { run_board_exit_record }
export type { ExitGuard, ExitKind, ExitPorts, ExitRecord, ExitTargets, RecordStore }
