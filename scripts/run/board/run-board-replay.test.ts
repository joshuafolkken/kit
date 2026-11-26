import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import type { TerminalSize } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_panel_fixture } from './run-board-panel-fixture'
import type { LocalRead } from './run-board-read'
import { run_board_replay, type Beat } from './run-board-replay'

const { IDLE_ROW, LOCAL, harness, plan_titled } = run_board_fixture
const { paneled } = run_board_panel_fixture
const PANELED = { ...LOCAL, throughput: [IDLE_ROW] }
const { lines_of, options_of, replay, run } = run_board_replay
const SIZE = ['--columns', '100', '--rows', '30']
const ARRIVE_TICK_MS = 50
// The escape a 24-bit color opens with, as JSON writes it.
const TRUE_COLOR = String.raw`\u001b[38;2;`

// The replay of `argv` over a read; a read with throughput rows lays out the lamp panel a theme draws
// its area by (joshuafolkken/kit#8917).
async function replayed(
	argv: ReadonlyArray<string>,
	local: LocalRead = LOCAL,
): Promise<Array<Beat>> {
	const options = options_of([...argv, ...SIZE], process.env)

	if (options === undefined) throw new Error(`refused: ${argv.join(' ')}`)
	const { ports } = harness(local, [plan_titled('a')])

	return await replay(ports, options)
}

// A single run as a real board reads one: its own name in the header, the throughput rows the lamp
// panel runs beside.
const SINGLE_RUN: LocalRead = { ...LOCAL, run_name: 'halfrun', throughput: [IDLE_ROW, IDLE_ROW] }
const WIDE: TerminalSize = { columns: 200, rows: 50 }
const NARROW: TerminalSize = { columns: 60, rows: 30 }
// Redraws past the wopr opening's line, typed and held.
const PAST_OPENING = 120

async function replayed_at(argv: ReadonlyArray<string>, size: TerminalSize): Promise<Array<Beat>> {
	const shape = ['--columns', String(size.columns), '--rows', String(size.rows)]
	const options = options_of([...argv, ...shape], process.env)

	if (options === undefined) throw new Error(`refused: ${argv.join(' ')}`)

	// A real single run reads its usage section and its lanes' usage, which lay its lamp panel out.
	const board = harness(SINGLE_RUN, [plan_titled('a')])

	return await replay(paneled(board), options)
}

// The screen's rows, characters only, once every beat is painted.
function screen_of(beats: ReadonlyArray<Beat>, size: TerminalSize): Array<string> {
	const cells = run_board_cells.cells_of(size)

	for (const beat of beats) run_board_cells_ansi.paint(cells, beat.text)

	return Array.from({ length: size.rows }, (_, row) => {
		const ids = cells.chars.slice(row * size.columns, (row + 1) * size.columns)

		return [...ids].map((id) => (id === 0 ? '' : run_board_cells.char_text(id))).join('')
	})
}

beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
	vi.stubEnv('JOSH_BOARD_ICONS', undefined)
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_replay.replay', () => {
	it('writes the same bytes for the same seed twice', async () => {
		const first = lines_of(await replayed(['--theme', 'trace', '--seed', '7']))
		const second = lines_of(await replayed(['--theme', 'trace', '--seed', '7']))

		expect(first).not.toBe('')
		expect(second).toBe(first)
	})

	// joshuafolkken/kit#8917: the theme host draws its randomness from the moment and the place.
	it('writes the same bytes whatever the seed', async () => {
		const first = lines_of(await replayed(['--theme', 'trace', '--seed', '1']))
		const second = lines_of(await replayed(['--theme', 'trace', '--seed', '2']))

		expect(second).toBe(first)
	})

	// A theme is drawn only in 24-bit color, so the replay draws in it whatever stdout draws.
	it('draws the theme in 24-bit color on a terminal of fewer colors', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const themed = lines_of(await replayed(['--theme', 'flux'], PANELED))
		const plain = lines_of(await replayed([], PANELED))

		expect(themed).toContain(TRUE_COLOR)
		expect(plain).not.toContain(TRUE_COLOR)
	})

	it('times the opening on the virtual clock, whatever the live clock does', async () => {
		const first = lines_of(await replayed(['--theme', 'flux', '--seed', '1']))
		let live_ms = 0

		vi.spyOn(performance, 'now').mockImplementation(() => (live_ms += ARRIVE_TICK_MS))
		const second = lines_of(await replayed(['--theme', 'flux', '--seed', '1']))

		expect(second).toBe(first)
	})

	it('writes one JSON line per beat', () => {
		expect(lines_of([{ text: 'a', ms: 1 }])).toBe('{"text":"a","ms":1}\n')
	})
})

