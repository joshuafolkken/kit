import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it, vi } from 'vitest'
import { run_board_cli, type BoardPorts } from './run-board-cli'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'

// joshuafolkken/kit#3430: the board's two speeds — local reads every tick, the plan no more often than
// the retry interval — and what it draws when a plan read fails or no run has started.

const WORDS = run_board_labels.words_of('en')
const START = Date.parse('2026-10-08T09:00:00.000Z')
const ALL: NamedPlan = { issues: [], only: false }
const LOCAL: LocalRead = {
	started_ms: START,
	ended_ms: undefined,
	scope: ALL,
	events: [],
	lanes: [],
}

function plan_titled(title: string): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: 'joshuafolkken/kit', titles: new Map([[1, title]]), open_numbers: undefined },
	}
}

const ESCAPE = '\u{1B}'
const ENTER = `${ESCAPE}[?1049h${ESCAPE}[?25l`
const LEAVE = `${ESCAPE}[?25h${ESCAPE}[?1049l`
const STOPPED = new Error('stopped')

interface Harness {
	ports: BoardPorts
	frames: Array<string>
	read_plan: ReturnType<typeof vi.fn<(scope: NamedPlan) => Promise<BoardPlan | undefined>>>
	clock: { now_ms: number }
	leaves: Array<() => void>
}

// `sleep` lets one redraw through, then stops the loop the way an interrupt would.
function harness(local: LocalRead | undefined, plans: Array<BoardPlan | undefined>): Harness {
	const frames: Array<string> = []
	const leaves: Array<() => void> = []
	const clock = { now_ms: START }
	const read_plan = vi.fn(async (_scope: NamedPlan) => plans.shift())
	let slept = 0
	const ports: BoardPorts = {
		read_plan,
		read_local: async () => local,
		now: () => clock.now_ms,
		write: (frame) => {
			frames.push(frame)
		},
		is_tty: true,
		on_exit: (leave) => {
			leaves.push(leave)
		},
		sleep: async () => {
			slept += 1
			if (slept > 1) throw STOPPED
		},
	}

	return { ports, frames, read_plan, clock, leaves }
}

describe('run_board_cli.tick', () => {
	it('reads the plan at most once per retry interval while redrawing every tick', async () => {
		const { ports, read_plan, clock } = harness(LOCAL, [plan_titled('a'), plan_titled('b')])
		const first = await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		clock.now_ms += run_board_cli.PLAN_RETRY_MS - 1
		const second = await run_board_cli.tick(first, ports, WORDS)

		expect(read_plan).toHaveBeenCalledTimes(1)
		clock.now_ms += 1
		await run_board_cli.tick(second, ports, WORDS)
		expect(read_plan).toHaveBeenCalledTimes(2)
	})

	it('keeps the previous plan and says when a read failed', async () => {
		const { ports, frames, clock } = harness(LOCAL, [plan_titled('kept'), undefined])
		const first = await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		clock.now_ms += run_board_cli.PLAN_RETRY_MS
		const second = await run_board_cli.tick(first, ports, WORDS)

		expect(second.plan?.context.titles.get(1)).toBe('kept')
		expect(second.fetched_ms).toBe(START)
		expect(frames.at(-1)).toContain(WORDS.plan_failed)
	})

	it('draws no run and reads nothing from GitHub when no run has started', async () => {
		const { ports, frames, read_plan } = harness(undefined, [plan_titled('a')])
		const state = await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		expect(state).toStrictEqual(run_board_cli.FRESH_STATE)
		expect(read_plan).not.toHaveBeenCalled()
		expect(frames.at(-1)).toContain(`backlogrun ${WORDS.no_run}`)
	})
})

// joshuafolkken/kit#3442: the plan is the run's own scope, a lane outside it is not the run's child, and
// a child the plan's listing no longer holds is not left running.
const SINGLE = 3441
const STALE_LANE = '3347'
const ONLY_SINGLE: NamedPlan = { issues: [SINGLE], only: true }

function single_plan(open: ReadonlyArray<number>): BoardPlan {
	const child: EpicChild = { number: SINGLE, repo: 'r', state: 'OPEN', labels: [], blocked_by: [] }

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: 'r', titles: new Map(), open_numbers: new Set(open) },
	}
}

