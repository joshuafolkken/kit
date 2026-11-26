import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { WriteStream } from 'node:tty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_frame_store } from './run-board-frame-store'

const { CHAT_KEY, FRESH_MS, file_store, fresh, latest_writer, memory_store, once_key, path_of } =
	run_board_frame_store
const SAVED_MS = Date.parse('2026-11-18T09:00:00.000Z')
const FRAME = { text: 'board\n', saved_ms: SAVED_MS }
const ROOT = `/run-board-frame-store-test-${randomUUID()}`
// A color depth `getColorDepth` never answers, so it has no `FORCE_COLOR` level.
const UNKNOWN_DEPTH = 2

afterEach(() => {
	rmSync(path_of(CHAT_KEY, ROOT), { force: true })
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_frame_store.file_store', () => {
	it('loads the frame it saved once its write has settled', async () => {
		const store = file_store(ROOT)

		store.save(CHAT_KEY, FRAME)
		await store.settled()

		expect(store.load(CHAT_KEY)).toStrictEqual(FRAME)
		expect(store.load(once_key(undefined, false))).toBeUndefined()
	})

	it('keeps the last of the frames saved while one is being written', async () => {
		const store = file_store(ROOT)
		const last = { ...FRAME, text: 'last\n' }

		store.save(CHAT_KEY, FRAME)
		store.save(CHAT_KEY, { ...FRAME, text: 'skipped\n' })
		store.save(CHAT_KEY, last)
		await store.settled()

		expect(store.load(CHAT_KEY)).toStrictEqual(last)
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

interface HeldWriter {
	written: Array<string>
	writer: ReturnType<typeof latest_writer>
	gate: { open: () => void }
}

// A writer whose every write is held until the gate opens, listing the frames it was asked to write.
function held_writer(): HeldWriter {
	const written: Array<string> = []
	const gate = { open: (): void => undefined }
	const released = new Promise<void>((resolve) => {
		gate.open = resolve
	})
	const writer = latest_writer(async (frame) => {
		written.push(frame.text)
		await released
	})

	return { written, writer, gate }
}

// joshuafolkken/kit#8124: one key's writes run one at a time, and only the newest waiting frame follows.
describe('run_board_frame_store.latest_writer', () => {
	it('writes the frame in flight, then only the newest one saved during it', async () => {
		const { written, writer, gate } = held_writer()

		writer.save(FRAME)
		writer.save({ ...FRAME, text: 'skipped\n' })
		writer.save({ ...FRAME, text: 'last\n' })

		expect(written).toStrictEqual([FRAME.text])

		gate.open()
		await writer.settled()

		expect(written).toStrictEqual([FRAME.text, 'last\n'])
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
		expect(fresh(store, once_key(undefined, false), SAVED_MS)).toBeUndefined()
		expect(fresh(undefined, CHAT_KEY, SAVED_MS)).toBeUndefined()
	})

	it('keeps a themed still frame apart from a plain one', () => {
		expect(once_key('wopr', false)).not.toBe(once_key(undefined, false))
	})

	it('save_only saves through to the store but loads nothing', () => {
		const store = memory_store()
		const only = run_board_frame_store.save_only(store)

		only?.save(CHAT_KEY, FRAME)

		expect(only?.load(CHAT_KEY)).toBeUndefined()
		expect(store.load(CHAT_KEY)).toStrictEqual(FRAME)
		expect(run_board_frame_store.save_only(undefined)).toBeUndefined()
	})

	it('keeps a still frame drawn on a terminal apart from a piped one', () => {
		expect(once_key(undefined, true)).not.toBe(once_key(undefined, false))
		expect(once_key('wopr', true)).not.toBe(once_key('wopr', false))
	})
})

// joshuafolkken/kit#8616: a piped frame forced into color is recorded apart from an uncolored one.
describe('run_board_frame_store.once_key — the colors stdout draws', () => {
	// joshuafolkken/kit#8505: the theme's own icons keep the key they had; others keep their own.
	it('keeps a still frame in other icons apart, the default icons under the key they had', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		expect(once_key('wopr', false, 'shapes')).toBe('once-wopr-pipe')
		expect(once_key(undefined, true, 'emoji')).toBe('once-tty')
		expect(once_key('wopr', false, 'letters')).toBe('once-wopr-letters-pipe')
		expect(once_key(undefined, false, 'shapes')).toBe('once-shapes-pipe')
	})

	it.each([undefined, 'wopr', 'trace'] as const)('keys %s by the forced color depth', (theme) => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = once_key(theme, false)

		vi.stubEnv('FORCE_COLOR', '1')

		expect(once_key(theme, false)).toBe(`${plain}-color1`)
	})

	it.each(['1', undefined])('draws a pipe in color under FORCE_COLOR alone, NO_COLOR=%s', (no) => {
		vi.stubEnv('FORCE_COLOR', undefined)
		vi.stubEnv('NO_COLOR', no)
		expect(once_key(undefined, false)).toBe('once-pipe')
		vi.stubEnv('FORCE_COLOR', '3')
		expect(once_key(undefined, false)).toBe('once-pipe-color3')
	})

	it('keys a depth with no FORCE_COLOR level as uncolored', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		vi.spyOn(WriteStream.prototype, 'getColorDepth').mockReturnValue(UNKNOWN_DEPTH)
		expect(once_key(undefined, false)).toBe('once-pipe')
	})
})
