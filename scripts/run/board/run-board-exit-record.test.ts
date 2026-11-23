import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
	run_board_exit_record,
	type ExitPorts,
	type ExitRecord,
	type RecordStore,
} from './run-board-exit-record'

const STARTED_MS = Date.parse('2026-11-20T12:00:00.000Z')
const UPTIME_MS = 90_000
const PID = 4242
const HALF_WRITTEN = 'snapshot half written'
const WATCHED_AT = '2026-11-20T12:01:30.000Z'
const FAILURE = 1
const SIGHUP_CODE = 129
const SIGINT_CODE = 130
const SIGTERM_CODE = 143
const UNCAUGHT = 'uncaughtException'
const GUARDED_EVENTS = [
	'exit',
	'SIGINT',
	'SIGTERM',
	'SIGHUP',
	UNCAUGHT,
	'unhandledRejection',
] as const

interface Fixture {
	ports: ExitPorts
	files: { text?: string | undefined }
	process: EventEmitter
	stdout: EventEmitter
	exits: Array<number>
	errors: Array<string>
	leaves: Array<string>
	clock: { now_ms: number }
}

function memory_store(files: Fixture['files']): RecordStore {
	return {
		read: () => files.text,
		write: (text) => {
			files.text = text
		},
		remove: () => {
			files.text = undefined
		},
	}
}

function fixture(text?: string): Fixture {
	const files: Fixture['files'] = { text }
	const clock = { now_ms: STARTED_MS }
	// eslint-disable-next-line unicorn/prefer-event-target -- stands in for `process`, a Node EventEmitter
	const process = new EventEmitter()
	// eslint-disable-next-line unicorn/prefer-event-target -- stands in for `process.stdout`, a Node stream
	const stdout = new EventEmitter()
	const exits: Array<number> = []
	const errors: Array<string> = []
	const leaves: Array<string> = []
	const ports: ExitPorts = {
		store: memory_store(files),
		now: () => clock.now_ms,
		pid: PID,
		targets: {
			process,
			stdout,
			exit: (code) => {
				exits.push(code)
			},
			error: (line) => {
				errors.push(line)
			},
		},
	}

	return { ports, files, process, stdout, exits, errors, leaves, clock }
}

// A live board's guard taken at `STARTED_MS`, its screen entered, the clock moved on by `UPTIME_MS`.
function watching(board: Fixture): ReturnType<typeof run_board_exit_record.start> {
	const guard = run_board_exit_record.start(board.ports)

	guard.on_exit(() => {
		board.leaves.push('left')
	})
	board.clock.now_ms = STARTED_MS + UPTIME_MS

	return guard
}

function recorded(board: Fixture): ExitRecord | undefined {
	return run_board_exit_record.take(board.ports.store)
}

describe('run_board_exit_record tick', () => {
	it('records a redraw that throws with its stack, time and uptime, and throws it on', async () => {
		const board = fixture()
		const guard = watching(board)
		const reason = HALF_WRITTEN
		const failure = new Error(reason)

		await expect(
			run_board_exit_record.guarded(guard, async () => {
				await Promise.reject(failure)
			}),
		).rejects.toBe(failure)

		expect(recorded(board)).toStrictEqual({
			kind: 'tick',
			reason,
			stack: failure.stack,
			at: WATCHED_AT,
			uptime_ms: UPTIME_MS,
			pid: PID,
			count: undefined,
			last_at: undefined,
		})
	})
})

// joshuafolkken/kit#8381: a failed redraw the board survives is kept, the same one counted up.
describe('run_board_exit_record failed, the same failure', () => {
	it('keeps one record, counting it up to its last time', () => {
		const board = fixture()
		const guard = watching(board)
		const failure = new Error(HALF_WRITTEN)

		guard.failed(failure)
		board.clock.now_ms += UPTIME_MS
		guard.failed(failure)

		expect(board.files.text?.split('\n').filter(Boolean)).toHaveLength(1)
		expect(recorded(board)).toMatchObject({
			kind: 'redraw',
			reason: HALF_WRITTEN,
			at: WATCHED_AT,
			last_at: '2026-11-20T12:03:00.000Z',
			count: 2,
		})
	})
})

describe('run_board_exit_record failed, other records', () => {
	it('replaces the record with another failure', () => {
		const board = fixture()
		const guard = watching(board)

		guard.failed(new Error('first'))
		guard.failed(new Error('second'))

		expect(recorded(board)).toMatchObject({ kind: 'redraw', reason: 'second', count: 1 })
	})

	it('gives way to an exit, and writes nothing after one', () => {
		const board = fixture()
		const guard = watching(board)

		guard.failed(new Error('first'))
		board.process.emit('SIGHUP', 'SIGHUP')
		guard.failed(new Error('after'))

		expect(recorded(board)).toMatchObject({ kind: 'signal', reason: 'SIGHUP' })
	})

	it('says on the next launch how many times the redraw failed', () => {
		const earlier = fixture()
		const guard = watching(earlier)

		const lost = new Error('lost')

		guard.failed(lost)
		guard.failed(lost)
		const next = fixture(earlier.files.text)

		run_board_exit_record.start(next.ports)

		expect(next.errors).toStrictEqual([
			`run:board: the last live board's redraw failed 2 time(s) (lost), from ${WATCHED_AT} to ${WATCHED_AT}`,
		])
	})
})