describe('run_board_cli.tick — the run’s own scope', () => {
	it('reads the carry’s scope and counts only its one issue, not a stale lane', async () => {
		const local = { ...LOCAL, scope: ONLY_SINGLE, lanes: [STALE_LANE, String(SINGLE)] }
		const { ports, frames, read_plan } = harness(local, [single_plan([SINGLE])])

		await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		expect(read_plan).toHaveBeenCalledWith(ONLY_SINGLE)
		expect(frames.at(-1)).toContain(`${WORDS.progress} 0/1 `)
		expect(frames.at(-1)).not.toContain(STALE_LANE)
	})

	it('settles a launched child the open listing no longer holds', async () => {
		const launch = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#3441 x' }
		const local = { ...LOCAL, scope: ONLY_SINGLE, events: [launch] }
		const { ports, frames } = harness(local, [single_plan([])])

		await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		expect(frames.at(-1)).toContain(`${WORDS.progress} 1/1 `)
	})
})

// joshuafolkken/kit#3439: an ended run stays on screen with its plan held, and the next run starts clean.
const END = START + 60 * 60 * 1000

describe('run_board_cli.tick — an ended run', () => {
	it('draws the ended run as ended and holds its plan once it has read', async () => {
		const { ports, frames, read_plan, clock } = harness({ ...LOCAL, ended_ms: END }, [
			plan_titled('a'),
		])
		const first = await run_board_cli.tick(run_board_cli.FRESH_STATE, ports, WORDS)

		clock.now_ms += run_board_cli.PLAN_RETRY_MS
		await run_board_cli.tick(first, ports, WORDS)

		expect(read_plan).toHaveBeenCalledTimes(1)
		expect(frames.at(-1)).toContain(`backlogrun ${WORDS.stopped}`)
		expect(frames.at(-1)).toContain(WORDS.ended_at)
	})

	it('drops the ended run’s plan and baseline the moment the next run begins', async () => {
		const ended = harness({ ...LOCAL, ended_ms: END }, [plan_titled('old')])
		const held = await run_board_cli.tick(run_board_cli.FRESH_STATE, ended.ports, WORDS)
		const next = harness({ ...LOCAL, started_ms: END + 1 }, [undefined])
		const state = await run_board_cli.tick(held, next.ports, WORDS)

		expect(next.read_plan).toHaveBeenCalledTimes(1)
		expect(state.plan).toBeUndefined()
		expect(state.run_started_ms).toBe(END + 1)
		expect(next.frames.at(-1)).toContain(WORDS.plan_none)
	})
})

describe('run_board_cli.run', () => {
	it('draws one frame with --once and refuses any other argument', async () => {
		const { ports, frames } = harness(undefined, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--once'], ports)).resolves.toBe(0)
		await expect(run_board_cli.run(['--bogus'], ports)).resolves.toBe(1)
		expect(frames).toHaveLength(1)
		stderr.mockRestore()
	})

	it.each([
		{ argv: ['--once'], is_tty: true },
		{ argv: [], is_tty: false },
	])('writes one plain frame for $argv on tty $is_tty', async ({ argv, is_tty }) => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run(argv, { ...ports, is_tty })).resolves.toBe(0)
		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain(ESCAPE)
		expect(leaves).toHaveLength(0)
	})
})

// joshuafolkken/kit#3441: a terminal gets the alternate screen and has it restored on every exit path.
describe('run_board_cli.run screen', () => {
	it('enters the alternate screen, starts every frame at the top and leaves once a redraw fails', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([], ports)).rejects.toBe(STOPPED)
		expect(frames[0]).toBe(ENTER)
		expect(frames.slice(1, -1).map((frame) => frame.split('backlogrun', 1)[0])).toStrictEqual([
			`${ESCAPE}[H${ESCAPE}[J`,
			`${ESCAPE}[H${ESCAPE}[J`,
		])
		expect(frames.at(-1)).toBe(LEAVE)
		leaves[0]?.()
		expect(frames.filter((frame) => frame === LEAVE)).toHaveLength(1)
	})

	it('leaves the alternate screen through the exit handler while still redrawing', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		void run_board_cli.run([], {
			...ports,
			sleep: async () => {
				await new Promise<void>(() => undefined)
			},
		})
		await vi.waitFor(() => {
			expect(frames).toHaveLength(2)
		})
		expect(leaves).toHaveLength(1)
		leaves[0]?.()
		expect(frames.at(-1)).toBe(LEAVE)
	})
})
