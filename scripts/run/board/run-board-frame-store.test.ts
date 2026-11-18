import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { run_board_frame_store } from './run-board-frame-store'

const { CHAT_KEY, FRESH_MS, file_store, fresh, memory_store, once_key, path_of } =
	run_board_frame_store
const SAVED_MS = Date.parse('2026-11-18T09:00:00.000Z')
const FRAME = { text: 'board\n', saved_ms: SAVED_MS }
const ROOT = `/run-board-frame-store-test-${randomUUID()}`

afterEach(() => {
	rmSync(path_of(CHAT_KEY, ROOT), { force: true })
})

describe('run_board_frame_store.file_store', () => {
	it('loads the frame it saved', () => {
		const store = file_store(ROOT)

		store.save(CHAT_KEY, FRAME)

		expect(store.load(CHAT_KEY)).toStrictEqual(FRAME)
		expect(store.load(once_key(undefined))).toBeUndefined()
	})

	it('reads a broken record as no record', () => {
		writeFileSync(path_of(CHAT_KEY, ROOT), '{not json')

		expect(file_store(ROOT).load(CHAT_KEY)).toBeUndefined()
	})

	it('reads a record of another shape as no record', () => {
		writeFileSync(path_of(CHAT_KEY, ROOT), JSON.stringify({ text: 1, saved: SAVED_MS }))

		expect(file_store(ROOT).load(CHAT_KEY)).toBeUndefined()
	})
})

describe('run_board_frame_store.fresh', () => {
	it('answers a frame exactly a minute old, with its age', () => {
		const store = memory_store()

		store.save(CHAT_KEY, FRAME)

		expect(fresh(store, CHAT_KEY, SAVED_MS + FRESH_MS)).toBe('board\nrecorded 60s ago\n')
	})

	it('answers nothing for a frame past the minute, a missing one or no store', () => {
		const store = memory_store()

		store.save(CHAT_KEY, FRAME)

		expect(fresh(store, CHAT_KEY, SAVED_MS + FRESH_MS + 1)).toBeUndefined()
		expect(fresh(store, once_key(undefined), SAVED_MS)).toBeUndefined()
		expect(fresh(undefined, CHAT_KEY, SAVED_MS)).toBeUndefined()
	})

	it('keeps a themed still frame apart from a plain one', () => {
		expect(once_key('wargames')).not.toBe(once_key(undefined))
	})
})
