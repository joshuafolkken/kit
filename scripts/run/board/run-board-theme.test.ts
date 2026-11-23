import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_header_names } from './run-board-header-names'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
import { run_board_render_throughput } from './run-board-render-throughput'
import { run_board_spin_turn } from './run-board-spin-turn'
import type { BoardPorts } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_case } from './run-board-theme-case'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'
import type { ThroughputRow } from './run-board-throughput'

// joshuafolkken/kit#7934: the WarGames theme — which one a board takes, and how it draws a frame.

const ESCAPE = '\u{1B}'
const RGB_PHOSPHOR = `${ESCAPE}[38;2;62;236;225m`
const NAMED_CYAN = `${ESCAPE}[36m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RED = `${ESCAPE}[31m`
const RULED = '── LANES ─────\n  ■■■──── 3/7 ── 2 CPU'
const ENV = { [run_board_theme.THEME_ENV]: 'wargames' }
const MATRIX_ENV = { [run_board_theme.THEME_ENV]: 'matrix' }
const LINK_OPEN = `${ESCAPE}]8;;https://github.com/joshuafolkken/kit/issues/1\u{7}`
const LINK_CLOSE = `${ESCAPE}]8;;\u{7}`
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const { TITLE_MARK } = run_board_label_pair

function widths_of(frame: string): Array<number> {
	return frame.split('\n').map((line) => run_board_fit.width_of(line))
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme.choose', () => {
	it.each([
		{ argv: ['--theme', 'wargames', '--once'], env: {}, theme: 'wargames', rest: ['--once'] },
		{ argv: ['--once', '--theme', 'wargames'], env: {}, theme: 'wargames', rest: ['--once'] },
		{ argv: ['--once'], env: ENV, theme: 'wargames', rest: ['--once'] },
		{ argv: [], env: {}, theme: undefined, rest: [] },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: '' }, theme: undefined, rest: [] },
	])('takes $theme from $argv and $env', ({ argv, env, theme, rest }) => {
		expect(run_board_theme.choose(argv, env)).toStrictEqual({ theme, argv: rest })
	})

	it.each([
		{ argv: ['--theme', 'nope'], env: ENV },
		{ argv: ['--theme'], env: ENV },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: 'nope' } },
	])('refuses a name no theme has in $argv and $env', ({ argv, env }) => {
		expect(run_board_theme.choose(argv, env)).toBeUndefined()
	})

	// joshuafolkken/kit#8354: `matrix` from either place, `--theme` over `JOSH_BOARD_THEME`.
	it.each([
		{ argv: ['--theme', 'matrix'], env: {}, theme: 'matrix' },
		{ argv: [], env: MATRIX_ENV, theme: 'matrix' },
		{ argv: ['--theme', 'wargames'], env: MATRIX_ENV, theme: 'wargames' },
		{ argv: ['--theme', 'matrix'], env: ENV, theme: 'matrix' },
	])('takes $theme with matrix in $argv or $env', ({ argv, env, theme }) => {
		expect(run_board_theme.choose(argv, env)).toStrictEqual({ theme, argv: [] })
	})
})

describe('run_board_theme.restyle', () => {
	it('returns the frame as it is with no theme', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frame = `${RED}🚨${DEFAULT_FOREGROUND} ${RULED}`

		expect(run_board_theme.restyle(undefined, frame)).toBe(frame)
	})

	it('draws every rule as dashes in the same columns, with no escape where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const themed = run_board_theme.restyle('wargames', RULED)

		expect(themed).toBe('-- LANES -----\n  ■■■---- 3/7 -- 2 CPU')
		expect(themed.split('\n').map((line) => line.length)).toStrictEqual(
			RULED.split('\n').map((line) => line.length),
		)
	})

	it('opens every line in the 24-bit phosphor cyan and ends it on the default foreground', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(run_board_theme.restyle('wargames', 'A\n\nB')).toBe(
			`${RGB_PHOSPHOR}A${DEFAULT_FOREGROUND}\n\n${RGB_PHOSPHOR}B${DEFAULT_FOREGROUND}`,
		)
	})

	it('draws the palette cyan where stdout has no 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(run_board_theme.restyle('wargames', 'A')).toBe(`${NAMED_CYAN}A${DEFAULT_FOREGROUND}`)
	})

	it('keeps a color a line gives and resumes the phosphor cyan after it and after a reset', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const line = `A ${RED}P1${DEFAULT_FOREGROUND} B ${RED}C${ESCAPE}[0m D`

		expect(run_board_theme.restyle('wargames', line)).toBe(
			`${RGB_PHOSPHOR}A ${RED}P1${RGB_PHOSPHOR} B ${RED}C${ESCAPE}[0m${RGB_PHOSPHOR} D${DEFAULT_FOREGROUND}`,
		)
	})
})

