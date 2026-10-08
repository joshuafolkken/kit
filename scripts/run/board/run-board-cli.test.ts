import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#3430: the command's arguments and its terminal. What one redraw reads and draws is
// `run-board-tick.test.ts`'s (joshuafolkken/kit#3444).

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const ESCAPE = '\u{1B}'
const ENTER = `${ESCAPE}[?1049h${ESCAPE}[?25l`
const LEAVE = `${ESCAPE}[?25h${ESCAPE}[?1049l`
const RUN_MARK = '■ backlogrun'

describe('run_board_cli.run', () => {
	it('draws one frame with --once and refuses any other argument', async () => {
		const { ports, frames } = harness(undefined, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--once'], ports)).resolves.toBe(0)
		await expect(run_board_cli.run(['--bogus'], ports)).resolves.toBe(1)
		expect(frames).toHaveLength(1)
		expect(frames[0]).toContain(RUN_MARK)
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

	// joshuafolkken/kit#3452: a frame left behind on the terminal draws no frozen spinner frame.
	it('draws the still run and row icons for --once on a terminal', async () => {
		const launch = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
		const { ports, frames } = harness({ ...LOCAL, events: [launch] }, [plan_titled('a')])

		await run_board_cli.run(['--once'], { ...ports, is_tty: true })

		expect(stripVTControlCharacters(frames[0] ?? '')).toMatch(/^▶ backlogrun/u)
		expect(frames[0]).toContain('  🔄 1  a')
	})
})

// joshuafolkken/kit#3441: a terminal gets the alternate screen and has it restored on every exit path.
describe('run_board_cli.run screen', () => {
	it('enters the alternate screen, starts every frame at the top and leaves once a redraw fails', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([], ports)).rejects.toBe(STOPPED)
		expect(frames[0]).toBe(ENTER)
		expect(frames.slice(1, -1).map((frame) => frame.split(RUN_MARK, 1)[0])).toStrictEqual([
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

// joshuafolkken/kit#3455: the live board draws before a plan read that has not answered, and one plain
// frame waits for it.
describe('run_board_cli.run plan read', () => {
	it('draws the first live frame without waiting on the plan read', async () => {
		const { ports, frames } = harness(LOCAL, [])
		const read_plan = vi.fn(
			async (): Promise<BoardPlan | undefined> => await new Promise(() => undefined),
		)

		await expect(run_board_cli.run([], { ...ports, read_plan })).rejects.toBe(STOPPED)
		expect(read_plan).toHaveBeenCalledOnce()
		expect(frames[1]?.split('\n', 1)[0]).toContain('⏳')
	})

	it('draws the plan in one plain frame, with no spinner', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await run_board_cli.run(['--once'], ports)

		expect(frames).toHaveLength(1)
		expect(frames[0]).toContain('📊')
		expect(frames[0]?.split('\n', 1)[0]).not.toContain('⏳')
	})
})
