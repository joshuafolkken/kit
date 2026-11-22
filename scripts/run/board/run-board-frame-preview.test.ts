import { describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_preview } from './run-board-frame-preview'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8434: `--frame` draws one live-form frame in a state its flags fix — the notice,
// its repeat mark, the sound switch, the theme and the size — and never touches the frame store.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { options_of } = run_board_frame_preview
const ESCAPE = '\u{1B}['
const NARROW = 60
const ROWS = 30
const SIZE = { rows: ROWS, columns: NARROW }
const NOTICE = ['--notice', 'running', '--issue', '8426']
const NOTICE_TEXT = /🔊 \d{2}:\d{2} 🔄 launch · #8426 running/u

async function framed(flags: ReadonlyArray<string>): Promise<{ text: string; code: number }> {
	const { ports, frames } = harness(LOCAL, [plan_titled('a')])
	const code = await run_board_cli.run(['--frame', ...flags], ports)

	return { text: frames.join(''), code }
}

describe('run_board_frame_preview — the notice', () => {
	it('draws the notice with its issue, time and the sound-on mark', async () => {
		const { text, code } = await framed(NOTICE)

		expect(code).toBe(0)
		expect(text).toMatch(NOTICE_TEXT)
		expect(text).not.toContain('×2')
	})

	it('marks a repeat and a muted switch', async () => {
		const { text } = await framed([...NOTICE, '--repeat', '--mute'])

		expect(text).toMatch(/🔇 \d{2}:\d{2} 🔄 launch · #8426 running ×2/u)
	})

	it('draws no notice when none is named', async () => {
		const { text } = await framed([])

		expect(text).not.toContain('#8426')
		expect(text).toContain('🔊 ')
	})
})

// joshuafolkken/kit#8505: the frame takes the icons the board would, as it takes the theme.
describe('run_board_frame_preview — the icons', () => {
	it('draws its icons as --icons asks', async () => {
		const { text } = await framed(['--icons', 'shapes'])

		expect(text).toContain('<) ')
		expect(text).not.toContain('🔊')
	})
})

// The screen rows a frame takes in a narrow pane, each line wrapped as the board counts it.
function narrow_height(text: string): number {
	return text.split('\n').reduce((sum, line) => sum + run_board_fit.height_of(line, NARROW), 0)
}

describe('run_board_frame_preview — the form', () => {
	// joshuafolkken/kit#8595: a narrow pane wraps the notice whole, and the frame counts the wrapped
	// rows within its height.
	it('keeps a narrow frame within its rows, the notice wrapped whole', async () => {
		const size = ['--columns', String(NARROW), '--rows', String(ROWS)]
		const { text } = await framed([...NOTICE, ...size])

		expect(text).toMatch(NOTICE_TEXT)
		expect(narrow_height(text)).toBeLessThanOrEqual(ROWS)
	})

	it('writes plain text unless --ansi keeps the escapes', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		vi.stubEnv('NO_COLOR', undefined)
		const plain = await framed(NOTICE)
		const colored = await framed([...NOTICE, '--ansi'])

		expect(plain.text).not.toContain(ESCAPE)
		expect(colored.text).toContain(ESCAPE)
	})

	it('draws in the theme it is given', async () => {
		const plain = await framed(['--ansi'])
		const themed = await framed(['--ansi', '--theme', 'wargames'])

		expect(themed.text).not.toBe(plain.text)
	})

	it('runs the lamp panel a lamp theme runs on a live board', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		vi.stubEnv('NO_COLOR', undefined)
		const { text } = await framed(['--theme', 'wargames'])

		expect(text).toContain('■')
	})

	it('draws past the --once record, neither reading nor recording it', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const store = { load: vi.fn(), save: vi.fn() }

		await run_board_cli.run(['--frame', ...NOTICE], { ...ports, frames: store })

		expect(store.load).not.toHaveBeenCalled()
		expect(store.save).not.toHaveBeenCalled()
	})
})

// A frame with one lamp placed on its second row, and a painter writing one cell over it.
const LAMP = { row: 2, column: 3, panel_row: 0, panel_rows: 1, group: 0, lamp: 0 }
const PAINTER = { is_idle: true, is_ticking: true, cells: () => [{ row: 2, column: 3, text: 'X' }] }
const LIT = {
	...run_board_tick.FRESH_STATE,
	lamps: [LAMP],
	panel: { painter: PAINTER, area: { top: 1, end: 10, rows: 7, lamps: [LAMP] } },
}
const BOLD = `${ESCAPE}1m`
const FRAME = `${BOLD}rule${ESCAPE}0m\nab■d\n`
const PLAIN = { cause: undefined, is_repeat: false, is_muted: false, size: SIZE, is_ansi: false }

// joshuafolkken/kit#8674: the theme's painter is drawn as the live board's first turn draws it.
describe('run_board_frame_preview — the theme painter', () => {
	const { painted } = run_board_frame_preview

	it('lays the painter cells over the plain frame', () => {
		expect(painted(FRAME, LIT, PLAIN, 0)).toBe('rule\nabXd\n')
	})

	it('writes the painter cells as cursor writes after the frame under --ansi', () => {
		expect(painted(FRAME, LIT, { ...PLAIN, is_ansi: true }, 0)).toBe(`${FRAME}${ESCAPE}2;3HX`)
	})

	it('draws no painter where the frame placed no lamps', () => {
		const unlit = { ...LIT, lamps: [] }

		expect(painted(FRAME, unlit, PLAIN, 0)).toBe('rule\nab■d\n')
		expect(painted(FRAME, unlit, { ...PLAIN, is_ansi: true }, 0)).toBe(FRAME)
	})
})

describe('run_board_frame_preview.overlaid', () => {
	const { overlaid } = run_board_frame_preview
	const WIDE = 'a🔊b'

	it('writes each cell at its 1-based row and column, padding a short line', () => {
		const cells = [
			{ row: 1, column: 2, text: 'XY' },
			{ row: 2, column: 5, text: '●' },
			{ row: 9, column: 1, text: 'gone' },
		]

		expect(overlaid('abcd\nab', cells)).toBe('aXYd\nab  ●')
	})

	it('blanks a wide grapheme a cell writes over half of, keeping the columns after it', () => {
		expect(overlaid(WIDE, [{ row: 1, column: 3, text: 'X' }])).toBe('a Xb')
		expect(overlaid(WIDE, [{ row: 1, column: 2, text: 'X' }])).toBe('aX b')
	})

	it('leaves a frame with no cells as it is', () => {
		expect(overlaid(`${WIDE}\n── x ──`, [])).toBe(`${WIDE}\n── x ──`)
	})
})

describe('run_board_frame_preview.options_of', () => {
	it('reads the fixed state the flags name', () => {
		expect(options_of([...NOTICE, '--repeat', '--rows', '20', '--columns', '70'])).toStrictEqual({
			cause: { cue: 'launch', word: 'running', issue: 8426 },
			is_repeat: true,
			is_muted: false,
			size: { rows: 20, columns: 70 },
			is_ansi: false,
		})
	})

	it.each([
		['--columns', 'wide'],
		['--rows', '0'],
		['--issue', '-1'],
		['--notice', 'nowhere'],
		['--issue', '8426'],
		['--repeat'],
		['--unknown'],
	])('refuses %s %s', (...flags: Array<string>) => {
		expect(options_of(flags)).toBeUndefined()
	})

	it('answers usage and exit code 1 for a bad flag', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const code = await run_board_cli.run(['--frame', '--columns', 'wide'], ports)

		expect(code).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('--frame'))
		error.mockRestore()
	})
})
