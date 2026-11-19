import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store, type FrameStore } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import type { BoardPorts } from './run-board-state'

const { LOCAL, START, STOPPED, WORDS, harness, plan_titled } = run_board_fixture
const { CHAT_KEY, FRESH_MS, memory_store, once_key } = run_board_frame_store
const RECORDED = 'recorded board\n'
const AGE_SECONDS = 12
const AGE_MS = AGE_SECONDS * 1000
const PIPED_ONCE = once_key(undefined, false)
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }

// joshuafolkken/kit#8027: a shell that names a theme must not redraw the recorded frames these tests read.
beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

function board(store: FrameStore): ReturnType<typeof harness> & { ports: BoardPorts } {
	const made = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	return { ...made, ports: { ...made.ports, is_tty: false, frames: store } }
}

describe('run_board_cli.run answered from the recorded frame', () => {
	it.each([
		['--chat', CHAT_KEY, 1],
		['--once', PIPED_ONCE, 0],
	])('%s writes a fresh record and its age without reading', async (flag, key, mark_count) => {
		const store = memory_store()
		const made = board(store)

		store.save(key, { text: RECORDED, saved_ms: made.clock.now_ms - AGE_MS })
		await expect(run_board_cli.run([flag], made.ports)).resolves.toBe(0)

		expect(made.frames).toStrictEqual([`${RECORDED}recorded ${String(AGE_SECONDS)}s ago\n`])
		expect(made.read_plan).not.toHaveBeenCalled()
		expect(made.read_local).not.toHaveBeenCalled()
		expect(made.marks).toHaveLength(mark_count)
	})
})

describe('run_board_cli.run read from scratch', () => {
	const none = 'no record'
	const stale = 'a stale record'

	it.each([
		['--chat', CHAT_KEY, none, undefined],
		['--once', PIPED_ONCE, none, undefined],
		['--chat', CHAT_KEY, stale, FRESH_MS + 1],
		['--once', PIPED_ONCE, stale, FRESH_MS + 1],
	])('%s with %s reads, writes no age and records what it wrote', async (flag, key, _name, age) => {
		const store = memory_store()
		const made = board(store)

		if (age !== undefined) store.save(key, { text: RECORDED, saved_ms: made.clock.now_ms - age })
		await run_board_cli.run([flag], made.ports)

		expect(made.read_local).toHaveBeenCalled()
		expect(made.frames).toHaveLength(1)
		expect(made.frames[0]).not.toContain('recorded')
		expect(store.load(key)).toStrictEqual({ text: made.frames[0], saved_ms: made.clock.now_ms })
	})

	it('--chat read from scratch marks the report', async () => {
		const made = board(memory_store())

		await run_board_cli.run(['--chat'], made.ports)

		expect(made.marks).toStrictEqual([made.clock.now_ms])
	})
})

describe('run_board_cli.run --fresh and the record date', () => {
	it('--chat --fresh reads past a fresh record and records what it wrote', async () => {
		const store = memory_store()
		const made = board(store)

		store.save(CHAT_KEY, { text: RECORDED, saved_ms: made.clock.now_ms })
		await expect(run_board_cli.run(['--chat', '--fresh'], made.ports)).resolves.toBe(0)

		expect(made.read_local).toHaveBeenCalled()
		expect(made.frames[0]).not.toContain(RECORDED)
		expect(store.load(CHAT_KEY)?.text).toBe(made.frames[0])
		expect(run_board_cli.USAGE).toContain('--chat [--fresh]')
	})

	it.each(['--chat', '--once'])('%s dates its record when the read began', async (flag) => {
		const store = memory_store()
		const made = board(store)
		const began_ms = made.clock.now_ms
		const ports: BoardPorts = {
			...made.ports,
			read_plan: async (scope) => {
				made.clock.now_ms += AGE_MS

				return await made.ports.read_plan(scope)
			},
		}

		await run_board_cli.run([flag], ports)

		expect(made.clock.now_ms).toBeGreaterThan(began_ms)
		expect(store.load(flag === '--chat' ? CHAT_KEY : PIPED_ONCE)?.saved_ms).toBe(began_ms)
	})
})

