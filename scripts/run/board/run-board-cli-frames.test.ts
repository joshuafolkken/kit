import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_exit_record } from './run-board-exit-record'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store, type FrameStore } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import { run_board_live } from './run-board-live'
import type { BoardPorts, StallStage } from './run-board-state'
import { run_board_write_port } from './run-board-write-port'

const { LOCAL, START, STOPPED, harness, plan_titled } = run_board_fixture
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
const LIVE_SECONDS = 11
const LIVE_MS = LIVE_SECONDS * 1000
// The run's own reads the live board takes on its own cadence over `LIVE_MS`: one at the start, then
// one each `LOCAL_READ_MS`.
const LOCAL_READS = Math.floor(LIVE_MS / run_board_gather.LOCAL_READ_MS) + 1

// A live board run for `LIVE_MS`, its saves counted and its redraws (joshuafolkken/kit#8826: a redraw
// writes only what changed, so it is counted as it begins, not from its write).
async function watched(store: FrameStore): Promise<{
	made: ReturnType<typeof harness>
	saves: Array<string>
	redraws: Array<StallStage>
}> {
	const made = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])
	const saves: Array<string> = []
	const redraws: Array<StallStage> = []
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
		enter_stage: (stage) => {
			if (stage === 'redraw') redraws.push(stage)
		},
	}

	await expect(run_board_cli.run([], live)).rejects.toBe(STOPPED)

	return { made, saves, redraws }
}

// joshuafolkken/kit#8161: the frames are recorded on the worker thread (`run-board-gather-record.ts`),
// so the board's own redraws record nothing.
describe('run_board_cli.run live board record', () => {
	it('records nothing on the board’s own thread while it draws', async () => {
		const { made, saves, redraws } = await watched(memory_store())

		expect(redraws.length).toBeGreaterThan(LIVE_SECONDS - 1)
		expect(saves).toStrictEqual([])
		expect(made.read_machine).toHaveBeenCalledTimes(redraws.length)
		expect(made.read_local).toHaveBeenCalledTimes(LOCAL_READS)
	})

	// joshuafolkken/kit#9027: only the process's own stdout is unblocked; a test's ports are left as given.
	it('leaves the process stdout blocking when it draws on given ports', async () => {
		const unblock = vi.spyOn(run_board_write_port, 'unblock')

		await watched(memory_store())

		expect(unblock).not.toHaveBeenCalled()
		unblock.mockRestore()
	})

	it('unblocks the process stdout when it draws on the process’s own ports', async () => {
		const unblock = vi.spyOn(run_board_write_port, 'unblock').mockReturnValue()
		const guard = { on_exit: vi.fn(), record: vi.fn(), failed: vi.fn(), release: vi.fn() }

		vi.spyOn(run_board_exit_record, 'start').mockReturnValue(guard)
		vi.spyOn(run_board_live, 'watch').mockRejectedValue(STOPPED)
		vi.spyOn(run_board_cli.LIVE_PORTS, 'is_tty', 'get').mockReturnValue(true)

		await expect(run_board_cli.run([])).rejects.toBe(STOPPED)

		expect(unblock).toHaveBeenCalledExactlyOnceWith(process.stdout)
		vi.restoreAllMocks()
	})
})

describe('run_board_cli.run --once record keys', () => {
	it.each([
		['a terminal', once_key(undefined, true)],
		['another theme', once_key('wopr', false)],
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

		store.save(once_key('wopr', false), { text: RECORDED, saved_ms: made.clock.now_ms })
		await run_board_cli.run(['--once', '--theme', 'wopr'], made.ports)

		expect(made.read_local).not.toHaveBeenCalled()
		expect(made.frames).toStrictEqual([`${RECORDED}recorded 0s ago\n`])
	})

	it('reads past the record kept for its theme in other icons (#8505)', async () => {
		const store = memory_store()
		const made = board(store)

		store.save(once_key('wopr', false), { text: RECORDED, saved_ms: made.clock.now_ms })
		await run_board_cli.run(['--once', '--theme', 'wopr', '--icons', 'letters'], made.ports)

		expect(made.read_local).toHaveBeenCalled()
		expect(store.load(once_key('wopr', false, 'letters'))?.text).toBe(made.frames[0])
	})
})
