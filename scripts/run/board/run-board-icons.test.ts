import { describe, expect, it } from 'vitest'
import { run_board_icons } from './run-board-icons'

// joshuafolkken/kit#8505: how the board draws its icons, by `--icons` or `JOSH_BOARD_ICONS`.

const { ICONS_ENV } = run_board_icons

describe('run_board_icons.default_of', () => {
	it.each([
		{ theme: undefined, icons: 'emoji' },
		{ theme: 'wargames', icons: 'shapes' },
		{ theme: 'matrix', icons: 'shapes' },
	] as const)('draws $icons in $theme', ({ theme, icons }) => {
		expect(run_board_icons.default_of(theme)).toBe(icons)
	})
})

describe('run_board_icons.choose', () => {
	it.each([
		{
			argv: ['--icons', 'letters'],
			env: { [ICONS_ENV]: 'emoji' },
			theme: undefined,
			icons: 'letters',
		},
		{ argv: [], env: { [ICONS_ENV]: 'shapes' }, theme: undefined, icons: 'shapes' },
		{ argv: [], env: { [ICONS_ENV]: 'emoji' }, theme: 'wargames', icons: 'emoji' },
		{ argv: [], env: { [ICONS_ENV]: '' }, theme: 'matrix', icons: 'shapes' },
		{ argv: [], env: {}, theme: undefined, icons: 'emoji' },
	] as const)('takes $icons from $argv and $env in $theme', ({ argv, env, theme, icons }) => {
		expect(run_board_icons.choose(argv, env, theme)).toStrictEqual({ icons, argv: [] })
	})

	it('leaves the arguments past the flag', () => {
		expect(run_board_icons.choose(['--once', '--icons', 'emoji'], {}, 'wargames')).toStrictEqual({
			icons: 'emoji',
			argv: ['--once'],
		})
	})

	it.each([
		{ argv: ['--icons', 'glyphs'], env: {} },
		{ argv: ['--icons'], env: {} },
		{ argv: [], env: { [ICONS_ENV]: 'glyphs' } },
	])('refuses a name no icons have in $argv and $env', ({ argv, env }) => {
		expect(run_board_icons.choose(argv, env, undefined)).toBeUndefined()
	})
})

describe('run_board_icons.refusal', () => {
	it('names JOSH_BOARD_ICONS and the icons it may take', () => {
		expect(run_board_icons.refusal([], { [ICONS_ENV]: 'glyphs' })).toBe(
			'JOSH_BOARD_ICONS=glyphs names no icons (emoji, letters, shapes)\n',
		)
	})
})