// joshuafolkken/kit#7988: the theme draws icons as text and, in wargames, the text in capitals.
describe('run_board_theme.restyle as text', () => {
	it('draws each icon as text of its width and the text in capitals, its colors and links as written', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const line = `🚨 ${RED}fix${DEFAULT_FOREGROUND} ⚠️ the ${LINK_OPEN}board${LINK_CLOSE} → 🔨 ⠋`

		expect(run_board_theme.restyle('wargames', line)).toBe(
			`P1 ${RED}FIX${DEFAULT_FOREGROUND} !  THE ${LINK_OPEN}BOARD${LINK_CLOSE} > BD │`,
		)
	})

	it('keeps the width of every line of a frame with icons', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frame = `⏰ 12m · 🎯 3h ${RED}🔄 2${DEFAULT_FOREGROUND}\n  🔨 #1 a title 💤 ✅ ✓ ✗\n📈 throughput`
		const themed = run_board_theme.restyle('wargames', frame)

		expect(stripVTControlCharacters(themed)).not.toMatch(PICTOGRAPHIC)
		expect(widths_of(themed)).toStrictEqual(widths_of(frame))
	})

	// joshuafolkken/kit#8604: each theme's board name is drawn in the theme's case (joshuafolkken/kit#8609).
	it.each([
		['wargames', 'JOSH-WOPR'],
		['matrix', 'josh-trace'],
	] as const)('draws the %s board name as %s', (theme, drawn) => {
		vi.stubEnv('FORCE_COLOR', '0')
		const line = `■ ${run_board_header_names.board_name_of(theme)}`

		expect(stripVTControlCharacters(run_board_theme.restyle(theme, line))).toContain(drawn)
	})
})

// joshuafolkken/kit#8154: an icon beside its label is dropped; the same icon before a value is kept.
const { pair } = run_board_label_pair
const HEADINGS = [
	`▾ 📈 throughput ── ${pair('⚡', '/h')} ── ${pair('✅', 'DONE')} ── 🏔 PEAK ──`,
	'▾ 📌 usage ──',
	`▸ ${pair('🔗', 'waiting')} ── 8 ──`,
]
const PROCESSES = [
	`  ${pair('▶', 'backlogrun')}       46.6`,
	`    ${pair('🧭', 'supervisor')}      9.0`,
	`  ${pair('🌐', 'apps')}            17.2`,
]
const VALUES = '  💪 67%  ✅ 264/283  ▶ GraphQL'
const THROUGHPUT_ROW: ThroughputRow = {
	label: '24h',
	cells: [],
	active_ms: 0,
	done: 0,
	per_hour: undefined,
	peak: undefined,
	now: undefined,
}
const LABELED = [...HEADINGS, ...PROCESSES, VALUES].join('\n')

function wargames_lines(frame: string): Array<string> {
	vi.stubEnv('FORCE_COLOR', '0')

	return run_board_theme.restyle('wargames', frame).split('\n')
}

