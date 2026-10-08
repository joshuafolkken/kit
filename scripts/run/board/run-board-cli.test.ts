import { describe, expect, it, vi } from 'vitest'
import { run_board_cli, type BoardPorts, type LocalRead } from './run-board-cli'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#3430: the board's two speeds — local reads every tick, the plan no more often than
// the retry interval — and what it draws when a plan read fails or no run has started.

const WORDS = run_board_labels.words_of('en')
const START = Date.parse('2026-10-08T09:00:00.000Z')
const LOCAL: LocalRead = { started_ms: START, events: [], lanes: [] }

function plan_titled(title: string): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: 'joshuafolkken/kit', titles: new Map([[1, title]]), open_numbers: undefined },
	}
}

interface Harness {
	ports: BoardPorts
	frames: Array<string>
	read_plan: ReturnType<typeof vi.fn<() => Promise<BoardPlan | undefined>>>
	clock: { now_ms: number }
}

function harness(local: LocalRead | undefined, plans: Array<BoardPlan | undefined>): Harness {
	const frames: Array<string> = []
	const clock = { now_ms: START }
	const read_plan = vi.fn(async () => plans.shift())
	const ports: BoardPorts = {
		read_plan,
		read_local: async () => local,
		now: () => clock.now_ms,
		write: (frame) => {
			frames.push(frame)
		},
	}

	return { ports, frames, read_plan, clock }
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

describe('run_board_cli.run', () => {
	it('draws one frame with --once and refuses any other argument', async () => {
		const { ports, frames } = harness(undefined, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--once'], ports)).resolves.toBe(0)
		await expect(run_board_cli.run(['--bogus'], ports)).resolves.toBe(1)
		expect(frames).toHaveLength(1)
		stderr.mockRestore()
	})
})