describe('run_board_replay.replay over a single run', () => {
	// joshuafolkken/kit#8917: a real run's read written to a pipe — stdout drawing no color — drew the
	// base alone, its lamp panel never laid out, so the theme layer drew nothing.
	it('draws the theme layer piped to no color: its board name whole beside the clocks', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		vi.stubEnv('NO_COLOR', '1')
		const beats = await replayed_at(['--theme', 'wopr', '--ticks', String(PAST_OPENING)], WIDE)
		const [top = ''] = screen_of(beats, WIDE)

		expect(top).toMatch(/^\S JOSH-WOPR +-> /u)
		expect(process.env['FORCE_COLOR']).toBe('0')
		expect(process.env['NO_COLOR']).toBe('1')
	})

	// joshuafolkken/kit#8917: a pane too narrow for the lamp panel keeps the theme's look — its board
	// name, capitals, dashed rules and level — and gives up only the effects that need the area.
	it('keeps the theme where the pane has no room for the lamp panel', async () => {
		const ticks = ['--ticks', String(PAST_OPENING), '--icons', 'letters']
		const themed = screen_of(await replayed_at(['--theme', 'wopr', ...ticks], NARROW), NARROW)
		const drawn = themed.join('\n')

		expect(themed[0]).toMatch(/^. JOSH-WOPR /u)
		expect(drawn).toContain('DEFCON')
		expect(drawn).not.toContain('─')
		expect(themed).not.toStrictEqual(screen_of(await replayed_at(ticks, NARROW), NARROW))
	})
})

describe('run_board_replay.run', () => {
	it('writes the replayed beats as JSON lines and succeeds', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const { ports } = harness(LOCAL, [plan_titled('a')])

		await expect(run(['--theme', 'flux', ...SIZE], ports)).resolves.toBe(0)
		expect(String(write.mock.calls.at(0)?.[0])).toMatch(/^\{"text":/u)
	})

	it('prints the usage and fails on arguments it refuses', async () => {
		const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const { ports } = harness(LOCAL, [plan_titled('a')])

		await expect(run(['--theme', 'nope'], ports)).resolves.not.toBe(0)
		expect(String(error.mock.calls.at(0)?.[0])).toContain('Usage: josh board:replay')
	})
})

describe('run_board_replay.options_of', () => {
	it.each([
		[['--seed', 'x']],
		[['--ticks', '-1']],
		[['--theme', 'nope']],
		[['--notice', 'merged']],
		[['--unknown']],
		[['--icons', 'nope']],
	])('refuses %j', (argv) => {
		expect(options_of(argv, {})).toBeUndefined()
	})

	it('takes the icons from the arguments, else JOSH_BOARD_ICONS, as the live board does', () => {
		expect(options_of(['--icons', 'letters'], {})).toMatchObject({ icons: 'letters' })
		expect(options_of([], { JOSH_BOARD_ICONS: 'shapes' })).toMatchObject({ icons: 'shapes' })
	})

	it('takes the seed, the clock start and the redraws, passing the rest to the frame options', () => {
		expect(
			options_of(['--seed', '3', '--at=5', '--ticks', '2', '--columns', '80', '--mute'], {}),
		).toMatchObject({
			seed: 3,
			at_ms: 5,
			ticks: 2,
			frame: { is_muted: true, size: { columns: 80, rows: 40 } },
		})
	})
})
