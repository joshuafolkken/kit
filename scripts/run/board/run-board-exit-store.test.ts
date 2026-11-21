import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_exit_store, type ExitRecord } from './run-board-exit-store'

// joshuafolkken/kit#8381: the live board's record file, written whole and read back once.

const DIRECTORY_PREFIX = 'run-board-exit-store-'
const create_directory = temporary_directory()
const AT = '2026-11-20T12:01:30.000Z'
const LAST_AT = '2026-11-20T12:03:00.000Z'
const REDRAW: ExitRecord = {
	kind: 'redraw',
	reason: 'lost',
	stack: 'Error: lost',
	at: AT,
	uptime_ms: 1,
	pid: 7,
	count: 3,
	last_at: LAST_AT,
}

describe('run_board_exit_store', () => {
	it('reads back a survived failure with its count and last time, once', () => {
		const store = run_board_exit_store.file_store(create_directory(DIRECTORY_PREFIX))

		run_board_exit_store.write_record(store, REDRAW)

		expect(run_board_exit_store.take(store)).toStrictEqual(REDRAW)
		expect(run_board_exit_store.take(store)).toBeUndefined()
	})

	it('replaces the record before it, keeping one line', () => {
		const store = run_board_exit_store.file_store(create_directory(DIRECTORY_PREFIX))

		run_board_exit_store.write_record(store, { ...REDRAW, reason: 'first' })
		run_board_exit_store.write_record(store, REDRAW)

		expect(store.read()).toBe(`${JSON.stringify(REDRAW)}\n`)
	})

	it('reads no record from a file of another kind', () => {
		const store = run_board_exit_store.file_store(create_directory(DIRECTORY_PREFIX))

		store.write(JSON.stringify({ ...REDRAW, kind: 'other' }))

		expect(run_board_exit_store.take(store)).toBeUndefined()
	})
})
