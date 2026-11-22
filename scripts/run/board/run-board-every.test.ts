import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_every } from './run-board-every'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store } from './run-board-frame-store'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3569: `run:board --every <minutes>` pushes the chat frame off-screen each interval,
// with no model in between, and ends with the run.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE } = run_board_tick
const { CHAT_KEY, once_key, path_of } = run_board_frame_store
const ESCAPE = '\u{1B}'
const FIVE_MINUTES_MS = 300_000
const ENDED: LocalRead = { ...LOCAL, ended_ms: START + FIVE_MINUTES_MS }
const PLANS = [plan_titled('a'), plan_titled('a'), plan_titled('a')]

// A run read as running for the given number of frames, then as ended.
function ending_after(running: number): () => Promise<LocalRead> {
	let read = 0

	return async () => {
		read += 1

		return read > running ? ENDED : LOCAL
	}
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_cli.run --every', () => {
	it('pushes one chat frame per interval and ends after pushing the ended run', async () => {
		const { ports, pushes, frames, clock, read_local } = harness(LOCAL, PLANS)
		const sleep = vi.fn(async (ms: number) => {
			clock.now_ms += ms
		})

		read_local.mockImplementation(ending_after(2))
		await expect(run_board_cli.run(['--every', '5'], { ...ports, sleep })).resolves.toBe(0)

		expect(pushes).toHaveLength(3)
		expect(pushes.join('')).not.toContain(ESCAPE)
		expect(pushes.slice(0, 2).join('')).not.toContain('■ josh-board')
		expect(pushes[2]).toMatch(/^■ josh-board/u)
		expect(sleep.mock.calls).toStrictEqual([[FIVE_MINUTES_MS], [FIVE_MINUTES_MS]])
		expect(frames).toHaveLength(0)
	})

	it('pushes nothing and ends at once when no run has started here', async () => {
		const { ports, pushes } = harness(undefined, [])

		await expect(run_board_cli.run(['--every', '5'], ports)).resolves.toBe(0)

		expect(pushes).toHaveLength(0)
	})

	it('pushes nothing while JOSH_PROGRESS=0 is set', async () => {
		const { ports, pushes } = harness(LOCAL, PLANS)
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		vi.stubEnv('JOSH_PROGRESS', '0')

		await expect(run_board_cli.run(['--every', '5'], ports)).resolves.toBe(0)

		expect(pushes).toHaveLength(0)
		expect(stderr).toHaveBeenCalledWith(`${run_board_cli.DISABLED_NOTICE}\n`)
	})
})

// joshuafolkken/kit#7938: each pushed frame is the record `--chat` answers from, with no report marked.
describe('run_board_cli.run --every record', () => {
	it('records the last pushed frame under the chat key, dated when its read began', async () => {
		const { ports, pushes, marks, clock, read_local } = harness(LOCAL, PLANS)
		const store = run_board_frame_store.memory_store()
		const sleep = vi.fn(async (ms: number) => {
			clock.now_ms += ms
		})

		read_local.mockImplementation(ending_after(1))
		await run_board_cli.run(['--every', '5'], { ...ports, sleep, frames: store })

		expect(pushes).toHaveLength(2)
		expect(store.load(run_board_frame_store.CHAT_KEY)).toStrictEqual({
			text: pushes[1],
			saved_ms: START + FIVE_MINUTES_MS,
		})
		expect(marks).toHaveLength(0)
	})
})

// joshuafolkken/kit#7938: a live board records nothing before its first plan read settles, and dates
// what it records when that read was asked.
describe('run_board_every.recorder', () => {
	it('records nothing before the plan read has settled', () => {
		const { ports } = harness(LOCAL, PLANS)
		const store = run_board_frame_store.memory_store()

		run_board_every.recorder(
			{ ...ports, frames: store },
			undefined,
		)({ ...FRESH_STATE, local: LOCAL })

		expect(store.load(run_board_frame_store.CHAT_KEY)).toBeUndefined()
	})

	it('dates the record when the plan was read, not when it was drawn', () => {
		const { ports } = harness(LOCAL, PLANS)
		const store = run_board_frame_store.memory_store()
		const fetched_ms = START - FIVE_MINUTES_MS
		const state = { ...FRESH_STATE, local: LOCAL, fetched_ms }

		run_board_every.recorder({ ...ports, frames: store }, undefined)(state)

		expect(store.load(run_board_frame_store.CHAT_KEY)?.saved_ms).toBe(fetched_ms)
	})
})

// joshuafolkken/kit#8335: the worker keeps a round's inputs as the last record's only when it was.
describe('run_board_every.recorder’s answer', () => {
	it('answers whether it recorded', () => {
		const { ports } = harness(LOCAL, PLANS)
		const record = run_board_every.recorder(
			{ ...ports, frames: run_board_frame_store.memory_store() },
			undefined,
		)

		expect(record({ ...FRESH_STATE, local: LOCAL })).toBe(false)
		expect(record({ ...FRESH_STATE, local: LOCAL, fetched_ms: START })).toBe(true)
		expect(record({ ...FRESH_STATE, local: LOCAL, fetched_ms: START })).toBe(false)
	})
})

// joshuafolkken/kit#8124: the frames are written off the redraw, which never waits on the disk.
describe('run_board_every.recorder on the file store', () => {
	const root = `/run-board-every-test-${randomUUID()}`
	const keys = [CHAT_KEY, once_key(undefined, false), once_key(undefined, true)]

	afterEach(() => {
		for (const key of keys) rmSync(path_of(key, root), { force: true })
	})

	it('returns before the file store has written the frames', async () => {
		const { ports } = harness(LOCAL, PLANS)
		const store = run_board_frame_store.file_store(root)
		const state = { ...FRESH_STATE, local: LOCAL, fetched_ms: START }

		run_board_every.recorder({ ...ports, frames: store }, undefined)(state)

		expect(store.load(CHAT_KEY)).toBeUndefined()

		await store.settled()

		expect(store.load(CHAT_KEY)?.saved_ms).toBe(START)
	})
})

// joshuafolkken/kit#6597: once a single run's hold is released the board falls back to an older ended
// run, whose end screen is never pushed as this run's last frame.
describe('run_board_cli.run --every across runs', () => {
	it('ends without pushing once the frame draws another run than the first', async () => {
		const { ports, pushes, clock, read_local } = harness(LOCAL, PLANS)
		const older: LocalRead = { ...LOCAL, started_ms: START - FIVE_MINUTES_MS }
		const sleep = vi.fn(async (ms: number) => {
			clock.now_ms += ms
		})
		let read = 0

		read_local.mockImplementation(async () => {
			read += 1

			return read > 1 ? older : LOCAL
		})
		await expect(run_board_cli.run(['--every', '5'], { ...ports, sleep })).resolves.toBe(0)

		expect(pushes).toHaveLength(1)
	})
})

describe('run_board_cli.run --every arguments', () => {
	it.each([[['--every']], [['--every', '0']], [['--every', 'x']], [['--every', '5', '--once']]])(
		'refuses %j',
		async (argv) => {
			const { ports, pushes } = harness(LOCAL, PLANS)
			const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

			await expect(run_board_cli.run(argv, ports)).resolves.toBe(1)

			expect(pushes).toHaveLength(0)
			expect(stderr).toHaveBeenCalledWith(`${run_board_cli.USAGE}\n`)
		},
	)
})
