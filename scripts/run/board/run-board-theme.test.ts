import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#7934: the WarGames theme — which one a board takes, and how it draws a frame.

const ESCAPE = '\u{1B}'
const RGB_PHOSPHOR = `${ESCAPE}[38;2;62;236;225m`
const NAMED_CYAN = `${ESCAPE}[36m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RED = `${ESCAPE}[31m`
const RULED = '── LANES ─────\n  ■■■──── 3/7 ── 2 CPU'
const ENV = { [run_board_theme.THEME_ENV]: 'wargames' }
const LINK_OPEN = `${ESCAPE}]8;;https://github.com/joshuafolkken/kit/issues/1\u{7}`
const LINK_CLOSE = `${ESCAPE}]8;;\u{7}`
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

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

// joshuafolkken/kit#7988: the theme draws icons as text and the text in capitals.
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

describe('run_board_theme.themed', () => {
	it('puts every write through the theme, and leaves the ports as they are with none', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const frames: Array<string> = []
		const ports = {
			write: (frame: string) => {
				frames.push(frame)
			},
		}

		run_board_theme.themed(ports, 'wargames').write('─')

		expect(frames).toStrictEqual(['-'])
		expect(run_board_theme.themed(ports, undefined)).toBe(ports)
	})
})
