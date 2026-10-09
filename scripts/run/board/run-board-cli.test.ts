import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#3430: the command's arguments and its terminal. What one redraw reads and draws is
// `run-board-tick.test.ts`'s (joshuafolkken/kit#3444).

const { LOCAL, SPINNING, STOPPED, harness, plan_titled } = run_board_fixture
const ESCAPE = '\u{1B}'
const ENTER = `${ESCAPE}[?1049h${ESCAPE}[?25l`
const LEAVE = `${ESCAPE}[?25h${ESCAPE}[?1049l`
const RUN_MARK = '■ backlogrun'
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }

// A link as a terminal that opens one draws it, so a chat frame is seen to strip it.
function hyperlink(text: string): string {
	return `${ESCAPE}]8;;https://x${ESCAPE}\\${text}${ESCAPE}]8;;${ESCAPE}\\`
}

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
		const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

		await run_board_cli.run(['--once'], { ...ports, is_tty: true })

		expect(stripVTControlCharacters(frames[0] ?? '')).toMatch(/^▶ backlogrun/u)
		expect(frames[0]).toContain('  🔍 1  a')
	})
})

// joshuafolkken/kit#3456: the answer to a progress question in a `backlogrun` — one frame a chat shows
// as it is, recorded as the report it is.
describe('run_board_cli.run --chat', () => {
	it('writes one frame with no escape and records the report once', async () => {
		const { ports, frames, marks, clock } = harness({ ...LOCAL, events: [LAUNCH] }, [
			plan_titled('a'),
		])

		await expect(run_board_cli.run(['--chat'], { ...ports, link: hyperlink })).resolves.toBe(0)

		expect(frames).toHaveLength(1)
		expect(frames[0]).not.toContain(ESCAPE)
		expect(frames[0]).toContain('  🔍 1  a')
		expect(marks).toStrictEqual([clock.now_ms])
	})

	it('records no report for a frame a person drew', async () => {
		const { ports, marks } = harness(LOCAL, [plan_titled('a')])

		await run_board_cli.run(['--once'], ports)

		expect(marks).toHaveLength(0)
	})

	it('refuses --chat with another argument', async () => {
		const { ports, frames } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--chat', '--once'], ports)).resolves.toBe(1)
		expect(frames).toHaveLength(0)
		stderr.mockRestore()
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
})

// joshuafolkken/kit#3437: the closable screen says closing it leaves the run going; --once does not.
describe('run_board_cli.run footer', () => {
	it('ends every live frame on the line that says the run keeps going', async () => {
		const { ports, frames } = harness(undefined, [])
		const once = harness(undefined, [])

		await expect(run_board_cli.run([], ports)).rejects.toBe(STOPPED)
		await run_board_cli.run(['--once'], once.ports)

		// joshuafolkken/kit#3489: one English line that keeps the command that reopens the board.
		expect(stripVTControlCharacters(frames[1] ?? '').trimEnd()).toMatch(
			/\nClosing this screen leaves the run going · reopen with `pnpm josh backlogrun`$/u,
		)
		expect(once.frames[0]).not.toContain('pnpm josh backlogrun')
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
		expect(frames[1]?.split('\n', 1)[0]).toMatch(SPINNING)
	})

	it('draws the plan in one plain frame, with no spinner', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await run_board_cli.run(['--once'], ports)

		expect(frames).toHaveLength(1)
		expect(frames[0]).toMatch(/✅ +\d+\/\d+/u)
		expect(frames[0]?.split('\n', 1)[0]).not.toMatch(SPINNING)
	})
})

// joshuafolkken/kit#3486: a live frame ends on its footer with nothing after it and is kept to the
// terminal's rows; every other frame is drawn whole, and every frame is in English.
describe('run_board_cli.run terminal size', () => {
	const SHORT = { rows: 8, columns: 80 }
	const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

	it('ends a live frame with no newline after the footer', async () => {
		const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

		await expect(run_board_cli.run([], { ...ports, size: () => SHORT })).rejects.toBe(STOPPED)

		expect(frames[1]).not.toMatch(/\n$/u)
		expect(stripVTControlCharacters(frames[1] ?? '').split('\n').length).toBeLessThanOrEqual(8)
	})

	it('draws a --once frame whole whatever the terminal size', async () => {
		const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

		await run_board_cli.run(['--once'], { ...ports, size: () => ({ rows: 2, columns: 80 }) })

		expect(frames[0]).toContain('  🔍 1  a')
		expect(frames[0]).not.toContain('more ')
	})

	it.each([['--once'], ['--chat']])(
		'draws %s with no Japanese under a ja session',
		async (flag) => {
			vi.stubEnv('JOSH_SESSION_LANG', 'ja')
			const note = { pos: 2, at: LAUNCH.at, kind: 'note', text: '#1 seen' }
			const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH, note] }, [plan_titled('a')])

			await run_board_cli.run([flag], ports)

			expect(frames[0]).toContain('  🔍 1  a')
			expect(frames[0]).toContain('seen')
			expect(frames[0]).not.toMatch(JAPANESE)
			vi.unstubAllEnvs()
		},
	)
})

async function live_lines(rows: number): Promise<Array<string>> {
	const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	await expect(
		run_board_cli.run([], { ...ports, size: () => ({ rows, columns: 200 }) }),
	).rejects.toBe(STOPPED)

	return stripVTControlCharacters(frames[1] ?? '').split('\n')
}

// joshuafolkken/kit#3505: the footer is the first line a short pane gives up, before any row.
describe('run_board_cli.run footer in a short pane', () => {
	it('drops the footer first when the pane is one row short', async () => {
		const tall = await live_lines(100)

		expect(tall.at(-1)).toMatch(/pnpm josh backlogrun`$/u)
		expect(await live_lines(tall.length - 1)).toEqual(tall.slice(0, -2))
	})
})
