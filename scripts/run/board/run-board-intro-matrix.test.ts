import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_intro } from './run-board-intro'
import { run_board_intro_fixture } from './run-board-intro-fixture'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8441: matrix types three lead lines in the bright shade, the cursor after every letter,
// each held, erased and followed by a gap, then shows its line at once and holds it; a key ends it all.

const { ERASE_LINE_END, LINE_START, opening, play } = run_board_intro
const { NO_KEYS, READ, instant, line_of, never, read_at_once, recorded, skippable } =
	run_board_intro_fixture
const { leads: LEADS } = run_board_theme_defs.THEME_DEFS.matrix.intro
const { CURSOR } = run_board_typing
const ERASED = `${LINE_START}${ERASE_LINE_END}`
const THEME = 'matrix'

function bright(text: string): string {
	return line_of(run_board_labels.painted(LEADS.paint, text))
}

function lead_written(lead: string): Array<string> {
	const typing = Array.from(lead, (_letter, index) =>
		bright(`${lead.slice(0, index + 1)}${CURSOR}`),
	)

	return [...typing, '', ERASED]
}

function lead_ms(lead: string): Array<number> {
	return [...Array.from(lead, () => 50), 1100, 300]
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_intro.play matrix', () => {
	it('matrix types three lines then displays the final line at once', async () => {
		const typing_sound = { set: vi.fn<(is_on: boolean) => void>(), stop: vi.fn<() => void>() }
		const { written, ports } = recorded(instant)

		await play({ ...ports, typing_sound }, NO_KEYS, THEME)
		expect(LEADS.lines).toStrictEqual([
			'Wake up, Josh...',
			'The board has you...',
			'Follow the white rabbit.',
		])
		expect(written).toStrictEqual([
			...LEADS.lines.flatMap((lead) => lead_written(lead)),
			bright('Knock, knock, Josh.'),
		])
		expect(written.at(-1)?.includes(CURSOR)).toBe(false)
		expect(typing_sound.set.mock.calls).toStrictEqual(LEADS.lines.flatMap(() => [[true], [false]]))
	})

	it('matrix preserves the approved opening timings and cursor', async () => {
		const slept: Array<number> = []
		const { written, ports } = recorded(async (ms) => {
			slept.push(ms)
		})
		const [first = ''] = LEADS.lines

		await play(ports, NO_KEYS, THEME)
		expect(slept).toStrictEqual([...LEADS.lines.flatMap((lead) => lead_ms(lead)), 1300])
		expect(written[first.length - 1]).toBe(bright(`${first}${CURSOR}`))
		expect(run_board_labels.painted(LEADS.paint, 'X')).toContain('38;2;0;255;65')
	})
})

describe('run_board_intro.opening matrix', () => {
	it('matrix skips the whole intro on a key', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const opened = opening(read_at_once, ports, keys, THEME)

		press()
		await expect(opened.gather('background')).resolves.toBe(READ)
		expect(written).toStrictEqual([bright(`W${CURSOR}`)])
		expect(released()).toBe(true)
	})

	it('matrix suppresses opening when animation is disabled', async () => {
		const { written, ports } = recorded(instant)

		await play({ write: ports.write }, NO_KEYS, THEME)
		vi.stubEnv('FORCE_COLOR', '0')
		await play(ports, NO_KEYS, THEME)
		expect(written).toStrictEqual([])
	})
})