describe('run_board_exit_record release', () => {
	it('takes its handlers off as the board leaves', async () => {
		const board = fixture()
		const guard = watching(board)

		await run_board_exit_record.guarded(guard, async () => {
			await Promise.resolve()
		})

		for (const event of GUARDED_EVENTS) expect(board.process.listenerCount(event)).toBe(0)
		expect(board.stdout.listenerCount('error')).toBe(0)
	})

	it('runs the leave its exit listener held once as a redraw throws, so --timing still reports', async () => {
		const board = fixture()
		const guard = watching(board)

		await expect(
			run_board_exit_record.guarded(guard, async () => {
				await Promise.reject(new Error('redraw'))
			}),
		).rejects.toThrow('redraw')
		board.process.emit('exit', FAILURE)

		expect(board.leaves).toStrictEqual(['left'])
	})
})

describe('run_board_exit_record signals', () => {
	it.each([
		['SIGHUP', SIGHUP_CODE],
		['SIGTERM', SIGTERM_CODE],
	])('records %s as the reason and exits with %i', (signal, code) => {
		const board = fixture()

		watching(board)
		board.process.emit(signal, signal)

		expect(recorded(board)).toMatchObject({ kind: 'signal', reason: signal, uptime_ms: UPTIME_MS })
		expect(board.exits).toStrictEqual([code])
	})

	// joshuafolkken/kit#8747: a closed terminal still stops the board's sounds.
	it('runs the leave on SIGHUP, as its exit follows (ac-fef89474)', () => {
		const board = fixture()

		watching(board)
		board.process.emit('SIGHUP', 'SIGHUP')
		board.process.emit('exit', SIGHUP_CODE)

		expect(board.leaves).toStrictEqual(['left'])
	})

	it('records nothing on Ctrl-C, a normal exit', () => {
		const board = fixture()

		watching(board)
		board.process.emit('SIGINT', 'SIGINT')
		board.process.emit('exit', SIGINT_CODE)

		expect(board.files.text).toBeUndefined()
		expect(board.exits).toStrictEqual([SIGINT_CODE])
		expect(board.leaves).toStrictEqual(['left'])
	})
})

describe('run_board_exit_record failures', () => {
	it.each([
		[UNCAUGHT, 'uncaught'],
		['unhandledRejection', 'rejection'],
	])('records %s, leaves the screen, then prints its stack', (event, kind) => {
		const board = fixture()
		const failure = new Error('lost')

		watching(board)
		board.process.emit(event, failure)
		board.process.emit('exit', FAILURE)

		expect(recorded(board)).toMatchObject({ kind, reason: 'lost', stack: failure.stack })
		expect(board.leaves).toStrictEqual(['left'])
		expect(board.errors).toStrictEqual([failure.stack])
		expect(board.exits).toStrictEqual([FAILURE])
	})

	it('records a stdout error, the first reason winning over what follows it', () => {
		const board = fixture()
		const reason = 'write EPIPE'

		watching(board)
		board.stdout.emit('error', new Error(reason))
		board.process.emit(UNCAUGHT, new Error('later'))

		expect(recorded(board)).toMatchObject({ kind: 'stdout', reason })
	})
})

describe('run_board_exit_record write failure', () => {
	it('never throws when the record cannot be written', () => {
		const board = fixture()
		const guard = run_board_exit_record.start({
			...board.ports,
			store: {
				...board.ports.store,
				write: () => {
					throw new Error('disk full')
				},
			},
		})

		expect(() => {
			guard.record('tick', new Error('x'))
		}).not.toThrow()
	})
})

describe('run_board_exit_record next launch', () => {
	it('says the last abnormal exit once, then forgets it', () => {
		const earlier = fixture()

		watching(earlier)
		earlier.process.emit('SIGHUP', 'SIGHUP')
		const next = fixture(earlier.files.text)

		run_board_exit_record.start(next.ports)
		run_board_exit_record.start(next.ports)

		expect(next.errors).toStrictEqual([
			'run:board: the last live board exited abnormally (signal: SIGHUP) at 2026-11-20T12:01:30.000Z, after 90s',
		])
	})

	it('says nothing for a record it cannot read', () => {
		const board = fixture('{ broken')

		run_board_exit_record.start(board.ports)

		expect(board.errors).toStrictEqual([])
		expect(board.files.text).toBeUndefined()
	})
})
