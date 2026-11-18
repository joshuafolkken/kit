import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store, type FrameStore } from './run-board-frame-store'
import type { BoardPorts } from './run-board-state'

const { LOCAL, harness, plan_titled } = run_board_fixture
const { CHAT_KEY, FRESH_MS, memory_store, once_key } = run_board_frame_store
const RECORDED = 'recorded board\n'
const AGE_SECONDS = 12
const AGE_MS = AGE_SECONDS * 1000
const PIPED_ONCE = once_key(undefined, false)
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }

function board(store: FrameStore): ReturnType<typeof harness> & { ports: BoardPorts } {
	const made = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	return { ...made, ports: { ...made.ports, is_tty: false, frames: store } }
}

// A theme set in the environment running the tests would key --once under that theme.
beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

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
