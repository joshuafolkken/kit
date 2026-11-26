import { describe, expect, it } from 'vitest'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#7934: which theme a board takes — `--theme` over `JOSH_BOARD_THEME`, a name no theme
// has refused; joshuafolkken/kit#8917 (Issue 4-2): an alias read as the value it names.

const ENV = { [run_board_theme.THEME_ENV]: 'wopr' }
const TRACE_ENV = { [run_board_theme.THEME_ENV]: 'trace' }

describe('run_board_theme.choose', () => {
	it.each([
		{ argv: ['--theme', 'wopr', '--once'], env: {}, theme: 'wopr', rest: ['--once'] },
		{ argv: ['--once', '--theme', 'wopr'], env: {}, theme: 'wopr', rest: ['--once'] },
		{ argv: ['--once'], env: ENV, theme: 'wopr', rest: ['--once'] },
		{ argv: [], env: {}, theme: undefined, rest: [] },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: '' }, theme: undefined, rest: [] },
	])('takes $theme from $argv and $env', ({ argv, env, theme, rest }) => {
		expect(run_board_theme.choose(argv, env)).toStrictEqual({ theme, argv: rest })
	})

	it.each([
		{ argv: ['--theme', 'nope'], env: ENV },
		{ argv: ['--theme'], env: ENV },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: 'nope' } },
		{ argv: ['--theme', 'WARGAMES'], env: {} },
		{ argv: ['--theme', 'josh-wopr'], env: {} },
	])('refuses a name no theme has in $argv and $env', ({ argv, env }) => {
		expect(run_board_theme.choose(argv, env)).toBeUndefined()
	})

	// joshuafolkken/kit#8354: `trace` from either place, `--theme` over `JOSH_BOARD_THEME`.
	it.each([
		{ argv: ['--theme', 'trace'], env: {}, theme: 'trace' },
		{ argv: [], env: TRACE_ENV, theme: 'trace' },
		{ argv: ['--theme', 'wopr'], env: TRACE_ENV, theme: 'wopr' },
		{ argv: ['--theme', 'trace'], env: ENV, theme: 'trace' },
	])('takes $theme with trace in $argv or $env', ({ argv, env, theme }) => {
		expect(run_board_theme.choose(argv, env)).toStrictEqual({ theme, argv: [] })
	})
})

describe('run_board_theme.choose an alias', () => {
	// A saved `JOSH_BOARD_THEME=wargames` launches as before; only the value is held.
	it.each([
		{ argv: ['--theme', 'wargames'], env: {}, theme: 'wopr' },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: 'matrix' }, theme: 'trace' },
		{ argv: [], env: { [run_board_theme.THEME_ENV]: 'bttf' }, theme: 'flux' },
		{ argv: ['--theme', 'backtothefuture'], env: {}, theme: 'flux' },
		{ argv: ['--theme', 'mgs'], env: ENV, theme: 'codec' },
		{ argv: ['--theme', 'steinsgate'], env: {}, theme: 'nixie' },
		{ argv: ['--theme', 'terminator'], env: {}, theme: 'skynet' },
		{ argv: ['--theme', 'eva'], env: {}, theme: 'magi' },
	])('reads the alias in $argv or $env as $theme', ({ argv, env, theme }) => {
		expect(run_board_theme.choose(argv, env)).toStrictEqual({ theme, argv: [] })
	})

	it('names the values, not the aliases, where the variable names none', () => {
		const environment = { [run_board_theme.THEME_ENV]: 'nope' }

		expect(run_board_theme.refusal([], environment)).toBe(
			'JOSH_BOARD_THEME=nope names no theme (wopr, trace, flux, codec, nixie, skynet, magi)\n',
		)
	})
})