// joshuafolkken/kit#7938: a live board records the frames `--chat` and `--once` answer from, drawn
// from what it already read.
const ESCAPE = '\u{1B}'
// joshuafolkken/kit#8125: a live frame starts its synchronized output at the top of the screen.
const HOME = `${ESCAPE}[?2026h${ESCAPE}[H`
const LIVE_SECONDS = 11
const LIVE_MS = LIVE_SECONDS * 1000
const LIVE_AGE = String(LIVE_SECONDS)
const TERMINAL_ONCE = once_key(undefined, true)
// The run's own reads the live board takes on its own cadence over `LIVE_MS`: one at the start, then
// one each `LOCAL_READ_MS`.
const LOCAL_READS = Math.floor(LIVE_MS / run_board_gather.LOCAL_READ_MS) + 1

// A live board run for `LIVE_MS`, its saves counted, its writes kept.
async function watched(store: FrameStore): Promise<{
	made: ReturnType<typeof harness>
	saves: Array<string>
	writes: Array<string>
}> {
	const made = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])
	const saves: Array<string> = []
	const writes: Array<string> = []
	const counted: FrameStore = {
		load: store.load,
		save: (key, frame) => {
			saves.push(key)
			store.save(key, frame)
		},
	}
	const live: BoardPorts = {
		...made.ports,
		frames: counted,
		sleep: async (ms) => {
			if (made.clock.now_ms >= START + LIVE_MS) throw STOPPED
			made.clock.now_ms += ms
		},
		write: (text) => {
			writes.push(text)
		},
	}

	await expect(run_board_cli.run([], live)).rejects.toBe(STOPPED)

	return { made, saves, writes }
}

describe('run_board_cli.run live board record', () => {
	it('records both frames once every five seconds, reading nothing more for them', async () => {
		const { made, saves, writes } = await watched(memory_store())
		const frames = writes.filter((text) => text.startsWith(HOME))

		expect(saves).toStrictEqual([
			CHAT_KEY,
			TERMINAL_ONCE,
			CHAT_KEY,
			TERMINAL_ONCE,
			CHAT_KEY,
			TERMINAL_ONCE,
		])
		expect(made.read_machine).toHaveBeenCalledTimes(frames.length)
		expect(made.read_local).toHaveBeenCalledTimes(LOCAL_READS)
	})

	it('records a chat frame with no escape and a once frame that ends on no footer', async () => {
		const store = memory_store()

		await watched(store)

		expect(store.load(CHAT_KEY)?.text).toContain('🧵 lanes')
		expect(store.load(CHAT_KEY)?.text).not.toContain(ESCAPE)
		expect(store.load(TERMINAL_ONCE)?.text).not.toContain(HOME)
		expect(store.load(TERMINAL_ONCE)?.text).not.toContain(WORDS.keeps_running)
	})

	it('answers --chat from the live board record, reading nothing', async () => {
		const store = memory_store()
		const { made } = await watched(store)
		const recorded = store.load(CHAT_KEY)
		const chat = board(store)

		chat.clock.now_ms = made.clock.now_ms
		await run_board_cli.run(['--chat'], chat.ports)

		expect(recorded?.text).toBeDefined()
		// Dated when the plan was read, at the board's start, so it is as old as the board.
		expect(chat.frames).toStrictEqual([`${String(recorded?.text)}recorded ${LIVE_AGE}s ago\n`])
		expect(chat.read_local).not.toHaveBeenCalled()
	})
})

describe('run_board_cli.run --once record keys', () => {
	it.each([
		['a terminal', once_key(undefined, true)],
		['another theme', once_key('wargames', false)],
	])('reads past a record kept for %s', async (_name, key) => {
		const store = memory_store()
		const made = board(store)

		store.save(key, { text: RECORDED, saved_ms: made.clock.now_ms })
		await run_board_cli.run(['--once'], made.ports)

		expect(made.read_local).toHaveBeenCalled()
		expect(made.frames[0]).not.toContain('recorded')
	})

	it('answers a themed --once from the record kept for its theme', async () => {
		const store = memory_store()
		const made = board(store)

		store.save(once_key('wargames', false), { text: RECORDED, saved_ms: made.clock.now_ms })
		await run_board_cli.run(['--once', '--theme', 'wargames'], made.ports)

		expect(made.read_local).not.toHaveBeenCalled()
		expect(made.frames).toStrictEqual([`${RECORDED}recorded 0s ago\n`])
	})
})