describe('run_board_theme.restyle beside a label', () => {
	it('draws every heading `V -- NAME` and a column label over the rule', () => {
		const [throughput, usage, waiting] = wargames_lines(HEADINGS.join('\n'))

		expect(throughput).toMatch(/^V -- THROUGHPUT -{5} \/H -{5} DONE -- \S+ PEAK --$/u)
		expect(usage).toBe('V -- USAGE --')
		expect(waiting).toBe('> -- WAITING -- 8 --')
	})

	// joshuafolkken/kit#8280: the narrowed throughput columns' labels, as the approved sample draws them.
	it('draws the throughput rule `/H ACTIVE - DONE - PEAK - NOW`', () => {
		const [rule = ''] = run_board_render_throughput.rows_part([THROUGHPUT_ROW]).head.slice(1)
		const [throughput] = wargames_lines(rule)

		expect(throughput).toMatch(/^-- -- THROUGHPUT -{20} \/H ACTIVE - DONE - PEAK - NOW -+$/u)
	})

	it('starts each group label at one column, a child two columns in, the figures unmoved', () => {
		const [backlogrun = '', supervisor = '', apps = ''] = wargames_lines(PROCESSES.join('\n'))

		expect(backlogrun.startsWith('  BACKLOGRUN ')).toBe(true)
		expect(apps.startsWith('  APPS ')).toBe(true)
		expect(supervisor.startsWith('    SUPERVISOR ')).toBe(true)
		expect(backlogrun.indexOf('46.6')).toBe(apps.indexOf('17.2'))
		expect(widths_of(wargames_lines(LABELED).join('\n'))).toStrictEqual(
			widths_of(run_board_label_pair.bare(LABELED)),
		)
	})

	it('keeps the icon text before a value', () => {
		expect(wargames_lines(VALUES)).toStrictEqual(['  CP 67%  OK 264/283  > GRAPHQL'])
	})

	it('leaves a frame with no theme as it is', () => {
		expect(run_board_theme.restyle(undefined, VALUES)).toBe(VALUES)
	})
})

// joshuafolkken/kit#8207: a line drawn before is taken from a bounded cache, in the same bytes.
const FRAME = [
	...HEADINGS,
	`${RED}🚨 fix${DEFAULT_FOREGROUND} ${RULED}`,
	...PROCESSES,
	VALUES,
].join('\n')
const SPINNER_WRITE = `${ESCAPE}[5;3H⠋ ${pair('🔨', 'build')} #1`

// The frame as the theme drew it before the cache, on the whole frame at once.
function whole_frame(frame: string): string {
	const ruled = run_board_label_pair.dropped(frame).replaceAll('─', '-')

	return run_board_theme_case.capitals(run_board_theme_glyphs.textual(ruled))
}

// Drops the cache: a change in stdout's color drops the lines drawn in the colors before.
function cold(force_color: string): void {
	vi.stubEnv('FORCE_COLOR', force_color === '0' ? '1' : '0')
	run_board_theme.restyle('wargames', 'A')
	vi.stubEnv('FORCE_COLOR', force_color)
}

describe('run_board_theme.restyle from its cache', () => {
	it.each(['0', '3'])(
		'draws the same bytes from the cache as with none, FORCE_COLOR=%s',
		(force) => {
			for (const write of [FRAME, SPINNER_WRITE]) {
				cold(force)
				const fresh = run_board_theme.restyle('wargames', write)

				expect(run_board_theme.restyle('wargames', write)).toBe(fresh)
			}
		},
	)

	it('draws a frame in the bytes it drew on the whole frame before the cache', () => {
		cold('0')

		expect(run_board_theme.restyle('wargames', FRAME)).toBe(whole_frame(FRAME))
		expect(run_board_theme.restyle('wargames', SPINNER_WRITE)).toBe(whole_frame(SPINNER_WRITE))
	})

	it('transforms each line of a colored frame as it did the whole frame', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const lines = FRAME.split('\n')

		expect(lines.map((line) => whole_frame(line))).toStrictEqual(whole_frame(FRAME).split('\n'))
	})
})

// joshuafolkken/kit#8649: the spinner's write, its spot with no color before it or with one, in the theme's glyphs.
const { SPINNER_FRAMES } = run_board_labels
const SPINNER_DOT = new RegExp(`[${SPINNER_FRAMES.join('')}]`, 'u')

