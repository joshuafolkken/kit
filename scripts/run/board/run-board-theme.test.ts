import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#7934: the WarGames theme — which one a board takes, and how it draws a frame.

const ESCAPE = '\u{1B}'
const RGB_GREEN = `${ESCAPE}[38;2;51;255;51m`
const NAMED_GREEN = `${ESCAPE}[32m`
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RED = `${ESCAPE}[31m`
const RULED = '── LANES ─────\n  ■■■──── 3/7 ── 2 CPU'
const ENV = { [run_board_theme.THEME_ENV]: 'wargames' }

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

	it('opens every line in 24-bit green and ends it on the default foreground', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(run_board_theme.restyle('wargames', 'a\n\nb')).toBe(
			`${RGB_GREEN}a${DEFAULT_FOREGROUND}\n\n${RGB_GREEN}b${DEFAULT_FOREGROUND}`,
		)
	})

	it('draws the palette green where stdout has no 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(run_board_theme.restyle('wargames', 'a')).toBe(`${NAMED_GREEN}a${DEFAULT_FOREGROUND}`)
	})

	it('keeps a color a line gives and resumes the green after it and after a reset', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const line = `a ${RED}🚨${DEFAULT_FOREGROUND} b ${RED}c${ESCAPE}[0m d`

		expect(run_board_theme.restyle('wargames', line)).toBe(
			`${RGB_GREEN}a ${RED}🚨${RGB_GREEN} b ${RED}c${ESCAPE}[0m${RGB_GREEN} d${DEFAULT_FOREGROUND}`,
		)
		expect(stripVTControlCharacters(run_board_theme.restyle('wargames', line))).toBe(
			stripVTControlCharacters(line),
		)
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
