import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { Thanks } from './run-board-thanks-csv'
import { run_board_thanks_read } from './run-board-thanks-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3809: the reviewers' roster is read beside the board, never holding up a live
// redraw; one plain frame waits for it; it is read again no sooner than the roster's record goes stale;
// a failed read keeps the names already drawn; and the chat frame neither reads nor draws it.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { TTL_MS } = run_board_thanks_read
const THANKS: Thanks = [
	{ name: 'fish', url: undefined },
	{ name: 'KittenLab', url: 'https://x.com/KittenLab' },
]
const NAMES = '  🙏 fish  KittenLab'

async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve)
	})
}

function plans(count: number): Array<ReturnType<typeof plan_titled>> {
	return Array.from({ length: count }, () => plan_titled('a'))
}

function lines_of(frame = ''): Array<string> {
	return frame.split('\n')
}

function read_once_then_fail(): Mock<() => Promise<Thanks>> {
	return vi
		.fn<() => Promise<Thanks>>()
		.mockResolvedValueOnce(THANKS)
		.mockRejectedValueOnce(new Error('offline'))
}

describe('run_board_tick.tick thanks', () => {
	it('draws a live frame without waiting on the roster, and the names on the redraw after it lands', async () => {
		const board = harness(LOCAL, plans(2))
		const read_thanks = vi.fn(async () => THANKS)
		const ports = { ...board.ports, read_thanks }

		const state = await tick(FRESH_STATE, ports, 'background')

		expect(lines_of(board.frames[0])).not.toContain(NAMES)

		await flush()
		await tick(state, ports, 'background')

		expect(lines_of(board.frames[1])).toContain(NAMES)
	})

	it('reads the roster again only once its record has gone stale, keeping the names when that read fails', async () => {
		const board = harness(LOCAL, plans(3))
		const ports = { ...board.ports, read_thanks: read_once_then_fail() }

		// Two redraws inside the roster's record life, then one at its end whose read fails.
		const first = await tick(FRESH_STATE, ports)

		board.clock.now_ms = START + TTL_MS - 1
		const second = await tick(first, ports)

		board.clock.now_ms = START + TTL_MS
		await tick(second, ports)

		expect(ports.read_thanks).toHaveBeenCalledTimes(2)
		expect(lines_of(board.frames[1])).toContain(NAMES)
		expect(lines_of(board.frames[2])).toContain(NAMES)
	})
})

describe('run_board_cli.run thanks', () => {
	it('waits for the roster in one plain frame, drawing the names right above the legend', async () => {
		const board = harness(LOCAL, plans(1))
		const read_thanks = vi.fn(async () => THANKS)

		await run_board_cli.run(['--once'], { ...board.ports, read_thanks })

		const lines = lines_of(board.frames[0])
		const at = lines.indexOf(NAMES)

		expect(at).toBeGreaterThan(0)
		expect(lines[at - 1]).toBe('')
		expect(lines[at + 1]).toBe('')
		expect(lines.slice(at + 2).join('\n')).not.toBe('')
	})

	it('neither reads nor draws the roster in the chat frame', async () => {
		const board = harness(LOCAL, plans(1))
		const read_thanks = vi.fn(async () => THANKS)

		await run_board_cli.run(['--chat'], { ...board.ports, read_thanks })

		expect(read_thanks).not.toHaveBeenCalled()
		expect(board.frames.join('')).not.toContain('KittenLab')
	})
})