function spun(theme: 'matrix' | 'wargames' | undefined, style: string): string {
	vi.stubEnv('FORCE_COLOR', '0')
	const spot = { row: 3, column: 5, style }
	const writes = SPINNER_FRAMES.map((frame) => run_board_spin_turn.spin_bytes([spot], frame))
	const themed = writes.map((write) => run_board_theme.restyle(theme, write))

	return stripVTControlCharacters(themed.join(''))
}

describe('run_board_theme.restyle on a spinner write', () => {
	it.each([
		['wargames', '│││╱╱───╲╲'],
		['matrix', 'ｦｱｳｴｵｶｷｹｺｻ'],
	] as const)('turns the %s spinner in its glyphs, with a color or none', (theme, glyphs) => {
		const drawn = ['', NAMED_CYAN].map((style) => spun(theme, style))

		expect(drawn).toStrictEqual([glyphs, glyphs])
		expect(drawn.join('')).not.toMatch(SPINNER_DOT)
	})

	it('keeps the spinner dots with no theme', () => {
		expect(spun(undefined, '')).toBe(SPINNER_FRAMES.join(''))
	})
})

describe('run_board_theme.restyle cache bounds', () => {
	it('holds no more lines than its limit', () => {
		cold('0')
		const lines = Array.from(
			{ length: run_board_theme.LINE_LIMIT * 2 },
			(_, index) => `ROW ${index}`,
		)

		run_board_theme.restyle('wargames', lines.join('\n'))

		expect(run_board_theme.kept_lines()).toBe(run_board_theme.LINE_LIMIT)
	})

	it('makes the phosphor escape again when stdout changes its colors', () => {
		const drawn = ['3', '1', '3'].map((force) => {
			vi.stubEnv('FORCE_COLOR', force)

			return run_board_theme.restyle('wargames', 'A')
		})

		expect(drawn).toStrictEqual([
			`${RGB_PHOSPHOR}A${DEFAULT_FOREGROUND}`,
			`${NAMED_CYAN}A${DEFAULT_FOREGROUND}`,
			`${RGB_PHOSPHOR}A${DEFAULT_FOREGROUND}`,
		])
	})
})

describe('run_board_theme.themed', () => {
	it('puts every write through the theme, keeping plain text with none', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const frames: Array<string> = []
		const ports = {
			write: (frame: string) => {
				frames.push(frame)
			},
		}

		run_board_theme.themed(ports, 'wargames').write('─')
		run_board_theme.themed(ports, undefined).write('─')

		expect(frames).toStrictEqual(['-', '─'])
	})

	// joshuafolkken/kit#8224: the reveal writes a line it drew already, past the theme.
	it('writes a drawn line as it is', () => {
		const frames: Array<string> = []
		const ports: Pick<BoardPorts, 'write' | 'write_drawn'> = {
			write: (frame: string) => {
				frames.push(frame)
			},
		}

		run_board_theme.themed(ports, 'wargames').write_drawn?.('─ a')

		expect(frames).toStrictEqual(['─ a'])
	})
})

// joshuafolkken/kit#8224: a title mark reaches the reveal alone; every write drops it.
describe('run_board_theme title marks', () => {
	const TITLED = `  7400 P1 ${run_board_label_pair.titled('a title')}  ET`

	it.each(['0', '3'])('draws no title mark, FORCE_COLOR=%s', (force) => {
		vi.stubEnv('FORCE_COLOR', force)
		const frames: Array<string> = []
		const ports = {
			write: (frame: string) => {
				frames.push(frame)
			},
		}

		run_board_theme.themed(ports, 'wargames').write(TITLED)

		expect(run_board_theme.restyle('wargames', TITLED)).not.toContain(TITLE_MARK)
		expect(frames.join('')).not.toContain(TITLE_MARK)
	})

	it('keeps the title mark for the reveal, in no columns', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const marked = run_board_theme.marked('wargames', TITLED)

		expect(marked).toBe(`  7400 P1 ${TITLE_MARK}A TITLE  ET`)
		expect(run_board_fit.width_of(marked)).toBe(
			run_board_fit.width_of(run_board_theme.restyle('wargames', TITLED)),
		)
	})
})
