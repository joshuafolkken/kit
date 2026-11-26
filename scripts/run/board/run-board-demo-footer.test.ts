import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_demo_footer } from './run-board-demo-footer'
import { run_board_fit } from './run-board-fit'
import { run_board_theme_events } from './run-board-theme-events'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_run, type ThemeRun, type ThemeValue } from './run-board-theme-run'

// Demo mode's footer: the work picked and what plays on it on one row, every key on the rows after it —
// the works' on one, the rest on the next — those two lit, kept within the pane's width.

const { VIEW, base_canvas, ticking_run } = run_board_theme_layer_fixture
const KEYS_ROWS = [
	'  KEYS  0 none   1 wopr   2 trace   3 flux   4 codec   5 nixie   6 skynet   7 magi',
	'        s IDLE   a PROGRESS   d ROW   w NOTICE   q OPENING   e ENDING   / EXIT',
]
const ITEMS = KEYS_ROWS.flatMap((row) => row.trim().split(/ {2,}/u)).filter(
	(item) => item !== 'KEYS',
)
const ESCAPE = '\u{1B}'
const LIT = new RegExp(`${ESCAPE}\\[38;2;255;214;10m([^${ESCAPE}]*)`, 'gu')
const NARROW = 40
const TINY = 5
const NOW_MS = 20_000
const PANE_COLUMNS = 80
const IDLE_TITLE = '[s] IDLE'

afterEach(() => {
	vi.unstubAllEnvs()
})

// A run in demo mode showing `value`.
function demo_run(value: ThemeValue): ThemeRun {
	const run = run_board_theme_run.run_of(value, () => undefined)

	run_board_theme_run.enter_demo(run)

	return run
}

function plain_rows(value: ThemeValue, columns?: number): Array<string> {
	const rows = run_board_demo_footer.rows_of(demo_run(value), columns) ?? []

	return rows.map((row) => stripVTControlCharacters(row))
}

// Every text the keys rows of `run` draw lit.
function lit_in(run: ThemeRun, columns?: number): Array<string> {
	const rows = run_board_demo_footer.rows_of(run, columns) ?? []

	return Array.from(rows.join('\n').matchAll(LIT), (match) => match[1] ?? '')
}

// A run in demo mode with the fixture's theme built over the base, so what plays is read off it.
function built_demo(): ThemeRun {
	const run = ticking_run(0)

	run_board_theme_layer.theme_layer(run, VIEW).draw(base_canvas(), NOW_MS)
	run_board_theme_run.enter_demo(run)

	return run
}

// `run`'s demo timeline set to the demo's `key` event, its play not over yet.
function playing(run: ThemeRun, key: 'n' | 'p' | 'r'): ThemeRun {
	if (run.demo !== undefined) {
		run.demo.timeline = run_board_theme_events.demo_timeline(key, 'row', 0)
	}

	return run
}

function title_of(run: ThemeRun): string {
	return stripVTControlCharacters(run_board_demo_footer.rows_of(run)?.[1] ?? '')
}

describe('run_board_demo_footer.rows_of', () => {
	it('draws no row outside demo mode', () => {
		const run = run_board_theme_run.run_of('trace', () => undefined)

		expect(run_board_demo_footer.rows_of(run)).toBeUndefined()
		expect(run_board_demo_footer.rows_of(undefined)).toBeUndefined()
	})

	it('names the work picked and IDLE under a blank row, then the keys in two groups of rows', () => {
		expect(plain_rows('trace')).toStrictEqual(['', `  [2] trace - ${IDLE_TITLE}`, ...KEYS_ROWS])
	})

	it('names no theme as none, its key 0', () => {
		expect(plain_rows('')).toStrictEqual(['', `  [0] none - ${IDLE_TITLE}`, ...KEYS_ROWS])
	})

	it('lights the picked work’s key and name and IDLE, moving with the pick', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(
			['', 'trace', 'magi'].map((value) => lit_in(demo_run(value as ThemeValue))),
		).toStrictEqual([
			['0 none', 's IDLE'],
			['2 trace', 's IDLE'],
			['7 magi', 's IDLE'],
		])
	})
})

describe('run_board_demo_footer.rows_of naming what plays', () => {
	it('names and lights the event demo mode plays while its play is not over', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const run = playing(built_demo(), 'p')

		const titles = (['r', 'n'] as const).map((key) => title_of(playing(built_demo(), key)))

		expect(title_of(run)).toBe('  [1] wopr - [a] PROGRESS')
		expect(lit_in(run)).toStrictEqual(['1 wopr', 'a PROGRESS'])
		expect(titles).toStrictEqual(['  [1] wopr - [d] ROW', '  [1] wopr - [w] NOTICE'])
	})

	it('names IDLE once the theme’s frame said the event’s play is over', () => {
		const run = playing(built_demo(), 'n')

		run_board_theme_run.demo_over(run)

		expect(title_of(run)).toBe(`  [1] wopr - ${IDLE_TITLE}`)
	})

	it('names the part playing over the event', () => {
		const run = playing(built_demo(), 'n')

		run_board_theme_run.play_part(run, 'ending', NOW_MS, true)
		expect(title_of(run)).toBe('  [1] wopr - [e] ENDING')
		run_board_theme_run.play_part(run, 'opening', NOW_MS, true)
		expect(title_of(run)).toBe('  [1] wopr - [q] OPENING')
	})

	it('names IDLE wherever no theme is built over the board, whatever plays', () => {
		const run = playing(demo_run('trace'), 'p')

		run_board_theme_run.play_part(run, 'ending', NOW_MS, true)

		expect(title_of(run)).toBe(`  [2] trace - ${IDLE_TITLE}`)
	})
})

describe('run_board_demo_footer.rows_of in a narrow pane', () => {
	it('wraps the keys, each key and its name whole, under the first key', () => {
		const keys = plain_rows('trace', NARROW).slice(2)
		const items = keys.flatMap((row) => row.trim().split(/ {2,}/u))

		expect(keys.length).toBeGreaterThan(1)
		expect(items).toStrictEqual(['KEYS', ...ITEMS])
		expect(keys.slice(1).every((row) => row.startsWith(' '.repeat('  KEYS  '.length)))).toBe(true)
		expect(keys.every((row) => run_board_fit.width_of(row) <= NARROW)).toBe(true)
	})

	it('starts what a key plays on a row of its own, the works wrapped above it', () => {
		const keys = plain_rows('trace', PANE_COLUMNS).slice(2)

		expect(keys.map((row) => row.trim().split(/ {2,}/u, 1)[0])).toStrictEqual([
			'KEYS',
			'7 magi',
			's IDLE',
		])
	})

	it('keeps the picked work lit on the row the wrap puts it on', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(lit_in(demo_run('magi'), NARROW)).toStrictEqual(['7 magi', 's IDLE'])
	})

	it('cuts a row wider than the pane, so none takes two of its rows', () => {
		const rows = run_board_demo_footer.rows_of(demo_run('skynet'), TINY) ?? []

		expect(rows.length).toBeGreaterThan(2)
		expect(rows.every((row) => run_board_fit.height_of(row, TINY) === 1)).toBe(true)
	})
})
