import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import {
	run_board_exit_store,
	type ExitKind,
	type ExitRecord,
	type RecordStore,
} from './run-board-exit-store'

// Why the live `josh run:board` ended (joshuafolkken/kit#8380): a redraw that threw, a signal, an
// uncaught error or rejection, or a stdout that failed is written to one per-checkout file
// (`run-board-exit-store.ts`), and the next live board says it on stderr before it enters its screen,
// then forgets it. Ctrl-C is a normal exit and writes nothing. The first reason wins, so the error a
// failure causes on its way out never hides it. A failed redraw the board draws on past is kept there
// too, until an exit replaces it (joshuafolkken/kit#8381).

const FAILURE_EXIT_CODE = 1
const SIGHUP_EXIT_CODE = 129
const SIGINT_EXIT_CODE = 130
const SIGTERM_EXIT_CODE = 143

const { file_store, take, write_record } = run_board_exit_store

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
	// A redraw that failed and was survived.
	failed: (cause: unknown) => void
	release: () => void
}

type Listener = (cause?: unknown) => void

type Recorder = ExitGuard['record']

// What the board has recorded so far: an exit, after which nothing is written, and the last survived
// failure, which the same failure again counts up.
interface Recording {
	has_ended: boolean
	last?: ExitRecord | undefined
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

function failure_line(record: ExitRecord): string {
	const times = String(record.count ?? 1)
	const last_at = record.last_at ?? record.at

	return `run:board: the last live board's redraw failed ${times} time(s) in a row (${record.reason}), from ${record.at} to ${last_at}`
}

function line(record: ExitRecord): string {
	if (record.kind === 'redraw') return failure_line(record)
	const seconds = String(Math.round(record.uptime_ms / MS_PER_SECOND))
	const cause = `${record.kind}: ${record.reason}`

	return `run:board: the last live board exited abnormally (${cause}) at ${record.at}, after ${seconds}s`
}

// Records an exit once, the first reason winning; it replaces a survived failure written before it.
function recorder(ports: ExitPorts, started_ms: number, recording: Recording): Recorder {
	return (kind, cause) => {
		if (recording.has_ended) return
		recording.has_ended = true
		write_record(ports.store, record_of(kind, cause, ports, started_ms))
	}
}

// The same failure as the last one, counted up to `fresh`'s time; none where it differs.
function repeated(last: ExitRecord | undefined, fresh: ExitRecord): ExitRecord | undefined {
	if (last?.reason !== fresh.reason || last.stack !== fresh.stack) return undefined

	return { ...last, count: (last.count ?? 1) + 1, last_at: fresh.at, uptime_ms: fresh.uptime_ms }
}

// A failed redraw the board survived: the same failure again only counts up and moves its last time,
// so one failing every second keeps the file one record long; another failure replaces it.
function failure_recorder(
	ports: ExitPorts,
	started_ms: number,
	recording: Recording,
): ExitGuard['failed'] {
	return (cause) => {
		if (recording.has_ended) return
		const fresh = record_of('redraw', cause, ports, started_ms)
		const next = repeated(recording.last, fresh) ?? { ...fresh, count: 1, last_at: fresh.at }

		recording.last = next
		write_record(ports.store, next)
	}
}

// The exit and the survived failures share one recording, so nothing is written past an exit.
function recorders(ports: ExitPorts): Pick<ExitGuard, 'record' | 'failed'> {
	const started_ms = ports.now()
	const recording: Recording = { has_ended: false }

	return {
		record: recorder(ports, started_ms, recording),
		failed: failure_recorder(ports, started_ms, recording),
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
	const { record, failed } = recorders(ports)
	const detached: Array<() => void> = []
	const { targets } = ports
	const stdout = { error: ending(record, 'stdout', targets.exit, FAILURE_EXIT_CODE) }

	return {
		on_exit: (leave) => {
			const leave_once = once(leave)
			const detach = attach(targets.process, process_listeners(record, targets, leave_once))

			// The leave the `exit` listener would have run — `--timing`'s report with it — runs as it comes off.
			detached.push(
				() => {
					leave_once()
					detach()
				},
				attach(targets.stdout, stdout),
			)
		},
		record,
		failed,
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

// A failure the live loop does not survive — one outside its redraws, which it records through
// `failed` and draws on past (`run-board-live.ts`) — ends the board: its reason is recorded, then it is
// thrown on as before.
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
export type { ExitGuard, ExitPorts, ExitTargets }

export { type ExitKind, type ExitRecord, type RecordStore } from './run-board-exit-store'
